/**
 * STREAM — the streaming call harness: one harness, many verdicts (0.3.1).
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
 * prompt therefore begins with a `<stratless-…>` sentinel, and the shared reader (reader.ts) drops
 * `<stratless-…>`-prefixed turns before they can parse as exchanges. The pipeline must never eat its own exhaust.
 *
 * TOOL-LESS BY CONSTRUCTION (C9): every streamed session runs with `--tools ""` — the borrow asks a
 * question, it never gets hands. Phase 0's B1 found the borrowed claude taking the writer prompt
 * literally and attempting a real filesystem write; a borrow with tools is one prompt away from
 * chatter instead of an artifact.
 *
 * Failure semantics (refuse, don't lie, streaming edition): a turn that times out or errors kills
 * the session — a late answer after a timeout would misalign every following turn, so we never
 * guess at alignment. Completed turns are returned. 0.3.4 adds THE BACKOFF RUNG (C6): a failure
 * that looks TRANSIENT (429 / rate limit / overloaded / 5xx) retries the remaining items in a
 * fresh session after an exponential pause, under a per-batch retry budget — a rate-limit storm
 * costs minutes, not evidence. Anything else falls through to the caller's ladder
 * (stream → per-call → silence) exactly as before. Session rotation every `maxTurnsPerSession`
 * bounds context growth (the cached prefix grows ~2.5k tokens/turn; measured).
 */
import { spawn } from 'node:child_process';
import { recordUsage, type CallCost } from './usage.js';
import { CLEAN_ARGS, TOOLLESS_ARGS } from './claude.js';

/** Streamed prompts start with this — the shared reader (reader.ts) drops `<stratless-…>`-prefixed turns so the pipeline never re-ingests its own exhaust. */
export const SENTINEL_PREFIX = '<stratless-';

/** Does a failure smell TRANSIENT — worth a pause and another try, rather than a downgrade?
 *  Matched against the child's error events and stderr tail. Exported for tests. */
export function isTransientFailure(text: string): boolean {
  return /\b(429|503|529)\b|rate.?limit|too many requests|overloaded|econnreset|etimedout|socket hang up/i.test(text);
}

/** The retry budget per batch — a storm degrades throughput; a hard-down claude exits in bounded time. */
const MAX_TRANSIENT_RETRIES = 5;
/** Backoff ceiling — degrade to slower, never to minutes-long dead air per step. */
const MAX_BACKOFF_MS = 30_000;

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
  /** wall-clock per completed turn, in order (C8 — the stopwatch's raw material) */
  turnsMs: number[];
  /** transient-retry rounds spent (the backoff rung engaging is visible, never silent) */
  retries: number;
}

export interface StreamOpts {
  /** the instructions, sent once per session via --append-system-prompt */
  systemPrompt: string;
  /** JSON Schema the reply must satisfy — rides --json-schema, enforcing the form in the transport
   *  instead of asking for it in prose. Measured 4x shorter replies and zero parse failures. */
  jsonSchema?: string;
  /** sentinel tag for this role, e.g. 'judge' | 'audit' — becomes `<stratless-judge>` */
  role: string;
  model?: string;
  /** meter label ('judge' | 'audit') */
  feature: string;
  items: StreamItem[];
  /** per-turn watchdog; prototype measured 6–14s typical turns (default 90s) */
  turnTimeoutMs?: number;
  /** rotate the session after this many turns — bounds the cached-prefix growth (default 8) */
  maxTurnsPerSession?: number;
  /** MAX_THINKING_TOKENS for the child; undefined = inherit. The dogfood decides the default. */
  maxThinkingTokens?: number;
  /** base of the exponential backoff (default 1000ms; STRATLESS_BACKOFF_BASE_MS overrides — tests) */
  backoffBaseMs?: number;
  onTurn?: (done: number, total: number) => void;
  /** called after EACH session with that session's results — the caller's checkpoint moment (C3:
   *  bank per chunk, so a death loses at most one chunk, never the whole batch) */
  onSessionResults?: (results: Map<string, string>) => void;
}

interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

interface SessionOutcome {
  results: Map<string, string>;
  usage: CallCost & { byModel?: Record<string, CallCost> };
  /** wall-clock per completed turn */
  turnsMs: number[];
  /** why the session ended early, if it did — error-event text + stderr tail, for classification */
  failure: string;
}

/**
 * Run one SESSION of up to `items.length` turns. Resolves with completed turn texts, per-session
 * receipts, per-turn timings, and — when it ended early — the failure text the batch layer
 * classifies. Never rejects (the ladder handles the rest).
 */
function runSession(bin: string, opts: StreamOpts, items: StreamItem[]): Promise<SessionOutcome> {
  return new Promise((resolve) => {
    const results = new Map<string, string>();
    const perTurn: TurnUsage[] = [];
    const turnsMs: number[] = [];
    let failure = '';
    let stderrTail = '';
    let lastCost = 0;
    let lastByModel: Record<string, CallCost> | undefined;
    let turn = 0;
    let sentAt = 0;
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
        ...TOOLLESS_ARGS, // C9: the borrow asks; it never gets hands
        ...CLEAN_ARGS, // and it arrives knowing nothing but the question — see claude.ts
        ...(opts.model ? ['--model', opts.model] : []),
        ...(opts.jsonSchema ? ['--json-schema', opts.jsonSchema] : []),
        '--append-system-prompt', opts.systemPrompt,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], env },
    );
    activeChild = child; // the kill hook's target while this session runs

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (activeChild === child) activeChild = undefined;
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
      // The failure the batch layer classifies: an incomplete session's error text + stderr tail.
      const early = results.size < items.length;
      resolve({ results, usage, turnsMs, failure: early ? `${failure}\n${stderrTail}`.trim() : '' });
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
      sentAt = Date.now();
      try {
        child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`);
      } catch {
        finish();
      }
    };

    child.on('error', finish); // spawn failure (e.g. old CLI) — resolve empty, ladder falls back
    child.on('close', finish);
    // Pipe errors arrive ASYNCHRONOUSLY as 'error' events — an unhandled one is an uncaught
    // exception that kills the whole process (found by the 0.3.2 backtest: EPIPE writing a turn
    // after the child closed its stdin). Swallow into finish(): completed turns survive, the
    // remainder goes to the fallback ladder.
    child.stdin.on('error', finish);
    child.stdout.on('error', finish);
    // The stderr tail is the transient/fatal telltale (C6) — a rate-limited CLI says so here.
    child.stderr.on('error', () => {});
    child.stderr.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-4096);
    });

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
        // An error result never advances the turn: its text is a diagnosis, not an answer, and
        // treating it as one would misalign every following turn. Capture and end the session —
        // the batch layer decides whether it was transient (retry) or fatal (ladder).
        if (ev.is_error === true || (typeof ev.subtype === 'string' && ev.subtype !== 'success')) {
          const detail = [ev.subtype, typeof ev.result === 'string' ? ev.result : '', typeof ev.error === 'string' ? ev.error : '']
            .filter(Boolean)
            .join(' · ');
          failure = detail || 'error result';
          finish();
          return;
        }
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
        if (text) {
          results.set(items[turn].id, text);
          turnsMs.push(Date.now() - sentAt); // C8: one wall-clock per COMPLETED turn — an empty
          // answer's item is re-asked on the fallback rung, and timing it here too would
          // double-count it into the rates the door quotes from
        }
        turn++;
        opts.onTurn?.(turn, items.length);
        send();
      }
    });

    send(); // the CLI emits nothing until the first message arrives — never wait for it (measured)
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── the worker's kill hook (Phase 2, C7) ───────────────────────────────────────────────────────
// The one active borrowed child, tracked so `stop` can end a run in seconds: SIGTERM lands, the
// worker kills the in-flight session (completed turns are already banked; the rest re-asks next
// wake — C3 bounds the loss to one chunk), and exits at once.
let activeChild: ReturnType<typeof spawn> | undefined;

/** Kill the in-flight streamed session, if any. Safe to call from a signal handler. */
export function killActiveSession(): void {
  try {
    activeChild?.kill('SIGKILL');
  } catch {
    /* already gone */
  }
}

/**
 * Run a batch of one-liner items through streamed sessions, rotating every `maxTurnsPerSession`.
 * Records ONE meter entry per session (a session is one borrowed process — `calls` counts
 * processes, tokens are summed per turn; the cost field is the session's cumulative bill).
 *
 * The backoff rung (C6): a session that dies with a TRANSIENT smell (429 / rate limit /
 * overloaded / 5xx) pauses — exponentially, capped — and retries the REMAINING items in a fresh
 * session, up to MAX_TRANSIENT_RETRIES per batch. Completed turns are never re-asked (zero
 * evidence lost, zero re-spend). A non-transient death keeps the 0.3.1 semantics: partial → the
 * caller's per-call ladder takes the remainder; zero-progress → streaming is declared not working
 * and the ladder takes everything.
 * Set STRATLESS_NO_STREAM=1 to disable streaming entirely (the per-call ladder takes over).
 */
export async function runStreamBatch(bin: string, opts: StreamOpts): Promise<StreamBatchResult> {
  if (process.env.STRATLESS_NO_STREAM) {
    return { results: new Map(), completed: 0, remaining: [...opts.items], streamed: false, turnsMs: [], retries: 0 };
  }
  const results = new Map<string, string>();
  const turnsMs: number[] = [];
  // Rotation tuning. 25 → 12 (dogfood 2026-07-17): the growing prefix, re-read by every later
  // turn, ate most of the streaming win. 12 → 8 (measured 2026-07-19): the boot toll fell ~3.5x
  // when `--tools ""` entered the spawn (25.6k → 7.2k tokens), so a rotation tuned against the
  // old toll was carrying more prefix than it needed to. Swept 2/4/8/12 over a fixed sample:
  // 8 came out ~17% cheaper per verdict than 12 ($0.0098 vs $0.0118) at the same session count.
  //
  // The floor is stability, not cost: rotation 2 spent TWELVE sessions to land seven verdicts —
  // rapid spawn/kill cycles die before their first result and still pay a full boot. Do not chase
  // the prefix below this without re-checking the failure rate, which dominates cost by ~9x.
  // STRATLESS_STREAM_ROTATE overrides for measurement.
  const envRotate = Number(process.env.STRATLESS_STREAM_ROTATE);
  const rotate = opts.maxTurnsPerSession ?? (Number.isFinite(envRotate) && envRotate > 0 ? envRotate : 8);
  const envBackoff = Number(process.env.STRATLESS_BACKOFF_BASE_MS);
  const backoffBase = opts.backoffBaseMs ?? (Number.isFinite(envBackoff) && envBackoff > 0 ? envBackoff : 1000);
  let retries = 0; // total backoff retries this batch — the reported truth
  let stormRetries = 0; // retries within the CURRENT storm — the budget; resets on a clean chunk
  let zeroRuns = 0; // consecutive sessions that completed NOTHING — the hard-down telltale
  let anyStreamed = false;

  let pending = [...opts.items];
  while (pending.length) {
    const chunk = pending.slice(0, rotate);
    const session = await runSession(
      bin,
      { ...opts, onTurn: (t) => opts.onTurn?.(results.size + t, opts.items.length) },
      chunk,
    );
    for (const [id, text] of session.results) results.set(id, text);
    turnsMs.push(...session.turnsMs);
    if (session.results.size > 0) {
      anyStreamed = true;
      zeroRuns = 0;
      recordUsage({ ...session.usage, feature: opts.feature });
      opts.onSessionResults?.(session.results); // the checkpoint moment — bank this chunk NOW (C3)
    } else if (session.failure) {
      // The session booted a whole harness (~17–24k tokens, measured) and died before its first
      // receipt — the meter must not record that as free (C11). An unmetered call is the honest
      // entry: a spend happened whose size we cannot see. (An empty failure means the spawn
      // itself never took — nothing ran, nothing to record.)
      zeroRuns++;
      recordUsage({ feature: opts.feature, unmetered: true });
    } else {
      zeroRuns++;
    }
    pending = pending.filter((it) => !results.has(it.id));
    if (session.results.size === chunk.length) {
      stormRetries = 0; // a clean chunk resets the budget — it bounds each STORM, not the batch's lifetime
      continue;
    }

    // The session died early. Transient → pause and retry the remainder in a fresh session — but
    // a claude that never completes ANYTHING gets two chances, not five: a hard-down network
    // spells 429-ish (ECONNRESET, ETIMEDOUT) too, and the old fail-fast-to-the-ladder promise
    // must survive the backoff rung.
    if (isTransientFailure(session.failure) && stormRetries < MAX_TRANSIENT_RETRIES && zeroRuns <= 2) {
      retries++;
      stormRetries++;
      await sleep(Math.min(backoffBase * 2 ** (stormRetries - 1), MAX_BACKOFF_MS));
      continue;
    }
    // Fatal (or the budget is spent): 0.3.1 semantics — the per-call ladder takes the remainder.
    break;
  }

  const remaining = opts.items.filter((it) => !results.has(it.id));
  return { results, completed: results.size, remaining, streamed: anyStreamed, turnsMs, retries };
}
