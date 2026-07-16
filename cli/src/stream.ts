/**
 * STREAM — the streaming Brain: one harness, many verdicts (0.3.1).
 *
 * Every one-shot `claude -p` call re-boots the whole Claude Code harness: ~30.1k tokens and ~10s of
 * startup for a ~250-token question (measured, 0.3.0 dogfood — 99.2% luggage). This module runs a
 * batch of one-liner questions through ONE persistent `claude -p --input-format stream-json`
 * process instead: instructions ride `--append-system-prompt` (sent once, cached), each item is a
 * turn, and the toll is paid once per session. Measured in the 0.3.1 prototype: ~$0.0075/turn vs
 * $0.0238/call one-shot (~3.2x — cache reads bill at 0.1x, which is why raw token counts barely
 * move while cost collapses), receipts per turn, protocol confirmed.
 *
 * THE EXHAUST SENTINEL: a streamed session is a real multi-turn transcript in ~/.claude/projects —
 * unlike one-shot calls (whose lone turn never closes a pair), it WOULD parse as exchanges: judge
 * prompt → verdict → next judge prompt is (prompt → said → reaction) to the parser. Every streamed
 * prompt therefore begins with a `<stratless-…>` sentinel, and isRealPrompt (transcript.ts) drops
 * `<`-prefixed messages. The pipeline must never eat its own exhaust.
 *
 * Failure semantics (refuse, don't lie, streaming edition): a turn that times out kills the session
 * — a late answer after a timeout would misalign every following turn, so we never guess at
 * alignment. Completed turns are returned; the caller's ladder (stream → per-call → silence)
 * handles the remainder. Session rotation every `maxTurnsPerSession` bounds context growth (the
 * cached prefix grows ~2.5k tokens/turn; measured).
 */
import { spawn } from 'node:child_process';
import { recordUsage, type CallCost } from './usage.js';

/** Streamed prompts start with this — isRealPrompt drops `<`-prefixed messages (pinned by test). */
export const SENTINEL_PREFIX = '<stratless-';

export interface StreamItem {
  id: string;
  /** the per-turn body; the sentinel tag is prepended here, never by the caller */
  prompt: string;
}

export interface StreamBatchResult {
  /** id → the turn's final text (the result event's `result` field) */
  results: Map<string, string>;
  completed: number;
  /** items not completed (timeout, session death, batch abandoned) — the caller's fallback set */
  remaining: StreamItem[];
  /** whether streaming worked at all (false = fall back entirely, e.g. an old CLI) */
  streamed: boolean;
}

export interface StreamOpts {
  /** the instructions, sent once per session via --append-system-prompt */
  systemPrompt: string;
  /** sentinel tag for this role, e.g. 'judge' | 'audit' — becomes `<stratless-judge>` */
  role: string;
  model?: string;
  /** meter label ('judge' | 'audit') */
  feature: string;
  items: StreamItem[];
  /** per-turn watchdog; prototype measured 6–14s typical turns (default 90s) */
  turnTimeoutMs?: number;
  /** rotate the session after this many turns — bounds the cached-prefix growth (default 25) */
  maxTurnsPerSession?: number;
  /** MAX_THINKING_TOKENS for the child; undefined = inherit. The dogfood decides the default. */
  maxThinkingTokens?: number;
  onTurn?: (done: number, total: number) => void;
}

interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * Run one SESSION of up to `items.length` turns. Resolves with completed turn texts and per-session
 * receipts. Never rejects — any failure resolves with what completed (the ladder handles the rest).
 */
function runSession(
  bin: string,
  opts: StreamOpts,
  items: StreamItem[],
): Promise<{ results: Map<string, string>; usage: CallCost & { byModel?: Record<string, CallCost> } }> {
  return new Promise((resolve) => {
    const results = new Map<string, string>();
    const perTurn: TurnUsage[] = [];
    let lastCost = 0;
    let lastByModel: Record<string, CallCost> | undefined;
    let turn = 0;
    let buf = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const env = { ...process.env };
    // Thinking is CAPPED at 0 by default for streamed one-liners: a per-item verdict doesn't need
    // extended thinking (~500 tokens/turn ≈ 40% of turn cost, measured), and the tuned quality
    // check showed no degradation (dogfood 2026-07-17). STRATLESS_STREAM_THINKING re-enables it
    // (tokens budget), callers may pass their own cap.
    const envThink = Number(process.env.STRATLESS_STREAM_THINKING);
    const think = opts.maxThinkingTokens ?? (Number.isFinite(envThink) && envThink >= 0 ? envThink : 0);
    env.MAX_THINKING_TOKENS = String(think);

    const child = spawn(
      bin,
      [
        '-p',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
        ...(opts.model ? ['--model', opts.model] : []),
        '--append-system-prompt', opts.systemPrompt,
      ],
      { stdio: ['pipe', 'pipe', 'ignore'], env },
    );

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      const usage: CallCost & { byModel?: Record<string, CallCost> } = {
        costUsd: lastCost, // the result event's cost is session-cumulative — the last one is the bill
        inputTokens: perTurn.reduce((n, u) => n + u.inputTokens, 0),
        outputTokens: perTurn.reduce((n, u) => n + u.outputTokens, 0),
        cacheCreationTokens: perTurn.reduce((n, u) => n + u.cacheCreationTokens, 0),
        cacheReadTokens: perTurn.reduce((n, u) => n + u.cacheReadTokens, 0),
        ...(lastByModel ? { byModel: lastByModel } : {}),
      };
      resolve({ results, usage });
    };

    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(finish, opts.turnTimeoutMs ?? 90_000); // a late answer would misalign turns
    };

    const send = () => {
      if (turn >= items.length) {
        try {
          child.stdin.end(); // no more turns — let the child close; finish on 'close'
        } catch {
          finish();
        }
        return;
      }
      const text = `${SENTINEL_PREFIX}${opts.role}>\n${items[turn].prompt}`;
      arm();
      try {
        child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`);
      } catch {
        finish();
      }
    };

    child.on('error', finish); // spawn failure (e.g. old CLI) — resolve empty, ladder falls back
    child.on('close', finish);

    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let ev: any;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type !== 'result') continue; // the per-turn result event is the only advance signal
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        perTurn.push({
          inputTokens: num(ev.usage?.input_tokens),
          outputTokens: num(ev.usage?.output_tokens),
          cacheCreationTokens: num(ev.usage?.cache_creation_input_tokens),
          cacheReadTokens: num(ev.usage?.cache_read_input_tokens),
        });
        lastCost = num(ev.total_cost_usd) || lastCost;
        if (ev.modelUsage && typeof ev.modelUsage === 'object') {
          const byModel: Record<string, CallCost> = {};
          for (const [m, u] of Object.entries(ev.modelUsage as Record<string, any>)) {
            byModel[m] = {
              costUsd: num(u?.costUSD),
              inputTokens: num(u?.inputTokens),
              outputTokens: num(u?.outputTokens),
              cacheCreationTokens: num(u?.cacheCreationInputTokens),
              cacheReadTokens: num(u?.cacheReadInputTokens),
            };
          }
          lastByModel = byModel; // cumulative like the cost — last one wins
        }
        const text = typeof ev.result === 'string' ? ev.result.trim() : '';
        if (text) results.set(items[turn].id, text);
        turn++;
        opts.onTurn?.(turn, items.length);
        send();
      }
    });

    send(); // the CLI emits nothing until the first message arrives — never wait for it (measured)
  });
}

/**
 * Run a batch of one-liner items through streamed sessions, rotating every `maxTurnsPerSession`.
 * Records ONE meter entry per session (a session is one borrowed process — `calls` counts
 * processes, tokens are summed per turn; the cost field is the session's cumulative bill).
 * Set STRATLESS_NO_STREAM=1 to disable streaming entirely (the per-call ladder takes over).
 */
export async function runStreamBatch(bin: string, opts: StreamOpts): Promise<StreamBatchResult> {
  if (process.env.STRATLESS_NO_STREAM) {
    return { results: new Map(), completed: 0, remaining: [...opts.items], streamed: false };
  }
  const results = new Map<string, string>();
  // Rotation tuning (dogfood 2026-07-17): at 25 turns the growing prefix (~2.5k tokens/turn,
  // re-read by every later turn) ate most of the streaming win — 12 balances boot amortization
  // against the growth tax. STRATLESS_STREAM_ROTATE overrides for measurement.
  const envRotate = Number(process.env.STRATLESS_STREAM_ROTATE);
  const rotate = opts.maxTurnsPerSession ?? (Number.isFinite(envRotate) && envRotate > 0 ? envRotate : 12);
  let done = 0;
  let anyStreamed = false;

  for (let start = 0; start < opts.items.length; start += rotate) {
    const chunk = opts.items.slice(start, start + rotate);
    const session = await runSession(bin, { ...opts, onTurn: (t) => opts.onTurn?.(done + t, opts.items.length) }, chunk);
    for (const [id, text] of session.results) results.set(id, text);
    done += session.results.size;
    if (session.results.size > 0) {
      anyStreamed = true;
      recordUsage({ ...session.usage, feature: opts.feature });
    }
    // a session that completed NOTHING means streaming isn't working here — stop burning batches
    if (session.results.size === 0) break;
    // a partial session means a mid-batch failure — hand the rest to the fallback ladder
    if (session.results.size < chunk.length) break;
  }

  const remaining = opts.items.filter((it) => !results.has(it.id));
  return { results, completed: results.size, remaining, streamed: anyStreamed };
}
