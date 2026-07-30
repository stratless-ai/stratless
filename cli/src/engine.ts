/**
 * ENGINE — the v3 pipeline, in one place. This is what replaced `discover` + `assign`.
 *
 *     moments -> SHAPE -> EMBED -> CLUSTER -> NAME -> categories.jsonl + assignments.jsonl
 *                (free)   (free)    (free)   (cents)          (what count/write already read)
 *
 * The whole cost of a build now sits in one small naming call. Everything before it is arithmetic on
 * this machine: $13.27 and ~40 minutes became ~$0.20 and ~5.
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { appendCategories, loadCategories, retireCategories } from './categories.js';
import { buildPiles, join as nearest, type Pile } from './cluster.js';
import { MODEL, embedAll, runtimePresent } from './embed.js';
import { MODEL_WEIGHTS_SHA256, RUNTIME_VERSION } from './fetch.js';
import { namePiles, type Named } from './name.js';
import { loadMoments, type Moment } from './moments.js';
import { shapeOf, vocabulary } from './shape.js';
import { assignedKeys, writeAssignments, type Assignment } from './assign.js';

/** Where the frozen model lives. Override with STRATLESS_ENGINE (tests). */
const statePath = (): string => process.env.STRATLESS_ENGINE || join(homedir(), '.stratless', 'engine.json');

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
}

export function loadEngine(file: string = statePath()): EngineState | undefined {
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
export function engineReady(file: string = statePath()): boolean {
  const s = loadEngine(file);
  return Boolean(s?.centroids.length && s.centroids.length === s.labels.length && s.pipeline === PIPELINE);
}

export function saveEngine(state: EngineState, file: string = statePath()): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state));
}

export interface BuildResult {
  categories: number;
  scored: number;
  piles: number;
  /** the model was not available — offline, or the download never completed. Nothing was written and
   *  nothing was spent; the pile is intact and the next run resumes from it. */
  noModel?: boolean;
}

/**
 * COLD BUILD — the one paid run. Shapes, embeds, clusters, names, and freezes.
 *
 * Writes all three stores together at the end, so an abrupt death leaves nothing half-built: the next
 * run sees no engine state and starts cleanly rather than reading a partial model as if it were whole.
 */
export async function coldBuild(bin: string, opts: {
  onProgress?: (line: string) => void;
  shouldStop?: () => boolean;
} = {}): Promise<BuildResult> {
  const moments = loadMoments();
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
  const named = namePiles(bin, piles, moments);
  if (!named.length) return { categories: 0, scored: 0, piles: piles.length };

  return freeze(moments, piles, named, vocab);
}

/** Write the three stores and the frozen model, together, once. No scope is stamped — the naming
 *  call no longer rules on person-vs-project (the verdict wobbled; see name.ts). `write.ts` keeps
 *  its project-filter as a dead-man switch that nothing trips. */
function freeze(moments: Moment[], piles: Pile[], named: Named[], vocab: Set<string>): BuildResult {
  const at = new Date().toISOString();
  // A cold build REPLACES every assignment below, so the outgoing generation is retired first —
  // otherwise every versioned rebuild stacks ~30 ghost categories that nothing carries (measured:
  // three rebuilds left 90 born, 0 retired). Tombstones keep the log auditable; the live set
  // folds to this build's generation only. A crash between retire and born leaves an empty live
  // set, which routes the next run back down the cold path — safe, never half-alive.
  retireCategories(loadCategories().map((c) => c.name), { at });
  appendCategories(named.map((n) => ({ name: n.name, description: n.description })), { at });

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
  writeAssignments(records, undefined, 'replace');

  const kept = piles.filter((p) => labelOf.has(p.id));
  saveEngine({
    vocab: [...vocab],
    centroids: kept.map((p) => [...p.centroid]),
    labels: kept.map((p) => labelOf.get(p.id) as string),
    builtAt: at,
    pipeline: PIPELINE,
  });

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
 * discovered here (see the note below) — this is the join half of the living loop.
 *
 * NOT YET: a moment near NOTHING should be parked, and parked moments that later resemble each other
 * should be born as a new pile and named. Without that, a genuinely new behaviour is absorbed into
 * whatever pile happens to be closest and can never surface — the profile would quietly stop
 * learning. Measured at cold build only ~1.3% of moments fail the outlier test, so parking buys
 * little there; in growth it is the ONLY route by which the profile keeps learning, and it is next.
 */
export async function grow(opts: { shouldStop?: () => boolean } = {}): Promise<GrowResult> {
  const state = loadEngine();
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

  const seen = assignedKeys();
  const fresh = loadMoments().filter((m) => !seen.has(m.key));
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
  writeAssignments(fresh.map((m, i) => ({
    key: m.key,
    at,
    kinds: [state.labels[nearest(X[i], centroids)]].filter(Boolean),
  })));
  return { scored: fresh.length };
}
