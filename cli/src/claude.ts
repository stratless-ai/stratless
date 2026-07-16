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
import { recordUsage, type CallCost } from './usage.js';

/** Is a binary on PATH? (Also guards `init --auto`: a hook that runs `stratless` needs it findable.) */
export function onPath(bin: string): boolean {
  try {
    execFileSync('which', [bin], { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/** Is a borrowable assistant CLI on PATH? (No API key — we ride the one you already have.) */
export function findAssistant(): string | undefined {
  for (const bin of ['claude']) if (onPath(bin)) return bin;
  return undefined;
}

/**
 * Ask the person's own assistant one thing, in --print mode. Returns undefined if it can't answer.
 *
 * `model` names an alias (e.g. haiku, sonnet) tried first, falling back to their default if the
 * alias isn't recognised; omit it to run on their default straight away. `feature` labels the call
 * for the usage ledger ('judge', 'synthesis') so `status` can show WHERE the spend went, not just
 * its total.
 */
export function runClaude(bin: string, input: string, model?: string, feature?: string): string | undefined {
  // Prefer JSON so we can record what the borrowed call cost (see `status`); fall back to plain text,
  // and to the default model, so an older `claude`, or one whose JSON we can't parse, still answers.
  const modelArgs = model ? ['--model', model] : [];
  const attempts: { args: string[]; json: boolean }[] = [
    { args: ['-p', '--output-format', 'json', ...modelArgs, input], json: true },
    { args: ['-p', ...modelArgs, input], json: false },
  ];
  if (model) {
    // …and if the alias isn't recognised, the same two on the default model.
    attempts.push({ args: ['-p', '--output-format', 'json', input], json: true });
    attempts.push({ args: ['-p', input], json: false });
  }

  for (const { args, json } of attempts) {
    try {
      const out = execFileSync(bin, args, {
        encoding: 'utf8',
        timeout: 120_000, // the CLI has real startup cost; 60s silently degraded every call
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 8 * 1024 * 1024, // JSON carries metadata on top of the text — give it room
      }).trim();
      if (!out) continue;
      if (!json) {
        recordUsage({ feature }); // the plain-text path has no receipt, but the call still counts
        return out;
      }
      const parsed = parseJsonResult(out);
      if (!parsed) continue; // unparseable JSON — try the plain-text attempt instead
      recordUsage({ ...parsed.usage, feature }); // best-effort; never throws
      return parsed.result;
    } catch {
      /* try the next attempt; if all fail the caller degrades to silence */
    }
  }
  return undefined;
}

interface ParsedResult {
  result: string;
  usage: CallCost & { byModel?: Record<string, CallCost> };
}

/**
 * Parse `claude -p --output-format json`. Returns undefined unless it's the shape we expect.
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
