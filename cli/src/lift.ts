/**
 * LIFT — the loop core. The tuning service: ADAPT is the map of the driver; this module is the
 * loop that keeps the map true, patching it wherever the AI measurably failed this person and
 * deleting each patch once the failure stops. The file thins as the person grows.
 *
 * THE DOCTRINE (adopted 2026-07-29): **LIFT grades the AI, never the human.** Every patch records
 * a failure of the AI→human channel; the human is never the subject, so grading them is
 * structurally impossible.
 *
 * THE PIPELINE (war room: §The Self-Retune Re-Founding — every mode, every patch, one loop):
 *
 *   WITNESS    a failure exists only as a recorded person-side reaction
 *   ATTRIBUTE  one home per event — THE MAP IS THE ONLY ADDRESS SPACE (homed / hole / refuse)
 *   ADMIT      recurrence floors + the iron gate (their own voice) + a live baseline; zero is legal
 *   PATCH      three forms only, all edits to the map's surface, worded ONCE: sharpen · trigger · grow
 *   PROVE      the dyno — birth baseline, pre-registered exits, two-sided, every tune release
 *   RELEASE    healed (the patch deletes; the map thins) · lapsed (neutral) · wrong (dropped, feedback)
 *
 * The model words only at PATCH; every other step is arithmetic. Seated modes live here as data,
 * their witnesses elsewhere: mode 1 (wrong time) witnesses in count.ts, mode 2 (wrong altitude)
 * in asks.ts. Modes 3/5/6 are seated in the design and arrive on their own probes; mode 4 is
 * blocked on the offer/pick trace. Nothing may mint without clearing the whole pipeline —
 * mode 2's sharpen/grow paths do not exist yet by construction (no attribution finer than its
 * global home has ever passed the falsifier harness), which is why its live patches are the two
 * templated trigger lines and nothing else.
 *
 * ONE LEDGER. Every patch is the same record, covered-forever keyed on (home, mode); one
 * lifecycle, mode-parameterized, preserving each mode's measured exit semantics exactly; one
 * print surface feeding write.ts. Identity across cold rebuilds: a patch re-homes decisively
 * (live name, or birth centroid with margin) or goes dormant — never a guess.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import { atomicWriteFileSync } from './atomic.js';
import { dot } from './cluster.js';
import { loadEngine } from './engine.js';
import { runClaude } from './claude.js';
import type { Category } from './categories.js';
import {
  gapCandidates,
  gapWindowRead,
  adjacencyOf,
  supplyRead,
  actionFor,
  FADE,
  type Labelled,
  type GapCandidate,
} from './count.js';
import {
  walkAnswers,
  asksRead,
  deliverySpec,
  metaEvidence,
  metaLine,
  DELEGATED_LINE,
  askWindowRead,
  type MetaEvidence,
} from './asks.js';

const liftPath = (): string => process.env.STRATLESS_LIFT || join(homedir(), '.stratless', 'lift.json');

/* ——— pre-registered constants — mode 1 (2026-07-28, from the gap-leg probes) ——— */
/** a window needs this many assigned moments before its rates may heal a mode-1 patch */
const M1_SAMPLE_MIN = 100;
const CLOSE_FACTOR = 0.5;
const CLOSE_BUILDS = 2;
const GRAD_BUILDS = 2;
const M1_FALSIFY_BUILDS = 6;
const M1_FALSIFY_DAYS = 42;
const M1_FALSIFY_FACTOR = 0.8;
/** re-homing after a cold rebuild: best cosine floor and required margin over the runner-up.
 *  The floor sits above the observed cross-category maximum (0.930 on the reference archive). */
const ANCHOR_MIN = 0.93;
const ANCHOR_MARGIN = 0.02;
/** at most this many clauses print, slip-heaviest first */
export const PRINT_CAP = 3;

/* ——— pre-registered constants — mode 2 (2026-07-29) ——— */
/** mode 2's global home — attribution's honest resolution until an identity passes the harness */
export const ASK_ALTITUDE_HOME = 'ask-altitude';
const M2_SAMPLE_MIN = 30;
const LEARN_FACTOR = 0.5;
const ENGAGE_HOLD = 0.7;
const LEARN_BUILDS = 2;
const LAPSE_DAYS = 42;
const M2_FALSIFY_BUILDS = 6;
const M2_FALSIFY_DAYS = 42;
const M2_FALSIFY_FACTOR = 0.8;
/** the signature line prints only above this much bounce evidence (MEASURE-THEN-LOCK) */
const META_FLOOR = 10;

const HISTORY_CAP = 12;
const VOICE_TIMEOUT_MS = 300_000;

/* ——— the unified record ——— */

export type PatchMode = 1 | 2;
export type PatchForm = 'sharpen' | 'trigger' | 'grow';
export type PatchState = 'open' | 'healed' | 'lapsed' | 'wrong' | 'dormant';

export interface PatchHistoryEntry {
  builtAt: string;
  /** the mode's failure rate over the window (mode 1: slips; mode 2: asks-in-context) */
  fail: number;
  /** the mode's session count over the window (mode 1: stumble sessions; mode 2: touching sessions) */
  sessions: number;
  sample: number;
  /** mode 1: the person's own reaching in the window — graduation's evidence */
  reach?: number;
  /** the two-sided legs: the assistant's supply held (mode 1) / refusals rose */
  hold?: number;
  refusedRose?: boolean;
  /** mode 2: the person's engagement rate — absorbed-vs-decayed's second hand */
  engage?: number;
  /** THE SHADOW RULE'S UNIT (pre-registered 2026-07-30, decides nothing in v1): distinct sessions
   *  where the patch's situation AROSE in the window — mode 1: the home category appeared;
   *  mode 2: the zone was touched. Recorded from birth so the window-vs-chances comparison can be
   *  read retroactively after the trial. Absence without opportunity is silence, not success. */
  chances?: number;
}

export interface Patch {
  id: string;
  bornAt: string;
  mode: PatchMode;
  form: PatchForm;
  /** the map row this patch edits — THE address (mode 2's global home: ASK_ALTITUDE_HOME) */
  home: string;
  /** the embedding pipeline any stored geometry lives in */
  pipeline: string;
  /** mode-1 re-homing geometry — the BIRTH centroid, never updated */
  centroid?: number[];
  /** birth facts, per mode — the receipt and the audit trail */
  evidence: Record<string, number>;
  /** mode-2 window terms (how later releases find the zone again) */
  terms?: string[];
  /** every later release's rates are judged against these */
  baseline: { fail: number; engage?: number };
  /** worded/templated ONCE at mint, never re-rolled. `text` is the printable; x/doThis/y are the
   *  mode-1 audit trio. The write-side wobble class cannot exist for patches by construction. */
  wording: { text: string; x?: string; doThis?: string; y?: string };
  /** the layer-1 mapped action, when one exists — lets healing demand the supply held */
  action?: string;
  deliveryPhrases?: string[];
  history: PatchHistoryEntry[];
  state: PatchState;
  /** healed audit: which exit fired — 'graduated' | 'closed' | 'learned' */
  via?: string;
  /** wrong-only: the drop is feedback on the patch's form/wording — recorded now, read later */
  feedback?: true;
}

export interface LiftStore {
  patches: Patch[];
  /** the signature line's measured backing — refreshed each flush (asks.ts owns the shape) */
  meta?: MetaEvidence;
  /** delegated zones the last run saw — the delegated line's trigger */
  delegatedZones?: number;
}

/** Defensive read — corrupt input degrades to empty, never throws (the renders.json discipline). */
export function readLift(file: string = liftPath()): LiftStore {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { patches?: unknown; meta?: unknown; delegatedZones?: unknown };
    if (!Array.isArray(raw.patches)) return { patches: [] };
    const patches: Patch[] = [];
    for (const p of raw.patches) {
      if (typeof p !== 'object' || p === null) continue;
      const o = p as Record<string, unknown>;
      if (typeof o.id !== 'string' || typeof o.home !== 'string') continue;
      if (o.mode !== 1 && o.mode !== 2) continue;
      const w = typeof o.wording === 'object' && o.wording !== null ? (o.wording as Record<string, unknown>) : undefined;
      if (!w || typeof w.text !== 'string') continue;
      const b = typeof o.baseline === 'object' && o.baseline !== null ? (o.baseline as Record<string, unknown>) : {};
      patches.push({
        id: o.id,
        bornAt: typeof o.bornAt === 'string' ? o.bornAt : '',
        mode: o.mode,
        form: o.form === 'sharpen' || o.form === 'trigger' || o.form === 'grow' ? o.form : 'sharpen',
        home: o.home,
        pipeline: typeof o.pipeline === 'string' ? o.pipeline : '',
        ...(Array.isArray(o.centroid) ? { centroid: o.centroid.filter((n): n is number => typeof n === 'number') } : {}),
        evidence:
          typeof o.evidence === 'object' && o.evidence !== null
            ? Object.fromEntries(Object.entries(o.evidence as Record<string, unknown>).filter(([, v]) => typeof v === 'number') as [string, number][])
            : {},
        ...(Array.isArray(o.terms) ? { terms: o.terms.filter((x): x is string => typeof x === 'string') } : {}),
        baseline: { fail: typeof b.fail === 'number' ? b.fail : 0, ...(typeof b.engage === 'number' ? { engage: b.engage } : {}) },
        wording: {
          text: w.text,
          ...(typeof w.x === 'string' ? { x: w.x } : {}),
          ...(typeof w.doThis === 'string' ? { doThis: w.doThis } : {}),
          ...(typeof w.y === 'string' ? { y: w.y } : {}),
        },
        ...(typeof o.action === 'string' ? { action: o.action } : {}),
        ...(Array.isArray(o.deliveryPhrases) ? { deliveryPhrases: o.deliveryPhrases.filter((x): x is string => typeof x === 'string') } : {}),
        history: Array.isArray(o.history) ? (o.history as PatchHistoryEntry[]) : [],
        state: o.state === 'healed' || o.state === 'lapsed' || o.state === 'wrong' || o.state === 'dormant' ? o.state : 'open',
        ...(typeof o.via === 'string' ? { via: o.via } : {}),
        ...(o.feedback === true ? { feedback: true } : {}),
      });
    }
    const m = typeof raw.meta === 'object' && raw.meta !== null ? (raw.meta as Record<string, unknown>) : undefined;
    const meta: MetaEvidence | undefined = m
      ? {
          asks: typeof m.asks === 'number' ? m.asks : 0,
          sessions: typeof m.sessions === 'number' ? m.sessions : 0,
          bounces: typeof m.bounces === 'number' ? m.bounces : 0,
          specPhrases: Array.isArray(m.specPhrases) ? m.specPhrases.filter((x): x is string => typeof x === 'string') : [],
        }
      : undefined;
    return {
      patches,
      ...(meta ? { meta } : {}),
      ...(typeof raw.delegatedZones === 'number' ? { delegatedZones: raw.delegatedZones } : {}),
    };
  } catch {
    return { patches: [] };
  }
}

export function writeLift(store: LiftStore, file: string = liftPath()): void {
  atomicWriteFileSync(file, JSON.stringify(store, null, 1));
}

/* ——— ATTRIBUTE's stability half: re-homing after a cold rebuild ———
 * Steady state (the home still lives) keeps the name. After a cold rebuild, a patch with birth
 * geometry must claim its new home DECISIVELY or go dormant — never a guess (a false re-home
 * would graft one patch's history onto another axis's future). Mode 2's global home is not a map
 * row and never goes dormant. */
export function rehome(
  patch: Patch,
  liveNames: Set<string>,
  engine: { labels: string[]; centroids: ArrayLike<number>[]; pipeline: string } | undefined,
): { home: string } | { dormant: true } {
  if (patch.home === ASK_ALTITUDE_HOME) return { home: patch.home };
  if (liveNames.has(patch.home)) return { home: patch.home };
  if (!engine || engine.pipeline !== patch.pipeline || !patch.centroid?.length) return { dormant: true };
  let best = -1;
  let second = -1;
  let bestIdx = -1;
  for (let i = 0; i < engine.centroids.length; i++) {
    const sim = dot(patch.centroid, engine.centroids[i]);
    if (sim > best) {
      second = best;
      best = sim;
      bestIdx = i;
    } else if (sim > second) {
      second = sim;
    }
  }
  if (bestIdx >= 0 && best >= ANCHOR_MIN && best - second >= ANCHOR_MARGIN && liveNames.has(engine.labels[bestIdx])) {
    return { home: engine.labels[bestIdx] };
  }
  return { dormant: true };
}

/* ——— RELEASE: the exits, one function, mode-parameterized ———
 * Each mode's measured exit semantics preserved EXACTLY (the acceptance pins them):
 *   mode 1 — graduated (stumbles stopped while reaching continued) → healed·graduated;
 *            closed (slips halved while the assistant's supply held, unrefused) → healed·closed;
 *            falsified (enough builds, enough days, the gap never moved) → wrong.
 *   mode 2 — learned (asks fell while engagement HELD — absorbed, not decayed; claimable only
 *            with birth engagement) → healed·learned; lapsed (no touch for the window) → lapsed;
 *            falsified (asks persisted despite the grounding) → wrong + feedback.
 * Dormancy is not an exit — rehome() assigns it. Terminal states are skipped forever. */
export function nextPatchState(patch: Patch, nowMs: number): { state: PatchState; via?: string } {
  const h = patch.history;
  if (patch.mode === 1) {
    const solid = (e: PatchHistoryEntry): boolean => e.sample >= M1_SAMPLE_MIN;
    const gradSlice = h.slice(-GRAD_BUILDS);
    if (gradSlice.length >= GRAD_BUILDS && gradSlice.every((e) => solid(e) && e.sessions === 0 && (e.reach ?? 0) > 0)) {
      return { state: 'healed', via: 'graduated' };
    }
    const closeSlice = h.slice(-CLOSE_BUILDS);
    if (closeSlice.length >= CLOSE_BUILDS && closeSlice.every((e) => solid(e) && e.fail <= patch.baseline.fail * CLOSE_FACTOR)) {
      const last = closeSlice[closeSlice.length - 1];
      const supplyHolds = !patch.action || (typeof last.hold === 'number' && last.hold >= FADE && !last.refusedRose);
      if (supplyHolds) return { state: 'healed', via: 'closed' };
    }
    const ageDays = (nowMs - Date.parse(patch.bornAt)) / (24 * 3600_000);
    if (h.length >= M1_FALSIFY_BUILDS && ageDays >= M1_FALSIFY_DAYS && h.every((e) => !solid(e) || e.fail > patch.baseline.fail * M1_FALSIFY_FACTOR)) {
      return { state: 'wrong' };
    }
    return { state: 'open' };
  }

  // mode 2
  const solid = (e: PatchHistoryEntry): boolean => e.sample >= M2_SAMPLE_MIN;
  if ((patch.baseline.engage ?? 0) > 0) {
    const slice = h.slice(-LEARN_BUILDS);
    if (
      slice.length >= LEARN_BUILDS &&
      slice.every((e) => solid(e) && e.fail <= patch.baseline.fail * LEARN_FACTOR && (e.engage ?? 0) >= (patch.baseline.engage ?? 0) * ENGAGE_HOLD)
    ) {
      return { state: 'healed', via: 'learned' };
    }
  }
  const lastAlive = [...h].reverse().find((e) => e.sessions > 0);
  const aliveAt = lastAlive ? Date.parse(lastAlive.builtAt) : Date.parse(patch.bornAt);
  if (Number.isFinite(aliveAt) && nowMs - aliveAt >= LAPSE_DAYS * 24 * 3600_000) return { state: 'lapsed' };
  const ageDays = (nowMs - Date.parse(patch.bornAt)) / (24 * 3600_000);
  if (
    h.length >= M2_FALSIFY_BUILDS &&
    ageDays >= M2_FALSIFY_DAYS &&
    h.some(solid) &&
    h.every((e) => !solid(e) || e.fail > patch.baseline.fail * M2_FALSIFY_FACTOR)
  ) {
    return { state: 'wrong' };
  }
  return { state: 'open' };
}

/* ——— PATCH: the voicing — the model's ONE job in the loop, at mint only ———
 * Carried verbatim from the gap leg (its discipline passed the felt gate): one batched call, a
 * required-fields schema, defensive parse, the wording stored and never read again except
 * verbatim. Constraints from the framework guardrails: address the assistant, never grade the
 * person; Y is voiced from the person's OWN reach quotes; portable (no project nouns); grow
 * judgment, never prompting. */

const PATCH_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    rules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          x: { type: 'string' },
          do: { type: 'string' },
          y: { type: 'string' },
          clause: { type: 'string' },
        },
        required: ['name', 'x', 'do', 'y', 'clause'],
      },
    },
  },
  required: ['rules'],
});

const SAMPLE_CAP = 5;
const SAMPLE_CHARS = 240;

export interface PatchVoiceJob {
  candidate: GapCandidate;
  stumbleQuotes: string[];
  reachQuotes: string[];
  action?: string;
}

/** Per-session sample quotes for a category's two valences, stumble side narrowed to named sessions. */
function samplesFor(labelled: Labelled[], name: string, stumbleOnly?: Set<string>): { stumbleQuotes: string[]; reachQuotes: string[] } {
  const carry = labelled.filter((l) => l.kinds.includes(name));
  const perSession = (rows: Labelled[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const l of rows) {
      if (seen.has(l.moment.session)) continue;
      const q = l.moment.reply.replace(/\s+/g, ' ').trim().slice(0, SAMPLE_CHARS);
      if (q.length < 10) continue;
      seen.add(l.moment.session);
      out.push(q);
      if (out.length >= SAMPLE_CAP) break;
    }
    return out;
  };
  return {
    stumbleQuotes: perSession(
      carry.filter((l) => (l.moment.pile === 'interrupt' || l.moment.pile === 'decline') && (!stumbleOnly || stumbleOnly.has(l.moment.session))),
    ),
    reachQuotes: perSession(carry.filter((l) => l.moment.pile === 'ordinary')),
  };
}

export function patchVoiceJobs(labelled: Labelled[], candidates: GapCandidate[]): PatchVoiceJob[] {
  const adj = adjacencyOf(labelled);
  return candidates.map((c) => ({
    candidate: c,
    ...samplesFor(labelled, c.name, new Set(c.stumbleSessions)),
    action: actionFor(labelled, c.name, adj),
  }));
}

export function voicePatches(bin: string, jobs: PatchVoiceJob[]): Map<string, { x: string; doThis: string; y: string; clause: string }> {
  const body = jobs
    .map((j) => {
      const parts = [
        `PATTERN: ${j.candidate.name}`,
        `they hold this standard, in their own words (calm, working moments):`,
        ...j.reachQuotes.map((q) => `  · "${q}"`),
        `but in ${j.candidate.stumbleSessions.length} sessions the standard arrived only as a late correction (said while stopping the assistant):`,
        ...j.stumbleQuotes.map((q) => `  · "${q}"`),
      ];
      if (j.action) parts.push(`the assistant move that answers this standard: the ${j.action} tool`);
      return parts.join('\n');
    })
    .join('\n\n');

  const prompt = [
    'You are wording rules for an AI-loaded working brief. Each rule tells the ASSISTANT how to close a',
    'measured gap: the person holds a standard but sometimes deploys it late, and the assistant should',
    'model the move first in exactly those moments. For each PATTERN below give three short fields:',
    '',
    'x  — the stumble, as observed behaviour (≤14 words). Neutral fact, never a criticism.',
    'do — the assistant\'s move at the moment the standard is missing (≤16 words, imperative).',
    'y  — the person\'s own standard, voiced FROM their calm quotes (≤10 words). Their words\' spirit, not yours.',
    'clause — the WHOLE rule as one clause to append to their existing profile row, starting with',
    '        "when" (≤18 words). Written in the file\'s voice — first person is the person ("when I\'ve',
    '        started without one, stop and set the bound for me"). This is the only field that prints.',
    '        THE WHEN MUST DESCRIBE THE MOMENT BEFORE THEY SPEAK: the standard not yet deployed, the',
    '        work already moving. Never "when I\'ve asked and…" — if they had already asked, the gap',
    '        is the assistant\'s failure, not theirs, and that is a different row\'s job.',
    '',
    'Hard rules: address the assistant, never the person (the clause\'s "I/me" is the person\'s voice in',
    'their own file). Never a grade or a diagnosis. No project or product nouns — write the kind of',
    'thing ("their product", "a named tool", "the current build").',
    'The move must grow their judgment (scoping, verifying, deciding), never prompting technique.',
    'Return JSON: {"rules":[{"name","x","do","y","clause"}]} — one entry per PATTERN, name copied exactly.',
    '',
    body,
  ].join('\n');

  const out = new Map<string, { x: string; doThis: string; y: string; clause: string }>();
  const reply = runClaude(bin, prompt, 'sonnet', 'lift', VOICE_TIMEOUT_MS, PATCH_SCHEMA, 0);
  if (!reply) return out;
  try {
    const m = reply.match(/\{[\s\S]*\}/);
    if (!m) return out;
    const parsed = JSON.parse(m[0]) as { rules?: { name?: string; x?: string; do?: string; y?: string; clause?: string }[] };
    const known = new Set(jobs.map((j) => j.candidate.name));
    for (const r of parsed.rules ?? []) {
      if (!r.name || !known.has(r.name)) continue;
      if (!r.x || !r.do || !r.y || !r.clause) continue;
      out.set(r.name, { x: r.x.trim(), doThis: r.do.trim(), y: r.y.trim(), clause: r.clause.trim() });
    }
  } catch {
    /* a bad reply mints nothing this release; candidates retry next flush */
  }
  return out;
}

/* ——— the per-release run: PROVE every open patch, RELEASE what earned an exit, mint what the
 * pipeline cleared ——— */

export interface LiftRunResult {
  minted: number;
  retired: number;
  open: number;
  /** what PRINTS moved — the profile should rebuild */
  changed: boolean;
}

export function runLift(
  bin: string | undefined,
  labelled: Labelled[],
  categories: Category[],
  nowMs: number,
  opts: { file?: string; roots?: string[] } = {},
): LiftRunResult {
  const file = opts.file ?? liftPath();
  const store = readLift(file);
  const engine = loadEngine();
  const engineView = engine
    ? { labels: engine.labels, centroids: engine.centroids as unknown as ArrayLike<number>[], pipeline: engine.pipeline ?? '' }
    : undefined;
  const liveNames = new Set(categories.map((c) => c.name));
  const builtAt = new Date(nowMs).toISOString();
  const adj = adjacencyOf(labelled);
  let storeMoved = false;
  let changed = false;
  let retired = 0;

  // The mode-2 witness read — needed both for re-measuring mode-2 patches (rituals) and for the
  // evidence snapshot. The walk can be empty (reaped roots, tests): the read then refuses and the
  // snapshot keeps its last honest value; mode-1 work never stalls on it.
  const walk = walkAnswers(opts.roots);
  const read = asksRead(labelled, adj, walk);
  const rituals = read ? new Set(read.rituals) : undefined;

  // 1. PROVE + RELEASE every open patch.
  for (const patch of store.patches) {
    if (patch.state === 'healed' || patch.state === 'lapsed' || patch.state === 'wrong') continue; // terminal
    const at = rehome(patch, liveNames, engineView);
    if ('dormant' in at) {
      if (patch.state !== 'dormant') {
        patch.state = 'dormant';
        storeMoved = true;
        changed = true;
      }
      continue;
    }
    if (patch.home !== at.home || patch.state === 'dormant') {
      patch.home = at.home;
      patch.state = 'open';
      storeMoved = true;
      changed = true;
    }

    let entry: PatchHistoryEntry;
    if (patch.mode === 1) {
      const win = gapWindowRead(labelled, patch.home, nowMs);
      entry = { builtAt, fail: win.slipRate, sessions: win.stumbleSessions, sample: win.sample, reach: win.reach, chances: win.chances };
      if (patch.action) {
        const supply = supplyRead(labelled, patch.home);
        if (supply) {
          entry.hold = supply.supplyRatio;
          entry.refusedRose = supply.declinesRose;
        }
      }
    } else {
      // A mode-2 patch without rituals this release keeps its history unchanged — refuse, don't
      // guess a quiet window out of a failed witness.
      if (!rituals) continue;
      const win = askWindowRead(labelled, patch.terms ?? [], adj, rituals, nowMs);
      entry = { builtAt, fail: win.askRate, sessions: win.sessions, sample: win.sample, engage: win.engageRate, chances: win.sessions };
    }
    patch.history = [...patch.history.filter((e) => e.builtAt !== builtAt), entry].slice(-HISTORY_CAP);
    storeMoved = true;
    const next = nextPatchState(patch, nowMs);
    if (next.state !== patch.state) {
      patch.state = next.state;
      if (next.via) patch.via = next.via;
      if (next.state === 'wrong') patch.feedback = true;
      retired++;
      changed = true;
    }
  }

  // 2. The mode-2 evidence snapshot — the two templated lines' backing, refreshed each release.
  if (read && rituals) {
    const delivery = deliverySpec(labelled, rituals);
    const meta = metaEvidence(read, delivery);
    if (JSON.stringify(store.meta) !== JSON.stringify(meta)) {
      store.meta = meta;
      storeMoved = true;
      changed = true;
    }
    if (store.delegatedZones !== read.delegated.length) {
      store.delegatedZones = read.delegated.length;
      storeMoved = true;
      changed = true;
    }
  }

  // 3. ADMIT + PATCH — mode 1 only (mode 2 has no minting path by construction; see the header).
  //    Covered-forever on (home, mode): a dead patch's axis does not silently re-mint.
  const covered = new Set(store.patches.filter((p) => p.mode === 1).map((p) => p.home));
  const candidates = gapCandidates(labelled, categories).filter((c) => !covered.has(c.name));
  let minted = 0;
  if (bin && candidates.length && engineView) {
    const jobs = patchVoiceJobs(labelled, candidates);
    const voiced = voicePatches(bin, jobs);
    for (const j of jobs) {
      const v = voiced.get(j.candidate.name);
      if (!v) continue;
      const idx = engineView.labels.indexOf(j.candidate.name);
      if (idx < 0) continue; // no geometry, no identity — cannot mint
      const birth = gapWindowRead(labelled, j.candidate.name, nowMs);
      // An unfalsifiable patch may not exist: the failure must be alive at birth.
      if (birth.slipRate <= 0) continue;
      store.patches.push({
        id: `${builtAt}·${j.candidate.name}`,
        bornAt: builtAt,
        mode: 1,
        form: 'sharpen',
        home: j.candidate.name,
        pipeline: engineView.pipeline,
        centroid: Array.from(engineView.centroids[idx] as ArrayLike<number>),
        evidence: { reach: j.candidate.reach, slip: j.candidate.slip, stumbleSessions: j.candidate.stumbleSessions.length },
        baseline: { fail: birth.slipRate },
        wording: { text: v.clause, x: v.x, doThis: v.doThis, y: v.y },
        ...(j.action ? { action: j.action } : {}),
        history: [{ builtAt, fail: birth.slipRate, sessions: birth.stumbleSessions, sample: birth.sample, reach: birth.reach, chances: birth.chances }],
        state: 'open',
      });
      minted++;
      storeMoved = true;
      changed = true;
    }
  }

  if (storeMoved) writeLift(store, file);
  return { minted, retired, open: store.patches.filter((p) => p.state === 'open').length, changed };
}

/* ——— what the profile prints ———
 *
 * LIFT is dynamics, never surface: no heading, no section, ever. Mode-1 sharpen patches print as
 * RIDERS on their host rows plus a situation trigger in the decode key (write.ts derives the
 * trigger from the clause's when-shape); mode 2 prints its two templated trigger lines. The
 * wording is the stored voiced-once text — assembly never re-words. */

export interface Clause {
  /** the voiced-once when-clause, appended to the host row after " — and " */
  clause: string;
  slip: number;
  /** the gap's trend, from the patch's own history vs its baseline — two-sided by construction */
  trend?: 'opening' | 'closing';
}

export interface LiftPrint {
  /** host row name → its clause (mode-1 open sharpen patches, slip-heaviest, capped) */
  clauses: Map<string, Clause>;
  /** the decode-key lines the loop contributes, in print order */
  keyLines: string[];
}

export function liftPrint(file: string = liftPath()): LiftPrint {
  const store = readLift(file);
  const clauses = new Map<string, Clause>();
  const open = store.patches
    .filter((p) => p.state === 'open' && p.mode === 1 && p.wording.text)
    .sort((a, b) => (b.evidence.slip ?? 0) - (a.evidence.slip ?? 0))
    .slice(0, PRINT_CAP);
  for (const p of open) {
    const last = p.history[p.history.length - 1];
    let trend: 'opening' | 'closing' | undefined;
    if (last && last.sample >= M1_SAMPLE_MIN && p.baseline.fail > 0) {
      if (last.fail >= p.baseline.fail * 1.3) trend = 'opening';
      else if (last.fail <= p.baseline.fail * FADE) trend = 'closing';
    }
    clauses.set(p.home, { clause: p.wording.text, slip: p.evidence.slip ?? 0, ...(trend ? { trend } : {}) });
  }
  const keyLines: string[] = [];
  const metaQualifies = !!store.meta && store.meta.bounces >= META_FLOOR;
  if (metaQualifies) keyLines.push(metaLine(store.meta!));
  if ((clauses.size > 0 || metaQualifies) && (store.delegatedZones ?? 0) > 0) keyLines.push(DELEGATED_LINE);
  return { clauses, keyLines };
}
