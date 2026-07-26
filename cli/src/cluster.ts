/**
 * CLUSTER — the piles. Where the patterns come from, and the reason v3 costs cents instead of
 * dollars: this stage replaces `assign`, which asked a model "does this moment fit this category?"
 * roughly 190,000 times. It is arithmetic. Cost is zero.
 *
 * FOUR JOBS:
 *
 *   1. DERIVE K — how many piles this person's pile supports. Never a fixed number: someone with 500
 *      moments genuinely has fewer distinct behaviours than someone with 50,000, and hardcoding a K
 *      tuned on one pile and shipping it to strangers is the mistake the whole engine avoids.
 *   2. CLUSTER — seeded k-means. Deterministic, so a rebuild reproduces every number and a profile
 *      never moves for reasons that are not the person.
 *   3. JOIN — the growth path. New moments attach to FROZEN centres; nothing re-clusters. This is
 *      what makes "rising" and "fading" mean anything, because they track the SAME crowd over time.
 *
 * ⚠️ THERE IS DELIBERATELY NO MERGE. It was the naming call's job once, and the model's verdict
 * wobbled 1 → 14 → 2 → 0 folds across four builds of the same data (2026-07-26) — a per-pile LLM
 * judgement in the data path is `assign` in miniature, so it was removed. The arithmetic replacement
 * was then MEASURED and both simple criteria failed on the real geometry: member spread runs
 * 0.14–0.26 (1−cos) while centres of genuinely DIFFERENT moves sit only 0.06–0.09 apart, so
 * "gap < spread" chains all 30 piles into one (249/435 pairs fold), and "gap < standard error"
 * folds nothing — not even a true duplicate pair at 0.044. A correct rule needs relative structure
 * (mutual-nearest-neighbour pairs that are outliers against the gap distribution) and evidence from
 * more than one corpus. Until then the engine does not guess: the measured cost of no-merge is one
 * visible duplicate pair in 30 — two similar rows a reader can SEE — while a wrong fold fuses
 * behaviours invisibly and nothing downstream can recover them.
 *
 * THE ADMISSION FLOOR and the CIRCULAR GUARD both moved here from the deleted `discover.ts`; they
 * were the harness that kept its output honest and they still apply.
 */
import { MIN_CONVERSATIONS } from './count.js';
import type { Moment } from './moments.js';

/** The band K is derived within. Set by the PRODUCT, not by statistics: below ~8 behaviours a profile
 *  is a caricature; above ~30 the char budget in `write.ts` cuts them before they reach the file, so
 *  naming them is paid-for waste. */
export const K_MIN = 8;
export const K_MAX = 30;

/** A pile whose members are this fraction interrupts/declines is re-deriving OUR OWN labelling — the
 *  pile was built from those events — so it is circular and gets pruned. Carried from `discover.ts`. */
const CIRCULAR_ANCHOR_FRAC = 0.7;

export interface Pile {
  /** stable within a build; the naming call refers to piles by this */
  id: number;
  /** indexes into the moment array this pile was built from */
  members: number[];
  /** the pile's centre — frozen after a cold build, and what new moments join against */
  centroid: Float32Array;
}

const dot = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Unit-normalise in place, so dot product IS cosine everywhere below. */
function normalise(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** Seeded PRNG. The engine must be deterministic: the same pile must produce the same piles, or a
 *  rebuild silently reshuffles a person's profile. Never Math.random. */
function prng(seed = 12345): () => number {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

/** k-means++ seeding then Lloyd iterations, on unit vectors with cosine as the distance. */
export function kmeans(X: Float32Array[], k: number, seed = 12345): { assign: Int32Array; centroids: Float32Array[] } {
  const n = X.length;
  const d = X[0].length;
  const rnd = prng(seed);
  const centroids: Float32Array[] = [X[Math.floor(rnd() * n)].slice()];
  while (centroids.length < k) {
    const far = X.map((x) => {
      let best = -1;
      for (const c of centroids) best = Math.max(best, dot(x, c));
      return 1 - best;
    });
    let total = far.reduce((a, b) => a + b, 0);
    let t = rnd() * total;
    let i = 0;
    while (t > far[i] && i < n - 1) t -= far[i++];
    centroids.push(X[i].slice());
  }
  const assign = new Int32Array(n);
  for (let iter = 0; iter < 25; iter++) {
    for (let i = 0; i < n; i++) {
      let best = -2;
      let at = 0;
      for (let c = 0; c < k; c++) {
        const s = dot(X[i], centroids[c]);
        if (s > best) { best = s; at = c; }
      }
      assign[i] = at;
    }
    const sums = Array.from({ length: k }, () => new Float64Array(d));
    const counts = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      const c = assign[i];
      counts[c]++;
      for (let j = 0; j < d; j++) sums[c][j] += X[i][j];
    }
    for (let c = 0; c < k; c++) {
      if (!counts[c]) continue;
      centroids[c] = normalise(Float32Array.from(sums[c]));
    }
  }
  return { assign, centroids };
}

/**
 * DERIVE K — the knee, never the argmax.
 *
 * Silhouette asks, per moment: am I closer to my own pile than to the next-nearest? It penalises both
 * too few piles (everything jammed together) and too many (arbitrary splits), which is why it is the
 * criterion rather than raw tightness — tightness rises forever as K grows and would pick K = n.
 *
 * ⚠️ KNOWN DEBT, half paid. Measured on the real pile, silhouette spans only ~0.03 across K=8..30 and
 * the best K beat a rival by 0.0005 — noise. The rule therefore takes a K AT the plateau rather than
 * the argmax; the open question was which end. "Smallest" shipped first and was measured unstable
 * (2026-07-26): five new moments in ~5,700 tipped the derived K from 28 to 16, because on a flat
 * curve WHICH k first clears `peak - eps` is decided by noise. It now takes the LARGEST K at the
 * plateau, for a structural reason, not a statistical one: the pipeline HEALS over-splitting (the
 * naming call merges same-move piles, the admission floor prunes thin ones, the char budget caps the
 * file) but nothing downstream can recover two behaviours fused into one pile. When the criterion
 * cannot discriminate, err on the side the pipeline can repair. The silhouette still excludes any K
 * markedly below the peak; it just no longer bets the profile's granularity on a 0.0005 difference.
 */
export function deriveK(X: Float32Array[], lo = K_MIN, hi = K_MAX, eps = 0.01): number {
  const scores: { k: number; sil: number }[] = [];
  for (let k = lo; k <= hi; k++) {
    const { assign, centroids } = kmeans(X, k);
    let sil = 0;
    for (let i = 0; i < X.length; i++) {
      let own = -2;
      let other = -2;
      for (let c = 0; c < k; c++) {
        const s = dot(X[i], centroids[c]);
        if (c === assign[i]) own = s;
        else if (s > other) other = s;
      }
      const a = 1 - own;
      const b = 1 - other;
      sil += (b - a) / Math.max(a, b, 1e-9);
    }
    scores.push({ k, sil: sil / X.length });
  }
  const peak = Math.max(...scores.map((s) => s.sil));
  // LARGEST at the plateau — err toward granularity, which the pipeline can heal (see header).
  const atPlateau = scores.filter((s) => s.sil >= peak - eps);
  return (atPlateau[atPlateau.length - 1] ?? scores[0]).k;
}

/**
 * THE CEILING THE FLOOR IMPLIES.
 *
 * A pile must span MIN_CONVERSATIONS to earn a place, so a person with C conversations can support
 * at most C/MIN_CONVERSATIONS piles — ask for more and every pile is too thin to be admitted, and the
 * profile comes back empty.
 *
 * This is NOT tuning to corpus size, which the engine refuses to do. It is the same floor rule read
 * in the other direction: the band was always bounded by it, and saying so out loud is what lets a
 * small pile produce a small profile instead of no profile. Six conversations genuinely support two
 * patterns; claiming eight would be inventing six.
 */
export function bandFor(moments: Moment[]): { lo: number; hi: number } {
  const conversations = new Set(moments.map((m) => m.session)).size;
  const supported = Math.floor(conversations / MIN_CONVERSATIONS);
  const hi = Math.max(1, Math.min(K_MAX, supported));
  return { lo: Math.min(K_MIN, hi), hi };
}

/** Build piles from a cold pile of vectors: derive K, cluster, keep what earns admission. */
export function buildPiles(X: Float32Array[], moments: Moment[]): Pile[] {
  const { lo, hi } = bandFor(moments);
  const k = deriveK(X, lo, hi);
  const { assign, centroids } = kmeans(X, k);
  const members: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < assign.length; i++) members[assign[i]].push(i);
  return members
    .map((ms, id) => ({ id, members: ms, centroid: centroids[id] }))
    .filter((p) => admits(p, moments))
    .map((p, id) => ({ ...p, id }));
}

/**
 * Does this pile earn a place?
 *
 *   · THE FLOOR — seen in at least MIN_CONVERSATIONS different conversations. One conversation is an
 *     episode, not a pattern; the floor is what makes a claim about the person rather than about a day.
 *   · THE CIRCULAR GUARD — a pile that is overwhelmingly interrupts and declines is re-deriving the
 *     labelling we applied ourselves, so it says nothing new and never belongs in the file.
 */
export function admits(pile: Pile, moments: Moment[]): boolean {
  if (!pile.members.length) return false;
  const conversations = new Set(pile.members.map((i) => moments[i].session));
  if (conversations.size < MIN_CONVERSATIONS) return false;
  const anchors = pile.members.filter((i) => moments[i].pile !== 'ordinary').length;
  return anchors / pile.members.length < CIRCULAR_ANCHOR_FRAC;
}

/**
 * JOIN — the growth path, and the reason a profile can be rebuilt daily without churning.
 *
 * A cold build clusters once and FREEZES the centres. Every flush after embeds only what is new and
 * attaches each moment to its nearest frozen centre. Counts move; piles keep their names and their
 * birth dates; nothing re-clusters.
 *
 * Re-clustering every flush would mint new piles, rename everything, and reshuffle the file nightly —
 * destroying the stable identities that make "rising" and "fading" mean anything, because you would
 * be comparing this month's piles against last month's different piles.
 *
 * NOT YET: a moment near NOTHING should be parked, and parked moments that later bunch together
 * should be born as a new pile. Without it a genuinely new behaviour is absorbed into whatever pile
 * is nearest and can never be discovered. Measured at cold build only ~1.3% of moments fail the
 * outlier test, so parking buys little there — but in growth it is the ONLY route by which the
 * profile keeps learning, and it is the next build.
 */
export function join(vector: Float32Array, centroids: Float32Array[]): number {
  let best = -2;
  let at = 0;
  for (let c = 0; c < centroids.length; c++) {
    const s = dot(vector, centroids[c]);
    if (s > best) { best = s; at = c; }
  }
  return at;
}
