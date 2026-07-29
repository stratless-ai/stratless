/**
 * TOPICS — the knowledge leg's measurement half. Pure arithmetic plus local geometry over the
 * labelled pile: which subjects this person's own questions circle, how each ask landed, and where
 * they never go at all. No model call anywhere; nothing here persists (determinism is same corpus
 * → same read, and a stored candidate would go stale against a rebuilt pile).
 *
 * THE TEMPORAL SHAPE, which everything below leans on: a moment is (AI turn → person reply), so
 * when the person ASKS something, the ask is the `reply` of moment m — and the assistant's ANSWER
 * to it is the AI turn of next(m), the following moment in the same session. The ask itself is a
 * deictic ritual ("explain to me", "what does that mean") and carries no subject (measured, Phase
 * 0); the subject lives in the assistant's response.
 *
 * A TOPIC IS A PILE OF THE ANSWERS-TO-ASKS (the felt-gate re-founding, 2026-07-29 — the war room's
 * knowledge-leg-findings §7). The first cut derived topics from single rare terms recurring near
 * asks, and the founder's read rejected it: a term is a weak proxy for what an answer is ABOUT —
 * asks fanned out to every rare bystander word, bounces sprayed across conversation-mates, and the
 * mint set read as mush. The replacement is the engine's own founding move pointed at the AI's
 * side: fingerprint the answers, cluster them, and let subjects exist as REGIONS with mass, not
 * words. The symmetry with shape.ts is exact and inverted — person replies embed SHAPED (their
 * common words kept, subjects dropped → clustering finds acts); AI answers embed with the
 * ASSISTANT'S habitual vocabulary dropped (its rhetoric gone, subjects kept → clustering finds
 * subjects). One ask then belongs to exactly ONE pile, the discipline the engine's join has always
 * had.
 *
 * THE EVIDENCE LADDER (the handover's, verbatim):
 *   · bounce — explanation delivered → immediately returned with another ask. Loud, tied to the
 *     exact output that failed.
 *   · re-ask — the same subject asked again, sessions later. Quiet (pile membership across
 *     sessions).
 *   · quiet-while-engaged — the asks stop while the subject stays in their work. The win.
 *
 * EVERYTHING IS DERIVED PER PERSON. The ask detector is mined from THEIR recurring phrases; the
 * rare band is against THEIR corpus; the assistant-vocabulary drop set is THIS conversation
 * history's assistant. The floors are counts and geometry — content-blind, the same for everyone.
 *
 * Floors marked LOCKED were pre-registered before this code existed. Floors marked
 * MEASURE-THEN-LOCK are provisional until the pre-registration pass on the real archive — and
 * immovable after it.
 */
import type { Labelled, Adjacency } from './count.js';
import { adjacencyOf, RECENT_DAYS } from './count.js';
import type { Moment } from './moments.js';
import { termsOf } from './terms.js';
import { phrasesOf, isMachineArtifact } from './shorthand.js';
import { DEFAULT_ROOTS } from './reader.js';
import { iterateExchangesNewestFirst } from './exchange.js';
import { embedAll, runtimePresent } from './embed.js';
import { dot, kmeans, deriveK } from './cluster.js';

/* ——— the pile bar (LOCKED — the handover's, applied to pile membership) ——— */
export const THREAD_ASK_MIN = 4;
export const THREAD_SESS_MIN = 3;
export const THREAD_DAYS_MIN = 7;

/* ——— the rare band (MEASURED AND LOCKED on the real archive, 2026-07-29) ———
 * Rarity is judged on FULL-TEXT document frequency — how many answers mention the term ANYWHERE —
 * from the flush's one walk over the raw archive, never on the card's capped candidates. Measured:
 * the top-24 cap compresses common terms' df by up to 10× and INVERTS the signal (candidate-df put
 * "moat" at 102 beside "cache" at 71; full-text df separates them 648 vs 249). Piles use the band
 * only for their DISPLAY/identity terms and the bright-zone maps; existence is geometry. */
const RARE_MIN = 3;
const RARE_FRAC = 0.025;
/** The ceiling may not collapse below what one real subject occupies on a small archive. */
const RARE_CEIL_MIN = 20;

/* ——— the ask-ritual floors (measured 2026-07-29) ——— */
const RIT_MIN = 10;
const RIT_SESS = 3;
const RIT_P = 0.5;
/** The phrase must close at least this share of the HEADROOM between the base explanation rate
 *  and certainty: (P − base) / (1 − base). Raw lift was falsified on the real archive
 *  (2026-07-29): a chatty assistant explains after ~50% of ALL turns, so lift is bounded by
 *  1/base ≈ 2 and even "what does" at 95% (lift 1.9) could not clear a 2× cut. Headroom is
 *  scale-free in the base: a work phrase scores ≈ 0 whatever the base is. */
const RIT_HEADROOM = 0.5;
/** An answer this long, with no real tool work, is the assistant EXPLAINING — the shape that marks
 *  a preceding reply as an ask. (Measured: answers to known asks — median 0 tool calls, median
 *  2,840 chars.) */
export const EXPL_MIN = 800;

/* ——— the bright-zone floors (MEASURE-THEN-LOCK: CSS must land delegated, and no thin subject may) ——— */
const STRONG_MIN = 3;
const STRONG_SESS = 2;
const DELEG_SESS = 3;

/* ——— the pile geometry (the felt-gate re-founding, all MEASURE-THEN-LOCK except the abstain) ——— */
/** The assistant's habitual vocabulary: words in more than this share of its answers are its
 *  register ("let me", "honest", "answer"), not a subject — dropped before embedding. The mirror
 *  of shape.ts's KEEP_WORDS, inverted. Falsifier: the probe's rhetoric piles must dissolve while
 *  billing/infra/CI subjects survive as separate piles. */
const AI_COMMON_FRAC = 0.1;
/** K is derived on the topic corpus's own silhouette. The behavior band's cap (30) was measured
 *  as a ceiling, not a knee, on the reference archive's 581 answers-to-asks. */
const TOPIC_K_MIN = 8;
const TOPIC_K_MAX = 64;
/** ...and a pile needs a few members on average for its geometry to mean anything, so the band's
 *  top is also bounded by the corpus (≈3 members per pile). */
const PILE_MEAN_MIN = 3;
/** Fewer stamped piles than this and there is no baseline to be relative TO — tightness margins
 *  are not stamped and nothing can mint this flush. Refuse, don't lie. */
export const DISC_BASELINE_MIN = 4;

/** One ask, located. */
export interface AskEvent {
  key: string;
  session: string;
  ts: number;
  /** the answering turn's moment key — what the pile is built from */
  answerKey?: string;
  /** the explanation came back as another ask, immediately */
  bounced: boolean;
}

/** One subject the person's asks circle — a pile of the answers, and a candidate for the ledger. */
export interface TopicPile {
  /** salient display/identity terms (the members' card terms inside the rare band) */
  terms: string[];
  slug: string;
  askCount: number;
  askSessions: number;
  spanDays: number;
  /** bounced answers in THIS pile — one owner per bounce, by construction */
  bounces: number;
  askKeys: string[];
  answerKeys: string[];
  /** distinct KNOWN projects among the answers, how many answers carry a known project, and the
   *  largest single-project count — the portability facts (unknown never argues FOR portability) */
  projects: number;
  known: number;
  dominant: number;
  /** mean pairwise similarity over CROSS-SESSION member pairs — same-conversation pairs share
   *  context, not re-teaching (measured 2026-07-29: they inflate single-burst piles) */
  tightness?: number;
  /** tightness − the median across stamped candidate piles (probe 6: the ranking was right, the
   *  absolute threshold was falsified — the verdict is relative to this corpus's own baseline).
   *  Absent when unstampable (one conversation, too few piles): an unstamped pile cannot mint. */
  tightMargin?: number;
}

/** The whole read: the person's detectors and bright zones (sync, cards only), plus the located
 *  ask events the pile construction consumes. */
export interface TopicRead {
  /** the person's own mined ask phrases — how an ask is recognised (audit + tests) */
  rituals: string[];
  /** every located ask — `topicPiles` clusters their answers */
  events: AskEvent[];
  /** rare terms the person USES without asking — their strength; never mintable */
  strong: string[];
  /** rare terms the assistant keeps saying that the person never touches — chosen outsourcing,
   *  not ignorance; never mintable, and never volunteer teaching there */
  delegated: string[];
}

const kebab = (t: string): string => t.replace(/[._]+/g, '-');

/**
 * THE ONE WALK — full-text document frequency for the rare band and the drop set, the answering
 * turns' true openings for the pile construction, and each answer's project, in a single pass
 * over the raw archive (the already-paid flush pattern; never per-key lookups). The card cannot
 * carry any of this: rarity needs presence-ANYWHERE counts the top-24 cap destroys, the pile
 * wants the true 800-char opening where the card keeps 300, and `project` was deliberately
 * dropped at the moment boundary.
 */
export interface AnswerWalk {
  /** full-text df: in how many answers each term appears anywhere */
  df: Map<string, number>;
  /** answers walked — the df denominator */
  answers: number;
  /** exchange hash → the answering turn's true opening */
  heads: Map<string, string>;
  /** exchange hash → the project it happened in (absent when the transcript had none) */
  projects: Map<string, string>;
}

export function walkAnswers(roots: string[] = DEFAULT_ROOTS): AnswerWalk {
  const df = new Map<string, number>();
  const heads = new Map<string, string>();
  const projects = new Map<string, string>();
  let answers = 0;
  for (const ex of iterateExchangesNewestFirst(roots)) {
    const text = `${ex.saidHead ?? ''} ${ex.said}`.trim();
    if (!text) continue;
    answers++;
    if (ex.saidHead && !heads.has(ex.hash)) heads.set(ex.hash, ex.saidHead);
    if (ex.project && !projects.has(ex.hash)) projects.set(ex.hash, ex.project);
    for (const t of new Set(termsOf(text, Number.MAX_SAFE_INTEGER))) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return { df, answers, heads, projects };
}

/** The rare band: recurring enough to matter, rare enough to be a subject rather than this
 *  person's background vocabulary. Judged on full-text df, never candidate df. */
function rareSet(df: Map<string, number>, answers: number): Set<string> {
  const ceil = Math.max(RARE_CEIL_MIN, Math.floor(answers * RARE_FRAC));
  const out = new Set<string>();
  for (const [t, n] of df) if (n >= RARE_MIN && n <= ceil) out.add(t);
  return out;
}

/** The assistant's own register: every word in more than AI_COMMON_FRAC of its answers. */
export function aiCommon(walk: Pick<AnswerWalk, 'df' | 'answers'>): Set<string> {
  const floor = walk.answers * AI_COMMON_FRAC;
  const out = new Set<string>();
  for (const [t, n] of walk.df) if (n > floor) out.add(t);
  return out;
}

const AI_WORD = /[a-zA-Z][a-zA-Z0-9_.-]{2,}/g;

/**
 * One answer as the topic clusterer sees it: the assistant's habitual vocabulary removed, order
 * and punctuation preserved, subjects kept. The mirror of shape.ts's shapeOf — there the person's
 * COMMON words survive so clustering groups by act; here the assistant's common words LEAVE so
 * clustering groups by subject. An answer that empties (pure rhetoric) falls back to its original
 * text, the shapeOf precedent.
 */
export function aiShapeOf(text: string, common: Set<string>): string {
  const out = text
    .replace(AI_WORD, (w) => (common.has(w.toLowerCase().replace(/[._-]+$/, '')) ? '' : w))
    .replace(/\s+/g, ' ')
    .trim();
  return out || text;
}

/** The assistant EXPLAINED here: a long prose answer, not tool work. */
const isExplanation = (m: Moment): boolean => (m.saidLen ?? 0) >= EXPL_MIN && (m.calls ?? 0) <= 1;

/**
 * The person's own ask rituals, mined — the actionFor() pattern pointed at prose instead of tools.
 * A recurring opening phrase qualifies when the assistant's next move after it is an EXPLANATION
 * far above the base rate: that adjacency is what makes "explain to me" an ask and "run the tests"
 * not, with no vocabulary of ours deciding either.
 */
export function askRituals(labelled: Labelled[], adj: Adjacency): Set<string> {
  let withNext = 0;
  let explNext = 0;
  const perPhrase = new Map<string, { pairs: number; expl: number; sessions: Set<string> }>();
  for (const l of labelled) {
    const nxt = adj.next.get(l.moment.key);
    if (!nxt) continue;
    withNext++;
    const expl = isExplanation(nxt);
    if (expl) explNext++;
    for (const p of phrasesOf(l.moment.reply)) {
      let cur = perPhrase.get(p);
      if (!cur) {
        cur = { pairs: 0, expl: 0, sessions: new Set() };
        perPhrase.set(p, cur);
      }
      cur.pairs++;
      if (expl) cur.expl++;
      cur.sessions.add(l.moment.session);
    }
  }
  const base = withNext ? explNext / withNext : 0;
  const out = new Set<string>();
  if (!base || base >= 1) return out; // no explanations, or nothing BUT — either way no contrast to mine
  for (const [p, c] of perPhrase) {
    if (c.pairs < RIT_MIN || c.sessions.size < RIT_SESS) continue;
    const prob = c.expl / c.pairs;
    if (prob < RIT_P || (prob - base) / (1 - base) < RIT_HEADROOM) continue;
    if (isMachineArtifact(p)) continue;
    out.add(p);
  }
  return out;
}

/** Is this reply one of the person's asks? Membership against the mined rituals — the same
 *  phrase-candidate generator on both sides, so matching is exact, not fuzzy. Exported for the
 *  ledger's delivery-spec mining (knowledge.ts), which needs the same ruler. */
export const isAsk = (reply: string, rituals: Set<string>): boolean => phrasesOf(reply).some((p) => rituals.has(p));

/** Locate every ask; the bounce is the explanation coming straight back as another ask. */
function askEvents(labelled: Labelled[], adj: Adjacency, rituals: Set<string>): AskEvent[] {
  const out: AskEvent[] = [];
  for (const l of labelled) {
    if (!isAsk(l.moment.reply, rituals)) continue;
    const ts = Date.parse(l.moment.ts);
    if (!Number.isFinite(ts)) continue;
    const answer = adj.next.get(l.moment.key);
    const bounced = !!(answer && isExplanation(answer) && isAsk(answer.reply, rituals));
    out.push({
      key: l.moment.key,
      session: l.moment.session,
      ts,
      ...(answer ? { answerKey: answer.key } : {}),
      bounced,
    });
  }
  return out;
}

/**
 * The detector-and-zones read. Sync and cards-only on purpose (retirement and windows must never
 * stall on the walk); returns undefined when it cannot run honestly: a pile with no topic channel
 * (pre-v3 — must not read as "this person has no topics"), or a walk that found nothing (the rare
 * band would be judged on a falsified basis; refuse, don't lie).
 */
export function topicsRead(
  labelled: Labelled[],
  adj: Adjacency = adjacencyOf(labelled),
  full?: Pick<AnswerWalk, 'df' | 'answers'>,
): TopicRead | undefined {
  if (!labelled.some((l) => l.moment.aiTerms?.length)) return undefined;
  if (!full || !full.answers) return undefined;

  const rare = rareSet(full.df, full.answers);
  const rituals = askRituals(labelled, adj);
  const events = askEvents(labelled, adj, rituals);

  // The bright zones. Person-side usage is the person's own reply vocabulary, same extractor as
  // the AI side — one mechanical ruler for both.
  const byKey = new Map(labelled.map((l) => [l.moment.key, l.moment]));
  const askedTerms = new Set<string>();
  for (const e of events) {
    for (const key of [e.key, e.answerKey]) {
      if (!key) continue;
      for (const t of byKey.get(key)?.aiTerms ?? []) if (rare.has(t)) askedTerms.add(t);
    }
  }
  const personUse = new Map<string, { n: number; sessions: Set<string> }>();
  const aiSessions = new Map<string, Set<string>>();
  for (const l of labelled) {
    for (const t of new Set(l.moment.aiTerms ?? [])) {
      if (!rare.has(t)) continue;
      (aiSessions.get(t) ?? aiSessions.set(t, new Set()).get(t)!).add(l.moment.session);
    }
    if (isAsk(l.moment.reply, rituals)) continue; // engagement is what they do when NOT asking
    for (const t of new Set(termsOf(l.moment.reply))) {
      if (!rare.has(t)) continue;
      let cur = personUse.get(t);
      if (!cur) {
        cur = { n: 0, sessions: new Set() };
        personUse.set(t, cur);
      }
      cur.n++;
      cur.sessions.add(l.moment.session);
    }
  }
  const strong: string[] = [];
  const delegated: string[] = [];
  for (const t of rare) {
    const use = personUse.get(t);
    if (use && use.n >= STRONG_MIN && use.sessions.size >= STRONG_SESS) {
      strong.push(t);
    } else if (!use && !askedTerms.has(t) && (aiSessions.get(t)?.size ?? 0) >= DELEG_SESS) {
      // The assistant keeps saying it, across sessions; the person never asks about it and never
      // types it. That is chosen outsourcing — a zone the file must not volunteer teaching in.
      delegated.push(t);
    }
  }
  strong.sort();
  delegated.sort();

  return { rituals: [...rituals].sort(), events, strong, delegated };
}

/**
 * THE PILE CONSTRUCTION — subjects as regions of answer-space. Embeds the aiShaped openings of
 * the answers-to-asks, derives K on this corpus's own silhouette, clusters, and reads each pile's
 * evidence. Returns [] when it cannot run honestly: the runtime is absent (a background path must
 * NEVER fetch — the grow precedent), or too few answers to cluster. Every returned pile already
 * clears the LOCKED bar; margins are stamped only when a baseline exists.
 */
export async function topicPiles(events: AskEvent[], labelled: Labelled[], walk: AnswerWalk): Promise<TopicPile[]> {
  if (process.env.STRATLESS_FAKE_EMBED !== '1' && !runtimePresent()) return [];
  const byKey = new Map(labelled.map((l) => [l.moment.key, l.moment]));

  const items = events
    .map((e) => ({ e, head: e.answerKey ? walk.heads.get(e.answerKey) : undefined }))
    .filter((x): x is { e: AskEvent & { answerKey: string }; head: string } => !!x.head);
  // Below ~two real piles' worth of answers the geometry means nothing — the honest empty answer.
  if (items.length < TOPIC_K_MIN * PILE_MEAN_MIN) return [];

  const common = aiCommon(walk);
  let X: Float32Array[];
  try {
    X = await embedAll(items.map((i) => aiShapeOf(i.head, common)));
  } catch {
    return []; // no model — candidates simply wait for a later flush
  }

  const hi = Math.max(2, Math.min(TOPIC_K_MAX, Math.floor(items.length / PILE_MEAN_MIN)));
  // The band's floor scales with the corpus: forcing k above what the answers can hold does not
  // find more subjects, it SHATTERS the loosest one into sub-bar fragments (measured on the
  // fixture pathology; ~a dozen answers per pile at the floor is the guard).
  const lo = Math.min(hi, Math.max(2, Math.min(TOPIC_K_MIN, Math.floor(items.length / 12))));
  const k = deriveK(X, lo, hi);
  const { assign } = kmeans(X, k);

  const groups = new Map<number, number[]>();
  for (let i = 0; i < items.length; i++) (groups.get(assign[i]) ?? groups.set(assign[i], []).get(assign[i])!).push(i);

  const rare = rareSet(walk.df, walk.answers);
  const out: TopicPile[] = [];
  for (const members of groups.values()) {
    const evs = members.map((i) => items[i].e).sort((a, b) => a.ts - b.ts);
    const sessions = new Set(evs.map((e) => e.session));
    const spanDays = Math.round((evs[evs.length - 1].ts - evs[0].ts) / 86400_000);
    // The LOCKED bar, on pile membership.
    if (evs.length < THREAD_ASK_MIN || sessions.size < THREAD_SESS_MIN || spanDays < THREAD_DAYS_MIN) continue;

    // Salient identity terms: what the members' answer cards keep leading with, inside the band.
    const termCount = new Map<string, number>();
    for (const e of evs) {
      for (const t of new Set(byKey.get(e.answerKey)?.aiTerms ?? [])) {
        if (rare.has(t)) termCount.set(t, (termCount.get(t) ?? 0) + 1);
      }
    }
    const terms = [...termCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([t]) => t);

    // The portability facts. Unknown projects are counted, never credited: they can block
    // portability downstream, never argue for it.
    const projCount = new Map<string, number>();
    let known = 0;
    for (const e of evs) {
      const p = walk.projects.get(e.answerKey);
      if (!p) continue;
      known++;
      projCount.set(p, (projCount.get(p) ?? 0) + 1);
    }

    // Cross-session tightness — the re-teaching signal (same-conversation pairs share context,
    // not re-teaching; a pile answered inside one conversation stays unstamped).
    let sum = 0;
    let n = 0;
    for (let a = 0; a < members.length; a++)
      for (let b = a + 1; b < members.length; b++) {
        if (items[members[a]].e.session === items[members[b]].e.session) continue;
        sum += dot(X[members[a]], X[members[b]]);
        n++;
      }

    out.push({
      terms,
      slug: terms.slice(0, 2).map(kebab).join('-') || `pile-${evs[0].key.slice(0, 6)}`,
      askCount: evs.length,
      askSessions: sessions.size,
      spanDays,
      bounces: evs.filter((e) => e.bounced).length,
      askKeys: evs.map((e) => e.key),
      answerKeys: evs.map((e) => e.answerKey),
      projects: projCount.size,
      known,
      dominant: projCount.size ? Math.max(...projCount.values()) : 0,
      ...(n ? { tightness: sum / n } : {}),
    });
  }

  // The relative stamp: tightness − median, over the piles that HAVE a tightness. Too few and
  // there is no baseline to be relative to — everything stays unstamped and nothing can mint.
  const stamped = out.filter((p) => typeof p.tightness === 'number');
  if (stamped.length >= DISC_BASELINE_MIN) {
    const sorted = stamped.map((p) => p.tightness!).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    for (const p of stamped) p.tightMargin = p.tightness! - median;
  }

  return out.sort((a, b) => b.bounces - a.bounces || b.askCount - a.askCount || a.slug.localeCompare(b.slug));
}

/**
 * One window's re-measurement of a topic — the lifecycle's ruler (the gapWindowRead shape).
 * Term-based and cards-only ON PURPOSE: retirement runs every flush and must never need the
 * runtime or the walk. `askRate` is asks whose context names the topic, per window moment;
 * `engageRate` is the person TYPING the topic's terms outside an ask — the absorbed-vs-decay
 * discriminator's two hands. `sample` keeps a quiet window from reading as anything.
 */
export interface TopicWindowRead {
  askRate: number;
  engageRate: number;
  sessions: number;
  sample: number;
}

function readOver(rows: Labelled[], adj: Adjacency, rituals: Set<string>, terms: Set<string>): TopicWindowRead {
  if (!rows.length) return { askRate: 0, engageRate: 0, sessions: 0, sample: 0 };
  let asks = 0;
  let engage = 0;
  const sessions = new Set<string>();
  for (const l of rows) {
    const ask = isAsk(l.moment.reply, rituals);
    const answer = adj.next.get(l.moment.key);
    const inContext =
      (l.moment.aiTerms ?? []).some((t) => terms.has(t)) || (ask && (answer?.aiTerms ?? []).some((t) => terms.has(t)));
    if (inContext) sessions.add(l.moment.session);
    if (ask && inContext) asks++;
    else if (!ask && termsOf(l.moment.reply).some((t) => terms.has(t))) {
      engage++;
      sessions.add(l.moment.session);
    }
  }
  return { askRate: asks / rows.length, engageRate: engage / rows.length, sessions: sessions.size, sample: rows.length };
}

/** The topic's own active span — birth baseline, alive by construction (it contains the asks). */
export function topicSpanRead(labelled: Labelled[], threadTerms: string[], askKeys: string[], adj: Adjacency, rituals: Set<string>): TopicWindowRead {
  const keys = new Set(askKeys);
  const ts = labelled.filter((l) => keys.has(l.moment.key)).map((l) => Date.parse(l.moment.ts)).filter(Number.isFinite);
  if (!ts.length) return { askRate: 0, engageRate: 0, sessions: 0, sample: 0 };
  const lo = Math.min(...ts);
  const hi = Math.max(...ts);
  const rows = labelled.filter((l) => {
    const t = Date.parse(l.moment.ts);
    return Number.isFinite(t) && t >= lo && t <= hi;
  });
  return readOver(rows, adj, rituals, new Set(threadTerms));
}

/** The trailing window — what each later flush measures the ledger against. */
export function topicWindowRead(
  labelled: Labelled[],
  threadTerms: string[],
  adj: Adjacency,
  rituals: Set<string>,
  nowMs: number,
  days: number = RECENT_DAYS,
): TopicWindowRead {
  const cut = nowMs - days * 24 * 3600_000;
  const rows = labelled.filter((l) => {
    const t = Date.parse(l.moment.ts);
    return Number.isFinite(t) && t >= cut && t <= nowMs;
  });
  return readOver(rows, adj, rituals, new Set(threadTerms));
}
