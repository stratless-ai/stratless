/**
 * USAGE — a running tally of what the borrowed `claude` has cost.
 *
 * stratless spends the person's own plan, never a separate bill. `status` shows the total so the
 * "least wasteful" claim is checkable, not asserted. Recording is BEST-EFFORT: it must never throw
 * into a judge call, and a missing or corrupt file just reads as zero.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Where the tally lives. Override with STRATLESS_USAGE (tests). */
function usagePath(): string {
  return process.env.STRATLESS_USAGE || join(homedir(), '.stratless', 'usage.json');
}

export interface UsageTotals {
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

const ZERO: UsageTotals = { calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 };

/** The running total. A missing or corrupt file reads as zero and never throws. */
export function readUsage(file: string = usagePath()): UsageTotals {
  try {
    if (!existsSync(file)) return { ...ZERO };
    const u = JSON.parse(readFileSync(file, 'utf8')) as Partial<UsageTotals>;
    return {
      calls: Number(u.calls) || 0,
      costUsd: Number(u.costUsd) || 0,
      inputTokens: Number(u.inputTokens) || 0,
      outputTokens: Number(u.outputTokens) || 0,
    };
  } catch {
    return { ...ZERO };
  }
}

/** Add one borrowed call to the running total. Best-effort: never throws into the caller. */
export function recordUsage(
  delta: { costUsd?: number; inputTokens?: number; outputTokens?: number },
  file: string = usagePath(),
): void {
  try {
    const t = readUsage(file);
    const next: UsageTotals = {
      calls: t.calls + 1,
      costUsd: t.costUsd + (Number(delta.costUsd) || 0),
      inputTokens: t.inputTokens + (Number(delta.inputTokens) || 0),
      outputTokens: t.outputTokens + (Number(delta.outputTokens) || 0),
    };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(next)}\n`);
  } catch {
    /* usage is a nicety; never break a judge over it */
  }
}
