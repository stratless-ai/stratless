/**
 * THE BORROW — the one place the profiler shells out to the person's own `claude`.
 *
 * No API key, no server, no bill (handover §3). Most people run Claude Code on a subscription and
 * have no ANTHROPIC_API_KEY at all, so a BYO-key requirement would stop the majority at the door —
 * but `claude` is already installed and already authenticated. explain.ts pioneered this for one
 * sentence; the judge and synthesizer reuse it at scale. Their model, their auth, their machine.
 *
 * findAssistant lives in explain.ts; we re-export it so there is exactly one implementation.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { recordUsage, type CallCost } from './usage.js';

/**
 * TOOL-LESS BY CONSTRUCTION (C9): every borrowed call carries `--tools ""` — the borrow asks a
 * question, it never gets hands. Phase 0's B1 caught the borrowed claude taking the writer prompt
 * ("you are writing the file…") literally, attempting a real filesystem write, and returning
 * permission chatter instead of the artifact. Unconditional by decision (Sun, 2026-07-17): a CLI
 * too old to know `--tools` refuses loudly, which beats silently running with tools — B1's exact
 * failure mode. Shared with stream.ts so one constant governs every spawn.
 */
export const TOOLLESS_ARGS = ['--tools', ''] as const;

/**
 * BLANK-SLATE BY CONSTRUCTION: every borrowed call carries `--safe-mode`, which disables CLAUDE.md
 * discovery, auto-memory, and every other customization on the machine.
 *
 * Without it the borrowed assistant arrives already knowing the person. Verified 2026-07-20 by
 * asking it directly — it answered YES and quoted context back. THREE sources feed it, and which
 * one answers depends on the working directory:
 *
 *   1. `~/.claude/CLAUDE.md` -> `@~/.claude/HUMAN.md` — OUR OWN PROFILE. The judge reads the file
 *      it is helping to write, so the profile confirms itself: a claim that gets in makes the judge
 *      likelier to see it again, which puts it back in. No stage could catch this; every stage is
 *      downstream of it. Measured direction: toward flattery. The same pile judged with the profile
 *      loaded produced a category quoting HUMAN.md's own wording, and did NOT produce
 *      "reacts with blunt or profane language when confused" — which the blank-slate run did.
 *      A profile that hides where the person got lost fails at exactly the thing it exists for.
 *   2. Claude Code's own auto-memory, which survives `stratless stop`.
 *   3. The project's `CLAUDE.md` / `CLAUDE.local.md` and anything they import.
 *
 * THE FORWARD REASON, bigger than the bug: without this the instrument is not the same for two
 * people. A user with a rich CLAUDE.md gets a differently-informed reader than a user with none —
 * a variable in the measurement that we neither control nor can see. The blank slate is what makes
 * "same method for every user" literally true rather than aspirational.
 *
 * UNCONDITIONAL, on the same reasoning as TOOLLESS_ARGS above: a CLI too old to know the flag
 * refuses loudly, which beats silently judging someone while reading their strategy documents.
 *
 * NOT `--bare`, which also blocks the memory but forces ANTHROPIC_API_KEY / apiKeyHelper auth and
 * so kills the borrow at the door (no key, ride the subscription).
 *
 * It is also cheaper and faster — measured on identical input, $0.71 -> $0.49 and 150s -> 87s.
 * There is simply less to carry.
 */
export const CLEAN_ARGS = ['--safe-mode'] as const;

/** Is a binary on PATH? (Also guards `init --auto`: a hook that runs `stratless` needs it findable.) */
export function onPath(bin: string): boolean {
  try {
    execFileSync('which', [bin], { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Is a borrowable assistant CLI on PATH? (No API key — we ride the one you already have.)
 * STRATLESS_CLAUDE_BIN — the absolute path a spawner captured at spawn time (C5) — wins over the
 * PATH walk: a detached worker's PATH is the hook's thin one, not the person's shell.
 */
export function findAssistant(): string | undefined {
  const pinned = process.env.STRATLESS_CLAUDE_BIN;
  if (pinned && existsSync(pinned)) return pinned;
  for (const bin of ['claude']) if (onPath(bin)) return bin;
  return undefined;
}

/**
 * Ask the person's own assistant one thing, in --print mode. Returns undefined if it can't answer.
 *
 * `model` names an alias (haiku, sonnet) the call is PINNED to; omit it to run on their default.
 * `feature` labels the call for the usage ledger so `status` shows WHERE the spend went.
 *
 * THE PIN IS ABSOLUTE (Sun, 2026-07-18): a pinned call runs on ITS model or it REFUSES — it never
 * silently falls back to the account's default. The old escape-to-default rungs are gone: a pin
 * escape could land the priciest stage (the miner) on the priciest model (a user who defaults to
 * Opus) at frontier rates, invisibly. Always sonnet/haiku unless the user overrides
 * (STRATLESS_SYNTH_MODEL). Compatibility for a CLI without JSON output is kept — but on the SAME
 * pinned model, as plain text.
 *
 * THE PLAIN RUNG IS METERED AS UNMETERED (C11, Phase 0's B3): it carries no receipt, so the ledger
 * records "a call happened whose cost I cannot see" rather than a confident zero. It also rejects
 * an error envelope (a broken pin can emit one here too — is_error text must never pass as an
 * answer, the same refusal parseJsonResult makes on the JSON rung).
 */
export function runClaude(
  bin: string,
  input: string,
  model?: string,
  feature?: string,
  timeoutMs = 120_000,
  /** JSON Schema the reply must satisfy (--json-schema). The JSON rung only: the plain-text rung
   *  exists for a CLI too old to know --output-format json, which will not know this either. */
  schema?: string,
  /**
   * MAX_THINKING_TOKENS for the borrowed child. Undefined inherits the environment (extended
   * thinking on); 0 turns it off. Assignment is a mechanical per-item presence check where thinking
   * is pure waste — measured 43,516 output tokens for a 5,334-token answer, ~3x the bill — so it
   * passes 0. Discovery, a genuine reasoning pass, leaves it unset. `stream.ts` already caps its
   * own child this way (MAX_THINKING_TOKENS on the spawn env); this brings the one-shot rung to the
   * same parity, which it lacked — a worker's runClaude call inherited an uncapped environment and
   * paid the full 3x, invisibly.
   */
  maxThinkingTokens?: number,
): string | undefined {
  // Prefer JSON (metered, is_error-checked); fall back to plain text on the SAME pinned model for
  // a CLI without JSON output. THE PROMPT COMES BEFORE --tools: `--tools` is variadic and would
  // swallow a following positional whole (verified live, 2026-07-17).
  const modelArgs = model ? ['--model', model] : [];
  const schemaArgs = schema ? ['--json-schema', schema] : [];
  const attempts: { args: string[]; json: boolean }[] = [
    { args: ['-p', '--output-format', 'json', ...modelArgs, ...schemaArgs, ...CLEAN_ARGS, input, ...TOOLLESS_ARGS], json: true },
    { args: ['-p', ...modelArgs, ...CLEAN_ARGS, input, ...TOOLLESS_ARGS], json: false },
  ];

  // The child inherits our environment, save for the thinking cap when the caller sets one. Built
  // once — both rungs spawn the same child.
  const childEnv =
    maxThinkingTokens === undefined ? process.env : { ...process.env, MAX_THINKING_TOKENS: String(maxThinkingTokens) };

  for (const { args, json } of attempts) {
    try {
      const out = execFileSync(bin, args, {
        encoding: 'utf8',
        env: childEnv,
        timeout: timeoutMs, // sized PER CALL: a one-line judgment needs little; a mining pass over
        // dozens of judgments legitimately thinks for minutes (dogfood 2026-07-17: the default
        // 120s made mining structurally impossible — every attempt timed out, silently)
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 8 * 1024 * 1024, // JSON carries metadata on top of the text — give it room
      }).trim();
      if (!out) continue;
      if (!json) {
        if (isErrorEnvelope(out)) continue; // a broken pin's error JSON must not pass as an answer
        recordUsage({ feature, unmetered: true }); // no receipt on this rung — count it, never zero it
        return out;
      }
      const parsed = parseJsonResult(out);
      if (!parsed) continue; // unparseable, or an is_error envelope — refuse this rung
      recordUsage({ ...parsed.usage, feature }); // best-effort; never throws
      return parsed.result;
    } catch {
      /* try the next attempt; if all fail the caller degrades to silence */
    }
  }
  return undefined;
}

/** Does this raw output parse as a JSON error envelope (`is_error:true`)? The plain-text rung uses
 *  it to reject a broken pin's error prose — parseJsonResult makes the same call on the JSON rung. */
function isErrorEnvelope(raw: string): boolean {
  try {
    const o = JSON.parse(raw) as { is_error?: unknown };
    return o !== null && typeof o === 'object' && o.is_error === true;
  } catch {
    return false; // real plain-text prose isn't JSON — it passes
  }
}

interface ParsedResult {
  result: string;
  usage: CallCost & { byModel?: Record<string, CallCost> };
}

/**
 * Parse `claude -p --output-format json`. Returns undefined unless it's the shape we expect.
 *
 * AN ERROR ENVELOPE IS A REFUSAL, NOT AN ANSWER: a failed call can exit 0 with
 * `{"is_error":true,"result":"There's an issue with the selected model…"}` — and its `subtype` is
 * still "success" (verified live, 2026-07-17), so `is_error` is the one honest field. Returning
 * that prose as the model's answer would poison the judgment cache with error text and feed it to
 * the profile — the exact confidently-wrong artifact this product exists to never produce.
 * Refusing here advances the ladder to the next (unpinned, still metered) rung instead.
 *
 * The receipt's cache fields are where the real consumption lives — every call carries ~17–24k
 * tokens of harness overhead as cache-creation/cache-read, which dwarfs our own prompt. v1 dropped
 * them and the meter showed 484 input tokens where reality was over a million. `modelUsage` is the
 * per-model truth (which model ACTUALLY ran — the alias we request is not a guarantee).
 * Exported for tests.
 */
export function parseJsonResult(raw: string): ParsedResult | undefined {
  try {
    const o = JSON.parse(raw) as {
      result?: unknown;
      is_error?: unknown;
      total_cost_usd?: unknown;
      usage?: {
        input_tokens?: unknown;
        output_tokens?: unknown;
        cache_creation_input_tokens?: unknown;
        cache_read_input_tokens?: unknown;
      };
      modelUsage?: Record<
        string,
        {
          inputTokens?: unknown;
          outputTokens?: unknown;
          cacheCreationInputTokens?: unknown;
          cacheReadInputTokens?: unknown;
          costUSD?: unknown;
        }
      >;
    };
    if (o.is_error === true) return undefined; // an error envelope's prose is a diagnosis, never an answer
    const result = typeof o.result === 'string' ? o.result.trim() : '';
    if (!result) return undefined;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const byModel: Record<string, CallCost> = {};
    for (const [model, m] of Object.entries(o.modelUsage ?? {})) {
      byModel[model] = {
        costUsd: num(m?.costUSD),
        inputTokens: num(m?.inputTokens),
        outputTokens: num(m?.outputTokens),
        cacheCreationTokens: num(m?.cacheCreationInputTokens),
        cacheReadTokens: num(m?.cacheReadInputTokens),
      };
    }
    return {
      result,
      usage: {
        costUsd: num(o.total_cost_usd),
        inputTokens: num(o.usage?.input_tokens),
        outputTokens: num(o.usage?.output_tokens),
        cacheCreationTokens: num(o.usage?.cache_creation_input_tokens),
        cacheReadTokens: num(o.usage?.cache_read_input_tokens),
        ...(Object.keys(byModel).length ? { byModel } : {}),
      },
    };
  } catch {
    return undefined;
  }
}
