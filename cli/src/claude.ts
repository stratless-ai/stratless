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
): string | undefined {
  // Prefer JSON (metered, is_error-checked); fall back to plain text on the SAME pinned model for
  // a CLI without JSON output. THE PROMPT COMES BEFORE --tools: `--tools` is variadic and would
  // swallow a following positional whole (verified live, 2026-07-17).
  const modelArgs = model ? ['--model', model] : [];
  const schemaArgs = schema ? ['--json-schema', schema] : [];
  const attempts: { args: string[]; json: boolean }[] = [
    { args: ['-p', '--output-format', 'json', ...modelArgs, ...schemaArgs, input, ...TOOLLESS_ARGS], json: true },
    { args: ['-p', ...modelArgs, input, ...TOOLLESS_ARGS], json: false },
  ];

  for (const { args, json } of attempts) {
    try {
      const out = execFileSync(bin, args, {
        encoding: 'utf8',
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
