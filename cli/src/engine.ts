/**
 * ENGINE — the v3 pipeline, in one place. This is what replaced `discover` + `assign`.
 *
 *     moments -> SHAPE -> EMBED -> CLUSTER -> NAME -> categories.jsonl + assignments.jsonl
 *                (free)   (free)    (free)   (cents)          (what count/write already read)
 *
 * The whole cost of a build now sits in one small naming call. Everything before it is arithmetic on
 * this machine: $13.27 and ~40 minutes became ~$0.25 and under 3 (measured, 0.6.2).
 *
 * TWO PATHS, and the difference between them is the whole reason a profile can be rebuilt daily
 * without churning:
 *
 *   COLD  cluster once, name once, and FREEZE — the vocabulary and the pile centres are written down.
 *   GROW  embed only what is new and attach each moment to its nearest FROZEN centre. Counts move.
 *         Nothing re-clusters, nothing is renamed, no pile changes what it means.
 *
 * WHY THE VOCABULARY FREEZES TOO. Shaping depends on which words this person uses most, so a
 * re-derived vocabulary produces a DIFFERENT fingerprint for the same sentence — and a vector built
 * against a different vocabulary cannot be compared to a frozen centre. It would look like drift and
 * be an artefact. So the vocabulary is part of the frozen model, not something recomputed per run.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { appendCategories, loadCategories, retireCategories } from './categories.js';
import { bandFor, buildPiles, dot, K_MAX, type Pile } from './cluster.js';
import { MIN_CONVERSATIONS } from './count.js';
import { MODEL, embedAll, runtimePresent } from './embed.js';
import { MODEL_WEIGHTS_SHA256, RUNTIME_VERSION } from './fetch.js';
import { namePiles, type Named } from './name.js';
import { loadMoments, type Moment } from './moments.js';
import { shapeOf, vocabulary } from './shape.js';
import { assignedKeys, writeAssignments, type Assignment } from './assign.js';
import { recordDir } from './stores.js';

/** Where ONE RECORD's frozen model lives. A vocabulary and a centroid are derived from one
 *  assistant's moments and are meaningless against another's — so the file that holds them is that
 *  record's own, and a cold build can only ever touch the shelf it was asked to build. */
export const enginePath = (record: string): string => join(recordDir(record), 'engine.json');

/** What this build of the CLI fingerprints with — BOTH halves. The runtime is the accent (native
 *  vs WASM measured at cosine ~0.995 on identical texts); the model is the LANGUAGE (different
 *  weights = a different coordinate system entirely, not even comparably wrong). Centroids frozen
 *  under any other stamp must never be joined against — so the stamp names the runtime version AND
 *  the exact weights, and a change to either is a versioned, announced rebuild. The stamp, not
 *  hope, decides compatibility. */
export const PIPELINE = `stratless-runtime@${RUNTIME_VERSION} · ${MODEL}@${MODEL_WEIGHTS_SHA256.slice(0, 8)} · wasm · b1`;

/**
 * The frozen model — everything a later run needs to place a new moment without re-deriving anything.
 * Small: a few hundred words and a few dozen 384-number centres.
 */
export interface EngineState {
  /** the shape vocabulary, frozen at cold build — see the header */
  vocab: string[];
  /** pile centres, frozen. New moments come to these; these never move. */
  centroids: number[][];
  /** labels[i] is the category name for centroids[i] — the pile-to-behaviour mapping the naming call
   *  produced, so a joining moment knows what it just became a member of */
  labels: string[];
  builtAt: string;
  /** the runtime that computed these centroids (see PIPELINE). Absent on pre-0.6.0 files — which
   *  reads as stale, exactly right: those centres came from the native runtime and must not be
   *  joined against. */
  pipeline?: string;
  /** how many distinct conversations the build read — the young trigger's baseline ([[outgrown]]).
   *  The RAW fact, not the derived K: what the history supported is re-derived under current
   *  constants, so the rule can evolve without re-stamping. Absent on pre-0.11.0 files (the
   *  fallback is labels.length). */
  sessionsAtBuild?: number;
  /** how snugly build-day moments sat against their own centres — the mature trigger's frozen
   *  baseline. Recorded now, consumed later: the drift margin gets pre-registered from measured
   *  wobble (fit.jsonl) before anything reads this. Absent on pre-0.11.0 files. */
  fit?: { median: number; p10: number; n: number };
}

export function loadEngine(record: string, file: string = enginePath(record)): EngineState | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as EngineState;
  } catch {
    return undefined; // corrupt state re-derives on the next cold build rather than crashing
  }
}

/**
 * Is there a usable frozen model on this machine?
 *
 * THE UPGRADE CASE, and it is the reason this exists. A machine that ran a previous engine has a
 * populated `categories.jsonl` but no `engine.json`. The worker branches cold-vs-steady on whether
 * categories exist, so such a machine would take the steady path forever, find no centres to join
 * against, place nothing, and quietly stop updating — with no error and no sign anything was wrong.
 * The branch has to ask THIS question, not "are there categories".
 *
 * THE RUNTIME CASE is the same trap wearing 0.6.0's clothes: centroids frozen by a DIFFERENT
 * runtime (the pre-0.6.0 native build, or any future engine bump) read as not-ready, which routes
 * the next consented `update` down the cold path — the versioned, announced rebuild — instead of
 * quietly mis-joining new WASM vectors against native centres forever.
 */
export function engineReady(record: string, file: string = enginePath(record)): boolean {
  const s = loadEngine(record, file);
  return Boolean(s?.centroids.length && s.centroids.length === s.labels.length && s.pipeline === PIPELINE);
}

export function saveEngine(state: EngineState, record: string, file: string = enginePath(record)): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state));
}

/**
 * THE YOUNG TRIGGER — has the history outgrown the map?
 *
 * A pair cold-built on thin history gets a small map (K is capped by conversations, cluster.ts
 * `bandFor`), and without this check it would keep that day-one map forever — `engineReady` routes
 * it down the steady path for life. So: rebuild when the history could support roughly DOUBLE what
 * it supported when the map was made.
 *
 *   base = what the history supported AT BUILD (from `sessionsAtBuild` — never the built pile
 *          count: admission pruning can keep fewer piles than the history supported, and measuring
 *          against the pruned count would re-fire immediately after every rebuild, a paid loop)
 *   now  = what it supports today (bandFor, capped at K_MAX)
 *   outgrown ⇔ now >= 2·base AND now >= base + 3
 *
 * Self-damping by construction: each fire resets the base, doublings space out geometrically
 * (a 3-pile pair fires near 18, 36, 72 conversations), and the K_MAX cap means any base ≥ 15 can
 * never fire again — maturity is not a mode, it is what doubling runs out of. The `base + 3` floor
 * keeps a tiny pair from churning 1→2→4. Pure arithmetic; deciding whether a rebuild may SPEND is
 * the caller's job (loop.ts: consent, or the standing growth consent).
 */
export function outgrown(state: EngineState, moments: Moment[]): boolean {
  const base = state.sessionsAtBuild != null
    ? Math.min(K_MAX, Math.max(1, Math.floor(state.sessionsAtBuild / MIN_CONVERSATIONS)))
    : state.labels.length; // pre-0.11.0 file: the built count is the only baseline it kept
  if (base < 1) return false;
  const now = bandFor(moments).hi;
  return now >= 2 * base && now >= base + 3;
}

/** Where ONE RECORD's grow-fit ledger lives: one summary line per flush of how snugly the new
 *  moments sat. The mature trigger's raw material — written now, read by nothing shipped yet, so
 *  its drift margin can be pre-registered from MEASURED wobble instead of an armchair number. */
export const fitPath = (record: string): string => join(recordDir(record), 'fit.jsonl');

/** Median / p10 over nearest-centre similarities, rounded so the stores stay byte-stable. */
function fitStats(sims: number[]): { median: number; p10: number; n: number } {
  const s = [...sims].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { median: r(at(50)), p10: r(at(10)), n: s.length };
}

function recordFit(record: string, at: string, sims: number[]): void {
  if (!sims.length) return;
  try {
    const { median, p10, n } = fitStats(sims);
    mkdirSync(dirname(fitPath(record)), { recursive: true });
    appendFileSync(fitPath(record), `${JSON.stringify({ at, n, median, p10 })}\n`);
  } catch {
    /* best-effort: a fit line must never break a flush */
  }
}

export interface BuildResult {
  categories: number;
  scored: number;
  piles: number;
  /** the model was not available — offline, or the download never completed. Nothing was written and
   *  nothing was spent; the pile is intact and the next run resumes from it. */
  noModel?: boolean;
  /**
   * THE PILES WERE FOUND AND THE BORROWED MODEL DID NOT NAME THEM — refused, timed out, was
   * unreachable, or answered something unusable.
   *
   * Its own flag because without one this outcome is indistinguishable from "you have no
   * recurring behaviour yet": both reach the caller as zero categories, and the person is told
   * something about THEMSELVES that is actually about their assistant. For a product whose whole
   * claim is never being confidently wrong, that was the wrong silence.
   */
  unnamed?: boolean;
}

/**
 * COLD BUILD — the one paid run. Shapes, embeds, clusters, names, and freezes.
 *
 * Writes all three stores together at the end, so an abrupt death leaves nothing half-built: the next
 * run sees no engine state and starts cleanly rather than reading a partial model as if it were whole.
 */
export async function coldBuild(record: string, opts: {
  onProgress?: (line: string) => void;
  shouldStop?: () => boolean;
} = {}): Promise<BuildResult> {
  // ONE RECORD'S MOMENTS AND NOTHING ELSE. The vocabulary, the centroids, the categories and every
  // assignment this build writes are derived inside one HUMAN+AI pair — a moment from another
  // assistant may not shape a centre here, even slightly (the doctrine, 2026-08-03).
  const moments = loadMoments().filter((m) => m.record === record);
  if (!moments.length) return { categories: 0, scored: 0, piles: 0 };

  opts.onProgress?.(`reading ${moments.length} moments`);
  const vocab = vocabulary(moments);
  const texts = moments.map((m) => shapeOf(m.reply, vocab));

  opts.onProgress?.('fingerprinting on this machine — nothing leaves');
  // THE MODEL MAY NOT BE HERE. Offline, an interrupted download, a sandbox with no network: all real,
  // and none of them may crash a background worker or hang it waiting on a fetch. A build that cannot
  // fingerprint writes nothing and says so — the pile is already collected and costs nothing to keep,
  // so the next run picks up exactly where this one stopped.
  let X: Float32Array[];
  try {
    X = await embedAll(texts, (done, total) => {
      if (done % 640 === 0) opts.onProgress?.(`fingerprinting ${done}/${total}`);
    });
  } catch {
    return { categories: 0, scored: 0, piles: 0, noModel: true };
  }
  if (opts.shouldStop?.()) return { categories: 0, scored: 0, piles: 0 };

  opts.onProgress?.('finding the patterns');
  const piles = buildPiles(X, moments);
  if (!piles.length) return { categories: 0, scored: 0, piles: 0 };
  if (opts.shouldStop?.()) return { categories: 0, scored: 0, piles: 0 };

  opts.onProgress?.(`naming ${piles.length} patterns`);
  const named = namePiles(piles, moments, record);
  if (!named.length) return { categories: 0, scored: 0, piles: piles.length, unnamed: true };

  return freeze(record, moments, X, piles, named, vocab);
}

/** Write the three stores and the frozen model, together, once. No scope is stamped — the naming
 *  call no longer rules on person-vs-project (the verdict wobbled; see name.ts). `write.ts` keeps
 *  its project-filter as a dead-man switch that nothing trips. */
function freeze(record: string, moments: Moment[], X: Float32Array[], piles: Pile[], named: Named[], vocab: Set<string>): BuildResult {
  const at = new Date().toISOString();
  // A cold build REPLACES every assignment below, so the outgoing generation is retired first —
  // otherwise every versioned rebuild stacks ~30 ghost categories that nothing carries (measured:
  // three rebuilds left 90 born, 0 retired). Tombstones keep the log auditable; the live set
  // folds to this build's generation only. A crash between retire and born leaves an empty live
  // set, which routes the next run back down the cold path — safe, never half-alive.
  // Per-record stores make the old cross-record hazards unrepresentable: this retire can only
  // tombstone THIS record's generation, and the replace below can only truncate THIS record's
  // assignments. The other shelf is not reachable from here by construction.
  retireCategories(loadCategories(record).map((c) => c.name), { record, at });
  appendCategories(named.map((n) => ({ name: n.name, description: n.description })), { record, at });

  // A pile that no behaviour claimed contributes nothing — its moments get an empty `kinds`, which is
  // a real answer ("looked, matched nothing"), not an absence.
  const labelOf = new Map<number, string>();
  for (const n of named) labelOf.set(n.pile, n.name);

  const records: Assignment[] = [];
  const memberOf = new Map<number, number>(); // moment index -> pile id
  for (const p of piles) for (const i of p.members) memberOf.set(i, p.id);
  for (let i = 0; i < moments.length; i++) {
    const pileId = memberOf.get(i);
    const label = pileId === undefined ? undefined : labelOf.get(pileId);
    records.push({ key: moments[i].key, at, kinds: label ? [label] : [] });
  }
  // REPLACE, never append: `count.join()` emits one row per record, so a moment left holding an
  // older record as well would be counted twice and every number in the profile would inflate. A
  // cold build establishes the whole set — an upgrade from a previous engine lands exactly here.
  writeAssignments(records, record, undefined, 'replace');

  const kept = piles.filter((p) => labelOf.has(p.id));
  // The two frozen baselines the growth triggers read later: what the history supported (the young
  // trigger's base) and how snugly build-day moments sat against the kept centres (the mature
  // trigger's yardstick — same geometry `grow` joins against, so drift is comparable).
  const keptCentroids = kept.map((p) => p.centroid);
  const sims = X.map((x) => {
    let best = -2;
    for (const c of keptCentroids) {
      const s = dot(x, c);
      if (s > best) best = s;
    }
    return best;
  });
  saveEngine(
    {
      vocab: [...vocab],
      centroids: kept.map((p) => [...p.centroid]),
      labels: kept.map((p) => labelOf.get(p.id) as string),
      builtAt: at,
      pipeline: PIPELINE,
      sessionsAtBuild: new Set(moments.map((m) => m.session)).size,
      fit: fitStats(sims),
    },
    record,
  );

  return { categories: named.length, scored: records.length, piles: piles.length };
}

export interface GrowResult {
  scored: number;
  /** the frozen centroids came from a different runtime — nothing was placed, because placing would
   *  mis-join. The worker's branch already routes this to a cold rebuild; this is defense in depth. */
  stale?: boolean;
}

/**
 * GROW — every run after the first. Embeds only what is new and attaches each moment to its nearest
 * frozen centre. FREE: no model call, because nothing is being named. New behaviours are not
 * discovered here — they surface when a rebuild trigger fires (see below).
 *
 * ⚠️ PARKING WAS MEASURED AND FALSIFIED (2026-08-04). The planned fix here — park a moment "near
 * nothing", birth a pile when parked moments bunch — assumed a distance floor exists in the data.
 * It does not: nearest-centre similarities form ONE continuous smear on real pairs (no gap, no
 * knee), any fixed line means different things per pair (0.70 cuts 2.6% of one real corpus and 32%
 * of another — the scale is pair-relative), and the farthest moments sit BETWEEN piles, not off
 * the map. So the profile keeps learning through REBUILD TRIGGERS instead: the young trigger
 * ([[outgrown]]) re-derives an under-built map when the history doubles, and the mature trigger
 * (fit drift against `EngineState.fit`, not yet wired) will catch a person outgrowing a stable
 * map. The fit line recorded below is that trigger's groundwork — its margin gets pre-registered
 * from measured wobble, never guessed.
 */
export async function grow(record: string, opts: { shouldStop?: () => boolean } = {}): Promise<GrowResult> {
  const state = loadEngine(record);
  if (!state?.centroids.length) return { scored: 0 };

  // NEVER JOIN ACROSS RUNTIMES. engineReady() already routes a stale engine to the cold path, so
  // this should be unreachable — but "should be" is not a property, and the cost of mis-joining
  // (silently wrong counts in the profile) buys a two-line guard.
  if (state.pipeline !== PIPELINE) return { scored: 0, stale: true };

  // THE BACKGROUND PATH NEVER FETCHES. `grow` runs unattended from the after-session hook, and the
  // privacy docs promise that the refresh downloads nothing — so if the runtime or weights are
  // absent (deleted, an interrupted install), STOP rather than quietly pulling ~40MB while someone
  // is working. The moments stay pending and are placed once `init` has fetched them with consent.
  // A promise about network behaviour has to be enforced here, not left true by luck. (The fake
  // seam skips the check: under STRATLESS_FAKE_EMBED nothing can fetch, by construction.)
  if (process.env.STRATLESS_FAKE_EMBED !== '1' && !runtimePresent()) return { scored: 0 };

  const seen = assignedKeys(record);
  const fresh = loadMoments().filter((m) => m.record === record && !seen.has(m.key));
  if (!fresh.length) return { scored: 0 };

  const vocab = new Set(state.vocab); // FROZEN — see the header
  let X: Float32Array[];
  try {
    X = await embedAll(fresh.map((m) => shapeOf(m.reply, vocab)));
  } catch {
    return { scored: 0 }; // no model: the moments stay pending and are placed on a later run
  }
  if (opts.shouldStop?.()) return { scored: 0 };

  const centroids = state.centroids.map((c) => Float32Array.from(c));
  const at = new Date().toISOString();
  const sims: number[] = [];
  writeAssignments(
    fresh.map((m, i) => {
      let best = -2;
      let atC = 0;
      for (let c = 0; c < centroids.length; c++) {
        const s = dot(X[i], centroids[c]);
        if (s > best) { best = s; atC = c; }
      }
      sims.push(best);
      return { key: m.key, at, kinds: [state.labels[atC]].filter(Boolean) };
    }),
    record,
  );
  recordFit(record, at, sims);
  return { scored: fresh.length };
}
