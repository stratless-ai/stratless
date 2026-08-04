/**
 * STATE — stratless's own tiny memory between runs.
 *
 * One JSON file recording when the profile was last flushed and the person's chosen cadence, so
 * the worker can decide whether a rebuild is due. Missing or corrupt state reads as "never
 * flushed", which fails OPEN: one possibly-unneeded rebuild, never a stuck-stale profile.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFileSync } from './atomic.js';

/** Where the state lives. Override with STRATLESS_STATE (tests). */
function statePath(): string {
  return process.env.STRATLESS_STATE || join(homedir(), '.stratless', 'state.json');
}

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
  /** the stopwatch (C8): the last runs' measured walls — every ETA and quote derives from these */
  stopwatch?: RunRecord[];
  /** the last build's scoreboard rate — the WIDER distress read (~13/100). RECORDED, never shown: the
   *  one user-facing friction number is the mirror's course-corrections rate (`mirror` + the door), so
   *  two near-identical "per 100" figures never collide on screen. Kept for the record / later use. */
  /** the wider distress rate, PER RECORD — measured inside one pair, never summed across two.
   *  Recorded for the record only; nothing prints it (the mirror's number is the user-facing one). */
  scoreboards?: Record<string, { rate: number; at: string }>;
  /** when the worker last flushed (tagged + rebuilt) — the flush ceiling ([[flushDue]]) measures from here */
  lastFlushAt?: string;
  /** a CONSENTED cold-start build is pending. Set only by a consented interactive invocation (the
   *  door's yes, or a typed `update` on a fresh machine); consumed by whichever worker wins the lock.
   *  Durable on purpose: consent must survive a lock race or a killed process, never live only in one
   *  worker's env. Its presence always traces to an explicit yes, so it can never cause surprise spend. */
  buildRequestedAt?: string;
  /** STANDING consent for young-map rebuilds (the growth trigger, 0.11.0): a pair whose history has
   *  outgrown its first map may be rebuilt by the background worker — cents, announced, never asked
   *  again. Stamped by any flushing run (a typed `update`, or the door's yes), because those are the
   *  surfaces whose copy says this out loud. Standing, never consumed — unlike `buildRequestedAt`,
   *  which covers exactly one cold start. A background hook never sets it. */
  growthConsentedAt?: string;
  /** how often the worker may auto-rebuild on its own — set with `stratless update --daily|--weekly`.
   *  Absent = weekly, the default. `stratless update` always rebuilds now regardless of this. */
  flushCadence?: FlushCadence;
}

/** Read the state. Missing or corrupt reads as never-synthesized and never throws. */
export function readState(file: string = statePath()): SynthState {
  try {
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<SynthState>;
    const out: SynthState = {};
    const runs = validRuns(raw.stopwatch);
    if (runs.length) out.stopwatch = runs;
    const sbs = raw.scoreboards;
    if (sbs && typeof sbs === 'object') {
      const clean: Record<string, { rate: number; at: string }> = {};
      for (const [k, v] of Object.entries(sbs)) {
        if (v && typeof v === 'object' && Number.isFinite(Number(v.rate)) && typeof v.at === 'string') {
          clean[k] = { rate: Number(v.rate), at: v.at };
        }
      }
      if (Object.keys(clean).length) out.scoreboards = clean;
    }
    if (typeof raw.lastFlushAt === 'string') out.lastFlushAt = raw.lastFlushAt;
    if (typeof raw.buildRequestedAt === 'string') out.buildRequestedAt = raw.buildRequestedAt;
    if (typeof raw.growthConsentedAt === 'string') out.growthConsentedAt = raw.growthConsentedAt;
    if (raw.flushCadence === 'daily' || raw.flushCadence === 'weekly') out.flushCadence = raw.flushCadence;
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

// ── the durable cold-start consent flag ────────────────────────────────────────────────────────
// A consented cold-start build (the ~$16 one) records its consent HERE, not just in the spawned
// worker's env — so a lock race or a killed process can never drop it. Whichever worker reaches the
// cold-start branch honors it; a background hook never sets it, so it can never manufacture consent.

/** Record that a consented cold-start build is pending. */
export function requestColdBuild(file: string = statePath()): void {
  writeState({ ...readState(file), buildRequestedAt: new Date().toISOString() }, file);
}

/** Is a consented cold-start build pending? */
export function coldBuildRequested(file: string = statePath()): boolean {
  return !!readState(file).buildRequestedAt;
}

/** Consume the pending-build consent (the build has been taken up). */
export function clearColdBuildRequest(file: string = statePath()): void {
  const s = readState(file);
  delete s.buildRequestedAt;
  writeState(s, file);
}

// ── the standing growth consent (the young trigger, 0.11.0) ────────────────────────────────────
// One consent covers every young-map rebuild: the flushing surfaces (`update` in a terminal, the
// door's yes) say "while this history is young I'll rebuild the map as it grows — cents each",
// and stamping here is what makes that true for the background worker afterwards. Standing by
// design: the trigger is self-damping (each fire doubles the next fire's distance), so this can
// never authorize unbounded spend.

/** Record the standing consent for young-map rebuilds. Idempotent; keeps the first stamp. */
export function recordGrowthConsent(file: string = statePath()): void {
  const s = readState(file);
  if (s.growthConsentedAt) return;
  writeState({ ...s, growthConsentedAt: new Date().toISOString() }, file);
}

/** May the background worker rebuild an outgrown young map? */
export function growthConsented(file: string = statePath()): boolean {
  return !!readState(file).growthConsentedAt;
}

// ── the render sidecar (the polish release): looking is free, and the header stays honest ──────

/** What one cached rendering knows about its own build — the header's numbers come from the
 *  BUILD, never recomputed at print time (numbers computed, never typed — and never faked). */
export interface RenderMeta {
  builtAt: string;
  sessions: number;
  exchanges: number;
  /** how many categories the build minted — the trajectory shows it growing (added 0.4.0). */
  categories?: number;
  /**
   * WHICH BRAIN WORDED THIS BUILD (added 0.9.x). Absent on every build before it, which is why it
   * is optional and why nothing may infer a voice from silence.
   *
   * The profile is written in a borrowed model's voice, so a change of brain is a change of wording
   * with no other visible cause — the same class of drift the voicer is already watched for. Naming
   * it here makes "why does this read differently" answerable from the artifact instead of guessed.
   */
  brain?: string;
}

export interface Renders {
  /** LEGACY, merged-era: the single profile slot and its history. Read for the interim between an
   *  upgrade and the first per-record rebuild — status can still say what the old build was —
   *  never written again. */
  profile?: RenderMeta;
  report?: RenderMeta;
  history?: RenderMeta[];
  /** One build record per RECORD — each pair rebuilds on its own clock, so "latest" is only
   *  meaningful within one record's history, never across the machine. */
  profiles?: Record<string, RenderMeta>;
  histories?: Record<string, RenderMeta[]>;
}

/** Where the sidecar lives. Override with STRATLESS_RENDERS (tests). */
const rendersPath = (): string => process.env.STRATLESS_RENDERS || join(homedir(), '.stratless', 'renders.json');

/** Missing or corrupt reads as no-cached-renderings — the look falls back to a build. */
/** Parse one render entry, or undefined if it is missing the load-bearing fields. `categories` is
 *  optional (absent on a build written before 0.4.0) so an old sidecar still reads clean. */
function readOneRender(m: Partial<RenderMeta> | undefined): RenderMeta | undefined {
  if (!m || typeof m.builtAt !== 'string' || !Number.isFinite(Number(m.sessions)) || !Number.isFinite(Number(m.exchanges))) return undefined;
  return {
    builtAt: m.builtAt,
    sessions: Number(m.sessions),
    exchanges: Number(m.exchanges),
    ...(Number.isFinite(Number(m.categories)) ? { categories: Number(m.categories) } : {}),
    ...(typeof m.brain === 'string' && m.brain ? { brain: m.brain } : {}),
  };
}

export function readRenders(file: string = rendersPath()): Renders {
  try {
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, 'utf8')) as {
      profile?: Partial<RenderMeta>;
      report?: Partial<RenderMeta>;
      history?: Partial<RenderMeta>[];
      profiles?: Record<string, Partial<RenderMeta>>;
      histories?: Record<string, Partial<RenderMeta>[]>;
    };
    const out: Renders = {};
    const p = readOneRender(raw.profile);
    if (p) out.profile = p;
    const r = readOneRender(raw.report);
    if (r) out.report = r;
    if (Array.isArray(raw.history)) {
      const h = raw.history.map(readOneRender).filter((m): m is RenderMeta => Boolean(m));
      if (h.length) out.history = h;
    }
    if (raw.profiles && typeof raw.profiles === 'object') {
      const clean: Record<string, RenderMeta> = {};
      for (const [k, v] of Object.entries(raw.profiles)) {
        const m = readOneRender(v);
        if (m) clean[k] = m;
      }
      if (Object.keys(clean).length) out.profiles = clean;
    }
    if (raw.histories && typeof raw.histories === 'object') {
      const clean: Record<string, RenderMeta[]> = {};
      for (const [k, v] of Object.entries(raw.histories)) {
        if (!Array.isArray(v)) continue;
        const h = v.map(readOneRender).filter((m): m is RenderMeta => Boolean(m));
        if (h.length) clean[k] = h;
      }
      if (Object.keys(clean).length) out.histories = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/** How many recent PROFILE builds the trajectory keeps. Five is enough to see a trend, small enough
 *  the sidecar stays a glance. */
const HISTORY_CAP = 5;

/** Record one rendering's build facts. Best-effort — a lost sidecar costs one rebuild, never a lie.
 *  A profile build also lands in `history` (newest first, deduped by stamp, capped) for the trajectory. */
export function writeRender(record: string, meta: RenderMeta, file: string = rendersPath()): void {
  try {
    const all = readRenders(file);
    all.profiles = { ...(all.profiles ?? {}), [record]: meta };
    const prior = (all.histories?.[record] ?? []).filter((b) => b.builtAt !== meta.builtAt);
    all.histories = { ...(all.histories ?? {}), [record]: [meta, ...prior].slice(0, HISTORY_CAP) };
    // The merged-era `profile`/`history` slots are never written again — they age in place as the
    // pre-upgrade record, which is exactly what status shows until the first per-record rebuild.
    atomicWriteFileSync(file, `${JSON.stringify(all)}\n`);
  } catch {
    /* best-effort by design */
  }
}

/** One record's latest build — legacy merged slot when the record has none yet. */
export function latestRender(r: Renders, record: string): RenderMeta | undefined {
  return r.profiles?.[record] ?? r.profile;
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

// ── the flush gate (the per-turn-rebuild fix) ───────────────────────────────────────────────────

/**
 * The COOLDOWN UNIT — one day in ms; the named cadences below are multiples of it. The pile
 * collects every turn for free; the cooldown only governs how often the worker re-tags and
 * rebuilds (usually $0 — wording is voiced once and re-stamped, voiced.ts). `stratless update`
 * bypasses it entirely. Checked at nudge time, never on a clock: there is no daemon to wake.
 * Override with STRATLESS_FLUSH_MAX_AGE_MS.
 */
export const FLUSH_MAX_AGE_MS = 24 * 3600 * 1000;

/** The named auto-rebuild cadences a person can choose; weekly is the default (a lighter background
 *  footprint for a privacy-first tool — `stratless update` still rebuilds now, any time). */
export const CADENCE_MS = { daily: FLUSH_MAX_AGE_MS, weekly: 7 * FLUSH_MAX_AGE_MS } as const;
export type FlushCadence = keyof typeof CADENCE_MS;

/** The effective cooldown in ms: the STRATLESS_FLUSH_MAX_AGE_MS env override (an exact number) wins,
 *  else the person's stored cadence, else weekly. One place so the loop and the tests agree. */
export function flushCooldownMs(
  cadence: FlushCadence | undefined,
  env: string | undefined = process.env.STRATLESS_FLUSH_MAX_AGE_MS,
): number {
  const n = Number(env);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return CADENCE_MS[cadence ?? 'weekly'];
}

/** Store the person's chosen auto-rebuild cadence. Best-effort, like the rest of state. */
export function setFlushCadence(cadence: FlushCadence, file: string = statePath()): void {
  writeState({ ...readState(file), flushCadence: cadence }, file);
}

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
 * Flush when: the run is MANUAL (`stratless update` typed by hand — it beats the cooldown) · or the
 * last flush was longer ago than the cooldown (the person's cadence — weekly by default).
 * Otherwise collect and wait. A finished session no longer forces a rebuild on its own: rebuilding on
 * every session boundary was near-identical work for cents each, and the profile barely moves between
 * sessions. Want it fresh now? `stratless update`.
 *
 * `waiting` is the un-tagged moments. Empty and not manual is never a flush (nothing to do).
 * Never-flushed-before with anything waiting flushes once, to set the baseline the cooldown measures
 * from — and an unreadable stamp fails OPEN (flush), the same posture as the rest of state.
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

  // A COOLDOWN, not a per-session trigger: auto-rebuild at most once per cadence interval (weekly
  // by default). A finished session no longer flushes on its own — rebuilding on every session
  // boundary was near-identical work for the same profile, which barely moves between sessions.
  // The pile still collects every turn for free; it just gets scored and written on the next
  // scheduled tick, or the instant you run `stratless update`.
  const cooldownMs = opts.maxAgeMs ?? FLUSH_MAX_AGE_MS;
  // A missing OR unreadable stamp fails OPEN (age = Infinity → flush), never wedges the profile shut.
  const last = lastFlushAt ? Date.parse(lastFlushAt) : NaN;
  const ageMs = Number.isNaN(last) ? Infinity : now - last;
  if (ageMs >= cooldownMs) return { flush: true, reason: Number.isNaN(last) ? 'first flush' : 'the scheduled rebuild' };

  return { flush: false, reason: '' };
}
