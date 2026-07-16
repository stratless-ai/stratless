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
import { recordUsage } from './usage.js';

/** Is a borrowable assistant CLI on PATH? (No API key — we ride the one you already have.) */
export function findAssistant(): string | undefined {
  for (const bin of ['claude']) {
    try {
      execFileSync('which', [bin], { stdio: ['ignore', 'pipe', 'ignore'] });
      return bin;
    } catch {
      /* not installed — try the next */
    }
  }
  return undefined;
}

/**
 * Ask the person's own assistant one thing, in --print mode. Returns undefined if it can't answer.
 *
 * `model` names a small, cheap alias (e.g. haiku) tried first, falling back to their default if the
 * alias isn't recognised. Omit it — as the synthesizer does — to run on their default straight away,
 * because reading the shape of a person is subtle work a small model does worse.
 */
export function runClaude(bin: string, input: string, model?: string): string | undefined {
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
      if (!json) return out;
      const parsed = parseJsonResult(out);
      if (!parsed) continue; // unparseable JSON — try the plain-text attempt instead
      recordUsage(parsed.usage); // best-effort; never throws
      return parsed.result;
    } catch {
      /* try the next attempt; if all fail the caller degrades to silence */
    }
  }
  return undefined;
}

interface ParsedResult {
  result: string;
  usage: { costUsd?: number; inputTokens?: number; outputTokens?: number };
}

/** Parse `claude -p --output-format json`. Returns undefined unless it's the shape we expect. */
function parseJsonResult(raw: string): ParsedResult | undefined {
  try {
    const o = JSON.parse(raw) as {
      result?: unknown;
      total_cost_usd?: unknown;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };
    const result = typeof o.result === 'string' ? o.result.trim() : '';
    if (!result) return undefined;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    return {
      result,
      usage: {
        costUsd: num(o.total_cost_usd),
        inputTokens: num(o.usage?.input_tokens),
        outputTokens: num(o.usage?.output_tokens),
      },
    };
  } catch {
    return undefined;
  }
}
