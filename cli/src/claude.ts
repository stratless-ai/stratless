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
  const attempts = model ? [['-p', '--model', model, input], ['-p', input]] : [['-p', input]];
  for (const args of attempts) {
    try {
      const out = execFileSync(bin, args, {
        encoding: 'utf8',
        timeout: 120_000, // the CLI has real startup cost; 60s silently degraded every call
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 4 * 1024 * 1024,
      }).trim();
      if (out) return out;
    } catch {
      /* try the fallback; if all fail the caller degrades to silence */
    }
  }
  return undefined;
}
