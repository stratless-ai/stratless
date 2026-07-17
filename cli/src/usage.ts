/**
 * USAGE — a running tally of what the borrowed `claude` has cost.
 *
 * stratless spends the person's own plan, never a separate bill. `status` shows the total so the
 * "least wasteful" claim is checkable, not asserted. Recording is BEST-EFFORT: it must never throw
 * into a judge call, and a missing or corrupt file just reads as zero.
 *
 * v2 (0.2.4): the ledger now records the WHOLE token story. Every borrowed call carries ~17–24k
 * tokens of Claude Code harness overhead, and it arrives as cache-creation / cache-read tokens —
 * which v1 silently dropped, so the meter showed 484 input tokens where reality was over a million.
 * v2 keeps them, plus per-feature (judge vs synthesis) and per-model buckets, so the number backing
 * the "least wasteful" pitch is true. A v1 file reads cleanly: missing fields are zero, missing
 * buckets are empty — the tally is never lost on upgrade.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFileSync } from './atomic.js';

/** Where the tally lives. Override with STRATLESS_USAGE (tests). */
function usagePath(): string {
  return process.env.STRATLESS_USAGE || join(homedir(), '.stratless', 'usage.json');
}

/** One bucket of accumulated borrowed-call cost. */
export interface Tally {
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** calls that returned WITHOUT a receipt (the plain-text rung) — counted, never faked as zero-cost (C11) */
  unmeteredCalls: number;
  /** calls where a requested model pin was dropped and the account default ran instead (C11) */
  pinEscapedCalls: number;
}

export interface UsageTotals extends Tally {
  /** which pipeline feature spent it ('judge' | 'synthesis') */
  byFeature: Record<string, Tally>;
  /** which model actually ran — ground truth from the CLI's own receipt, not what we requested */
  byModel: Record<string, Tally>;
}

/** What one borrowed call reports. All optional — record what we know, zero the rest. */
export interface CallCost {
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  /** this call has no receipt — its true cost is invisible to the meter (C11) */
  unmetered?: boolean;
  /** this call dropped its requested model pin and ran on the account default (C11) */
  pinEscaped?: boolean;
}

const num = (v: unknown): number => Number(v) || 0;

const zeroTally = (): Tally => ({
  calls: 0,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  unmeteredCalls: 0,
  pinEscapedCalls: 0,
});

/** Coerce whatever is on disk into a sound Tally — an older file's missing fields read as zero. */
function readTally(u: Partial<Tally> | undefined): Tally {
  return {
    calls: num(u?.calls),
    costUsd: num(u?.costUsd),
    inputTokens: num(u?.inputTokens),
    outputTokens: num(u?.outputTokens),
    cacheCreationTokens: num(u?.cacheCreationTokens),
    cacheReadTokens: num(u?.cacheReadTokens),
    unmeteredCalls: num(u?.unmeteredCalls),
    pinEscapedCalls: num(u?.pinEscapedCalls),
  };
}

function readBuckets(m: unknown): Record<string, Tally> {
  const out: Record<string, Tally> = {};
  if (m && typeof m === 'object') {
    for (const [k, v] of Object.entries(m as Record<string, Partial<Tally>>)) out[k] = readTally(v);
  }
  return out;
}

/** The running total. A missing or corrupt file reads as zero and never throws. */
export function readUsage(file: string = usagePath()): UsageTotals {
  try {
    if (!existsSync(file)) return { ...zeroTally(), byFeature: {}, byModel: {} };
    const u = JSON.parse(readFileSync(file, 'utf8')) as Partial<UsageTotals>;
    return { ...readTally(u), byFeature: readBuckets(u.byFeature), byModel: readBuckets(u.byModel) };
  } catch {
    return { ...zeroTally(), byFeature: {}, byModel: {} };
  }
}

function add(t: Tally, d: CallCost): void {
  t.calls += 1;
  t.costUsd += num(d.costUsd);
  t.inputTokens += num(d.inputTokens);
  t.outputTokens += num(d.outputTokens);
  t.cacheCreationTokens += num(d.cacheCreationTokens);
  t.cacheReadTokens += num(d.cacheReadTokens);
  if (d.unmetered) t.unmeteredCalls += 1;
  if (d.pinEscaped) t.pinEscapedCalls += 1;
}

/** Add one borrowed call to the running total. Best-effort: never throws into the caller. */
export function recordUsage(
  delta: CallCost & { feature?: string; byModel?: Record<string, CallCost> },
  file: string = usagePath(),
): void {
  try {
    const t = readUsage(file);
    add(t, delta);
    if (delta.feature) add((t.byFeature[delta.feature] ??= zeroTally()), delta);
    for (const [model, d] of Object.entries(delta.byModel ?? {})) add((t.byModel[model] ??= zeroTally()), d);
    atomicWriteFileSync(file, `${JSON.stringify(t)}\n`);
  } catch {
    /* usage is a nicety; never break a judge over it */
  }
}
