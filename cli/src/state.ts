/**
 * STATE — stratless's own tiny memory between runs.
 *
 * One JSON file recording when the profile was last SYNTHESIZED and how many judgments existed at
 * that moment. `update` reads it to decide whether a rebuild is due — the synthesis is the expensive
 * read (~32 judge calls' worth, measured 2026-07-16), so sessions accumulate judgments and the
 * profile consumes them in batches. Missing or corrupt state reads as "never synthesized", which
 * fails OPEN: one possibly-unneeded synthesis, never a stuck-stale profile.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

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

export interface SynthState {
  /** ISO timestamp of the last synthesis; absent if there has never been one */
  lastSynthesisAt?: string;
  /** how many judgments were cached at that moment */
  judgmentsAtLastSynthesis?: number;
  /** the judge's view sizes fitted to this user's window (0.3.0) — recorded for visibility */
  aperture?: { prompt: number; said: number; reaction: number; computedAt: string };
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
    return out;
  } catch {
    return {}; // fails open — one extra synthesis, never a crash
  }
}

/** Write the state. Best-effort: a failed write costs one extra synthesis next run, nothing more. */
export function writeState(s: SynthState, file: string = statePath()): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(s)}\n`);
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
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(all)}\n`);
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
