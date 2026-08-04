/**
 * STOPWATCH — the instrument that did not exist (C8).
 *
 * The cold-start spec's confession: "we optimized the ledger and never timed anything." Phase 0
 * timed one afternoon by hand; this makes the measuring permanent. Per-turn, per-stage, per-run
 * wall-clock, recorded in state.json — so the door's "about «Y» minutes", the read's live ETA,
 * and `status`'s progress math (Phase 3) all derive from THIS machine's measured rates, never a
 * typed number. Recording is best-effort and free; the math is pure and tested from fixtures.
 *
 * The honesty rule carried through: a stage with zero units contributes wall-clock but no RATE
 * (nothing was processed, so it teaches nothing about speed), and an ETA over a stage with no
 * measured rate is `undefined`, not a guess — quotes display measured numbers only (spec C8).
 */
import { readState, writeState, type RunRecord, type StageRecord, type TurnStats } from './state.js';

/** How many runs the ring keeps. Enough to smooth variance; never an unbounded ledger. */
export const STOPWATCH_KEEP = 20;

/** Summarize a stage's raw per-turn wall-clocks into the stats the record keeps. Pure. */
export function summarizeTurns(turnsMs: number[]): TurnStats | undefined {
  const clean = turnsMs.filter((t) => Number.isFinite(t) && t >= 0);
  if (!clean.length) return undefined;
  const sorted = [...clean].sort((a, b) => a - b);
  const mean = sorted.reduce((n, t) => n + t, 0) / sorted.length;
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(0.9 * sorted.length))];
  return { count: sorted.length, meanMs: Math.round(mean), p90Ms: Math.round(p90) };
}

/** Append a run to the ring, newest last, bounded. Pure; exported for tests. */
export function appendRun(runs: RunRecord[] | undefined, run: RunRecord, keep: number = STOPWATCH_KEEP): RunRecord[] {
  return [...(runs ?? []), run].slice(-keep);
}

/**
 * Per-stage rates from the recorded runs: total wall over total units, ms per unit. Only stages
 * that actually processed units contribute — a rate is a measurement, never a default.
 */
export function stageRates(runs: RunRecord[]): Record<string, number> {
  const totals = new Map<string, { ms: number; units: number }>();
  for (const run of runs) {
    for (const s of run.stages) {
      if (!(s.units > 0) || !(s.ms >= 0)) continue;
      const t = totals.get(s.stage) ?? { ms: 0, units: 0 };
      t.ms += s.ms;
      t.units += s.units;
      totals.set(s.stage, t);
    }
  }
  const rates: Record<string, number> = {};
  for (const [stage, t] of totals) if (t.units > 0) rates[stage] = t.ms / t.units;
  return rates;
}

/**
 * The ETA for a batch of work, from measured rates: sum over stages of units × ms/unit. Returns
 * undefined when ANY requested stage has no measured rate — an ETA that quietly skipped a stage
 * would be a confident underquote, and quotes display measured numbers only.
 */
export function etaMs(rates: Record<string, number>, counts: Record<string, number>): number | undefined {
  let total = 0;
  for (const [stage, units] of Object.entries(counts)) {
    if (!(units >= 0)) return undefined;
    if (units === 0) continue; // no work in this stage — nothing to estimate, nothing unknown
    const rate = rates[stage];
    if (rate === undefined) return undefined; // unmeasured stage — refuse the guess
    total += units * rate;
  }
  return Math.round(total);
}

/** A running run-record builder — start it, mark stages, then persist once. Timing must never
 *  change behavior, so `record` swallows everything. */
export interface Stopwatch {
  /** time one stage by wrapping its execution window: call stage() right after the work with its wall + units */
  stage(name: string, ms: number, units: number, turnsMs?: number[]): void;
  /** persist the run into state.json's bounded ring (merges — never drops the rest of the state) */
  record(): void;
}

export function startRun(now: Date = new Date()): Stopwatch {
  const startedAt = now.toISOString();
  const t0 = Date.now();
  const stages: StageRecord[] = [];
  return {
    stage(name: string, ms: number, units: number, turnsMs?: number[]): void {
      const rec: StageRecord = { stage: name, ms: Math.max(0, Math.round(ms)), units: Math.max(0, Math.round(units)) };
      const turns = turnsMs ? summarizeTurns(turnsMs) : undefined;
      if (turns) rec.turns = turns;
      stages.push(rec);
    },
    record(): void {
      try {
        const state = readState();
        const run: RunRecord = { at: startedAt, totalMs: Date.now() - t0, stages };
        writeState({ ...state, stopwatch: appendRun(state.stopwatch, run) });
      } catch {
        /* the stopwatch must never break the pipeline it measures */
      }
    },
  };
}
