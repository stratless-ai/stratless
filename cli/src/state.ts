/**
 * STATE — stratless's own tiny memory between runs.
 *
 * One JSON file recording when the profile was last SYNTHESIZED and how many judgments existed at
 * that moment. `update` reads it to decide whether a rebuild is due — the synthesis is the expensive
 * read (~32 judge calls' worth, measured 2026-07-16), so sessions accumulate judgments and the
 * profile consumes them in batches. Missing or corrupt state reads as "never synthesized", which
 * fails OPEN: one possibly-unneeded synthesis, never a stuck-stale profile.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFileSync } from './atomic.js';

/** Where the state lives. Override with STRATLESS_STATE (tests). */
function statePath(): string {
  return process.env.STRATLESS_STATE || join(homedir(), '.stratless', 'state.json');
}

/** The gate default: a rebuild is due after this many fresh judgments accumulate. */
export const SYNTH_EVERY = 25;

/**
 * The backstop: even under the gate, a profile older than this refreshes if ANYTHING new arrived —
 * a light user (a few exchanges a week) must not sit on a weeks-stale profile just because they
 * never reach the gate. Time alone never triggers it: no new evidence = the same profile, so skip.
 */
export const SYNTH_MAX_AGE_DAYS = 7;

// ── the stopwatch's shapes (C8) — declared here so state.ts owns everything it persists ────────

/** The distribution of one stage's per-turn wall-clocks — mean and tail, never just an average. */
export interface TurnStats {
  count: number;
  meanMs: number;
  p90Ms: number;
}

/** One pipeline stage's wall-clock for one run. `units` is what the stage processed (fresh
 *  verdicts, assigned judgments, model calls…) so a per-unit rate can be derived; 0 units means
 *  the wall is recorded but no rate is (a stage that did nothing teaches nothing about speed). */
export interface StageRecord {
  stage: string;
  ms: number;
  units: number;
  turns?: TurnStats;
}

/** One run's complete timing record. */
export interface RunRecord {
  at: string;
  totalMs: number;
  stages: StageRecord[];
}

export interface SynthState {
  /** ISO timestamp of the last synthesis; absent if there has never been one */
  lastSynthesisAt?: string;
  /** how many judgments were cached at that moment */
  judgmentsAtLastSynthesis?: number;
  /** the judge's view sizes fitted to this user's window (0.3.0) — recorded for visibility */
  aperture?: { prompt: number; said: number; reaction: number; computedAt: string };
  /** the stopwatch (C8): the last runs' measured walls — every ETA and quote derives from these */
  stopwatch?: RunRecord[];
  /** the last build's scoreboard rate (corrections per 100 messages), for the next build's delta —
   *  "corrections: 5.2 per 100 messages (was 6.1 last build)". The one number the person watches. */
  scoreboard?: { rate: number; at: string };
  /** when discover last ran — the re-discovery cooldown reads it so a high misfit can't re-mint every run */
  lastDiscoverAt?: string;
  /** when the worker last flushed (tagged + rebuilt) — the flush ceiling ([[flushDue]]) measures from here */
  lastFlushAt?: string;
}

/** Read the state. Missing or corrupt reads as never-synthesized and never throws. */
export function readState(file: string = statePath()): SynthState {
  try {
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<SynthState>;
    const out: SynthState = {};
    if (typeof raw.lastSynthesisAt === 'string') out.lastSynthesisAt = raw.lastSynthesisAt;
    const n = Number(raw.judgmentsAtLastSynthesis);
    if (Number.isFinite(n) && n >= 0) out.judgmentsAtLastSynthesis = n;
    const a = raw.aperture;
    if (
      a &&
      typeof a === 'object' &&
      Number.isFinite(Number(a.prompt)) &&
      Number.isFinite(Number(a.said)) &&
      Number.isFinite(Number(a.reaction)) &&
      typeof a.computedAt === 'string'
    ) {
      out.aperture = { prompt: Number(a.prompt), said: Number(a.said), reaction: Number(a.reaction), computedAt: a.computedAt };
    }
    const runs = validRuns(raw.stopwatch);
    if (runs.length) out.stopwatch = runs;
    const sb = raw.scoreboard;
    if (sb && typeof sb === 'object' && Number.isFinite(Number(sb.rate)) && typeof sb.at === 'string') {
      out.scoreboard = { rate: Number(sb.rate), at: sb.at };
    }
    if (typeof raw.lastDiscoverAt === 'string') out.lastDiscoverAt = raw.lastDiscoverAt;
    if (typeof raw.lastFlushAt === 'string') out.lastFlushAt = raw.lastFlushAt;
    return out;
  } catch {
    return {}; // fails open — one extra synthesis, never a crash
  }
}

/** Keep only well-formed run records — a malformed one is dropped, never a crash or a wrong rate. */
function validRuns(raw: unknown): RunRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: RunRecord[] = [];
  for (const r of raw as Partial<RunRecord>[]) {
    if (!r || typeof r.at !== 'string' || !Number.isFinite(Number(r.totalMs)) || !Array.isArray(r.stages)) continue;
    const stages: StageRecord[] = [];
    for (const s of r.stages as Partial<StageRecord>[]) {
      if (!s || typeof s.stage !== 'string' || !Number.isFinite(Number(s.ms)) || !Number.isFinite(Number(s.units))) continue;
      const st: StageRecord = { stage: s.stage, ms: Number(s.ms), units: Number(s.units) };
      const t = s.turns;
      if (t && Number.isFinite(Number(t.count)) && Number.isFinite(Number(t.meanMs)) && Number.isFinite(Number(t.p90Ms))) {
        st.turns = { count: Number(t.count), meanMs: Number(t.meanMs), p90Ms: Number(t.p90Ms) };
      }
      stages.push(st);
    }
    out.push({ at: r.at, totalMs: Number(r.totalMs), stages });
  }
  return out;
}

/** Write the state atomically (C2). Best-effort on failure: the old state survives on disk and
 *  costs one extra synthesis next run, nothing more. */
export function writeState(s: SynthState, file: string = statePath()): void {
  try {
    atomicWriteFileSync(file, `${JSON.stringify(s)}\n`);
  } catch {
    /* best-effort by design */
  }
}

// ── the render sidecar (the polish release): looking is free, and the header stays honest ──────

/** What one cached rendering knows about its own build — the header's numbers come from the
 *  BUILD, never recomputed at print time (numbers computed, never typed — and never faked). */
export interface RenderMeta {
  builtAt: string;
  sessions: number;
  exchanges: number;
}

export interface Renders {
  profile?: RenderMeta;
  report?: RenderMeta;
}

/** Where the sidecar lives. Override with STRATLESS_RENDERS (tests). */
const rendersPath = (): string => process.env.STRATLESS_RENDERS || join(homedir(), '.stratless', 'renders.json');

/** Missing or corrupt reads as no-cached-renderings — the look falls back to a build. */
export function readRenders(file: string = rendersPath()): Renders {
  try {
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Record<'profile' | 'report', Partial<RenderMeta>>>;
    const out: Renders = {};
    for (const k of ['profile', 'report'] as const) {
      const m = raw[k];
      if (m && typeof m.builtAt === 'string' && Number.isFinite(Number(m.sessions)) && Number.isFinite(Number(m.exchanges))) {
        out[k] = { builtAt: m.builtAt, sessions: Number(m.sessions), exchanges: Number(m.exchanges) };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Record one rendering's build facts. Best-effort — a lost sidecar costs one rebuild, never a lie. */
export function writeRender(kind: 'profile' | 'report', meta: RenderMeta, file: string = rendersPath()): void {
  try {
    const all = readRenders(file);
    all[kind] = meta;
    atomicWriteFileSync(file, `${JSON.stringify(all)}\n`);
  } catch {
    /* best-effort by design */
  }
}

// ── the frozen corpus (report folded into `profile --read`, lazy) ───────────────────────────────

/**
 * The frozen corpus of the last profile build — everything `profile --read` needs to render the
 * human-facing note over EXACTLY the evidence the loaded profile saw, never a fresh re-read. That
 * is the whole fix: `report` used to build separately and describe a different window than the
 * loaded profile. `builtAt` matches the profile render's `builtAt` — the single staleness key: a
 * cached read is fresh iff its stamp equals the current profile build's.
 */
export interface BuildCorpus {
  builtAt: string;
  corpus: { sessions: number; exchanges: number; projects?: string[]; from?: string; to?: string };
  /** the signal judgments' content hashes — reloaded from the cache at read time, never re-judged */
  signalHashes: string[];
}

/** Where the frozen corpus lives. Override with STRATLESS_BUILD (tests). */
const buildCorpusPath = (): string => process.env.STRATLESS_BUILD || join(homedir(), '.stratless', 'build.json');

/** Missing or corrupt reads as no-frozen-corpus — `--read` then guides to a rebuild, never lies. */
export function readBuildCorpus(file: string = buildCorpusPath()): BuildCorpus | undefined {
  try {
    if (!existsSync(file)) return undefined;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<BuildCorpus>;
    const c = raw.corpus as Partial<BuildCorpus['corpus']> | undefined;
    if (typeof raw.builtAt !== 'string' || !c || !Array.isArray(raw.signalHashes)) return undefined;
    if (!Number.isFinite(Number(c.sessions)) || !Number.isFinite(Number(c.exchanges))) return undefined;
    return {
      builtAt: raw.builtAt,
      corpus: {
        sessions: Number(c.sessions),
        exchanges: Number(c.exchanges),
        ...(Array.isArray(c.projects) ? { projects: c.projects.filter((t): t is string => typeof t === 'string') } : {}),
        ...(typeof c.from === 'string' ? { from: c.from } : {}),
        ...(typeof c.to === 'string' ? { to: c.to } : {}),
      },
      signalHashes: raw.signalHashes.filter((h): h is string => typeof h === 'string'),
    };
  } catch {
    return undefined;
  }
}

/** Freeze the build's corpus atomically. Best-effort — a lost sidecar costs one `--read` rebuild. */
export function writeBuildCorpus(b: BuildCorpus, file: string = buildCorpusPath()): void {
  try {
    atomicWriteFileSync(file, `${JSON.stringify(b)}\n`);
  } catch {
    /* best-effort by design */
  }
}

export interface GateDecision {
  due: boolean;
  /** the honest one-phrase why, for the receipt ('' when not due) */
  reason: string;
  /** fresh judgments since the last synthesis — the progress toward the gate */
  newSince: number;
}

/**
 * Is a synthesis due? Pure — all inputs passed in, so the whole gate is unit-testable.
 *
 * Due when: there has never been a build · the judgment count went BACKWARDS (the cache was reset —
 * rebuild rather than trust a stale portrait of a pile that no longer exists) · K new judgments
 * accumulated · or the profile is past the backstop age with anything new at all.
 */
export function synthesisDue(
  state: SynthState,
  judgedNow: number,
  now: Date,
  opts: { every?: number; maxAgeDays?: number } = {},
): GateDecision {
  const every = opts.every ?? SYNTH_EVERY;
  const maxAgeDays = opts.maxAgeDays ?? SYNTH_MAX_AGE_DAYS;

  if (!state.lastSynthesisAt) return { due: true, reason: 'first build', newSince: judgedNow };

  const at = state.judgmentsAtLastSynthesis ?? 0;
  if (judgedNow < at) return { due: true, reason: 'judgment cache was reset', newSince: judgedNow };

  const newSince = judgedNow - at;
  if (newSince >= every) return { due: true, reason: `${newSince} new judgments`, newSince };

  const ageMs = now.getTime() - new Date(state.lastSynthesisAt).getTime();
  if (Number.isFinite(ageMs) && ageMs > maxAgeDays * 24 * 3600 * 1000 && newSince > 0) {
    return { due: true, reason: `profile ${Math.floor(ageMs / 86_400_000)} days old`, newSince };
  }

  return { due: false, reason: '', newSince };
}

// ── the flush gate (the per-turn-rebuild fix) ───────────────────────────────────────────────────

/**
 * The flush ceiling — the "left-open safety net". Leftover moments below a session boundary still
 * flush once they have waited this long, so a session held open all day does not sit stale. Checked
 * at nudge time, never on a clock: there is no daemon to wake. Override with STRATLESS_FLUSH_MAX_AGE_MS.
 */
export const FLUSH_MAX_AGE_MS = 24 * 3600 * 1000;

export interface FlushDecision {
  flush: boolean;
  /** the honest one-phrase why, for the progress frame ('' when not flushing) */
  reason: string;
}

/**
 * Should the worker flush now — tag the waiting moments, count, rebuild the profile — or just leave
 * them collected for later? Pure, so the whole gate is unit-testable. Collecting is free and happens
 * every nudge regardless; this decides only whether to PHONE THE ASSISTANT this run.
 *
 * Flush when: the run is MANUAL (`stratless update` typed by hand — it beats every automatic gate) ·
 * a waiting moment belongs to a session that is NOT the current one (a previous session ended, catch
 * up on its leftovers) · or anything has waited past the ceiling (a session left open all day).
 * Otherwise collect and wait, and a mid-session nudge costs nothing.
 *
 * `waiting` is the un-tagged moments; the newest by `ts` names the active session. Empty and not
 * manual is never a flush (nothing to do). Never-flushed-before with anything waiting flushes once,
 * to set the baseline the ceiling measures from — and an unreadable stamp fails OPEN (flush), the
 * same posture as the rest of state.
 */
export function flushDue(
  waiting: { session: string; ts: string }[],
  lastFlushAt: string | undefined,
  now: number,
  manual: boolean,
  opts: { maxAgeMs?: number } = {},
): FlushDecision {
  if (manual) return { flush: true, reason: 'you asked' };
  if (!waiting.length) return { flush: false, reason: '' };

  const maxAgeMs = opts.maxAgeMs ?? FLUSH_MAX_AGE_MS;

  // The active session is the most recent waiting moment's; a waiting moment from any other session
  // is a finished session's leftover.
  let active = waiting[0];
  for (const w of waiting) if (Date.parse(w.ts) > Date.parse(active.ts)) active = w;
  if (waiting.some((w) => w.session !== active.session)) return { flush: true, reason: 'a session ended' };

  const ageMs = lastFlushAt ? now - Date.parse(lastFlushAt) : Infinity;
  if (!(ageMs <= maxAgeMs)) return { flush: true, reason: lastFlushAt ? 'over the flush ceiling' : 'first flush' };

  return { flush: false, reason: '' };
}
