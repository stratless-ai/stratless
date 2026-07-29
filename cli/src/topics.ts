/**
 * TOPICS — the knowledge leg's measurement half. Pure arithmetic over the labelled pile: which
 * subjects this person's own questions circle, how each ask landed, and where they never go at all.
 * No model, no cost, recomputed every flush from the cards (nothing here persists — determinism is
 * same corpus → same threads, and a stored thread would go stale against a rebuilt pile).
 *
 * THE TEMPORAL SHAPE, which everything below leans on: a moment is (AI turn → person reply), so
 * when the person ASKS something, the ask is the `reply` of moment m — and the assistant's ANSWER
 * to it is the AI turn of next(m), the following moment in the same session. The ask's topic
 * therefore lives in the AI text on BOTH sides of it (measured, Phase 0: the ask itself is a
 * deictic ritual — "explain to me", "what does" — and carries no subject; the person's fixed
 * phrases thread only to themselves).
 *
 * THE EVIDENCE LADDER (the handover's, verbatim):
 *   · bounce — explanation delivered → immediately returned with another ask. Loud, tied to the
 *     exact output that failed (106 on the reference archive).
 *   · re-ask — the same topic asked again, sessions later. Quiet.
 *   · quiet-while-engaged — the asks stop while the topic stays in their work. The win.
 *
 * EVERYTHING IS DERIVED PER PERSON. The ask detector is mined from THEIR recurring phrases (the
 * probe regexes that found this design were calibrated to one person and are not in this file);
 * rarity is against THEIR corpus; the delivery spec upstream is theirs. The floors are counts and
 * geometry — content-blind, the same for everyone.
 *
 * Floors marked LOCKED were pre-registered by the Phase 0b probes before this code existed.
 * Floors marked MEASURE-THEN-LOCK are provisional: the pre-registration pass (on the real archive,
 * against the probes' hand-verdicts, BEFORE the blind acceptance run) locks them; after that run
 * they may not move.
 */
import type { Labelled, Adjacency } from './count.js';
import { adjacencyOf, RECENT_DAYS } from './count.js';
import type { Moment } from './moments.js';
import { termsOf } from './terms.js';
import { phrasesOf, isMachineArtifact } from './shorthand.js';
import { DEFAULT_ROOTS } from './reader.js';
import { iterateExchangesNewestFirst } from './exchange.js';
import { embedAll, runtimePresent } from './embed.js';
import { dot } from './cluster.js';

/* ——— the thread bar (LOCKED — probe 4's own measured bar, 16 threads cleared it) ——— */
export const THREAD_ASK_MIN = 4;
export const THREAD_SESS_MIN = 3;
export const THREAD_DAYS_MIN = 7;

/* ——— the rare band (MEASURED AND LOCKED on the real archive, 2026-07-29) ———
 * Rarity is judged on FULL-TEXT document frequency — how many answers mention the term ANYWHERE —
 * from the flush's one walk over the raw archive, never on the card's capped candidates. Measured:
 * the top-24 cap compresses common terms' df by up to 10× and INVERTS the signal (candidate-df put
 * "moat" at 102 beside "cache" at 71; full-text df separates them 648 vs 249). On the labeled
 * good/bad set every real topic sat ≤ 249 and every ambient/strategy term ≥ 342; the 2.5% ceiling
 * (~144 on the reference archive) also excludes the person's own design-vocabulary tail, and the
 * known threads ride their rarer aliases where a lead term (bare "cache") sits above it. */
const RARE_MIN = 3;
const RARE_FRAC = 0.025;
/** The ceiling may not collapse below what one real thread occupies: on a small archive the
 *  fraction sits under the thread bar itself (a ceiling of 3 cannot admit a term that must appear
 *  in ≥4 ask events) and no topic could ever thread. Small piles get fixed room; big the fraction. */
const RARE_CEIL_MIN = 20;

/* ——— alias merge (MEASURE-THEN-LOCK: wrangler/workers must fold to one thread) ——— */
const MERGE_J = 0.5;

/* ——— the ask-ritual floors (MEASURE-THEN-LOCK: derived rituals must recover ≥80% of the probes'
 * regex-found asks and land near the measured 17% ask share) ——— */
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
 *  a preceding reply as an ask. (MEASURE-THEN-LOCK.) */
export const EXPL_MIN = 800;

/* ——— the bright-zone floors (MEASURE-THEN-LOCK: CSS must land delegated on the reference archive,
 * and no thin topic may) ——— */
const STRONG_MIN = 3;
const STRONG_SESS = 2;
const DELEG_SESS = 3;

/** One ask, located and attributed. */
interface AskEvent {
  key: string;
  session: string;
  ts: number;
  /** the answering turn's moment key — what the discriminator embeds */
  answerKey?: string;
  /** rare terms of the ask's AI context, both sides — the ask's topic identity */
  terms: Set<string>;
  /** the explanation came back as another ask, immediately */
  bounced: boolean;
  /** rare terms of the failed explanation — what a bounce is attributable to */
  bounceTerms: Set<string>;
}

/** One topic the person's asks circle — a candidate for the knowledge ledger. */
export interface TopicThread {
  /** member terms, most-asked first — the thread's identity and its self-naming */
  terms: string[];
  /** display/identity slug from the lead terms */
  slug: string;
  askCount: number;
  askSessions: number;
  spanDays: number;
  bounces: number;
  /** moment keys of the asks (per-session evidence for the voicer's quotes) */
  askKeys: string[];
  /** moment keys of the answering explanations (the discriminator embeds these turns' openings) */
  answerKeys: string[];
  /** the answering turns' sessions, aligned with answerKeys — the discriminator pairs only ACROSS
   *  sessions (re-teaching is the same lesson in a LATER conversation; two answers inside one
   *  conversation share its context and their similarity says nothing about re-teaching) */
  answerSessions: string[];
  /** mean pairwise answer similarity − corpus median: the relative discriminator's verdict.
   *  Present only when the discriminator ran (runtime present, enough threads). */
  simMargin?: number;
}

/** The whole read: threads that clear the bar, and the bright zones around them. */
export interface TopicRead {
  /** the person's own mined ask phrases — how an ask is recognised (audit + tests) */
  rituals: string[];
  /** bar-clearing candidate threads (the THIN state), bounce-heaviest first */
  threads: TopicThread[];
  /** rare terms the person USES without asking — their strength; never mintable */
  strong: string[];
  /** rare terms the assistant keeps saying that the person never touches — chosen outsourcing,
   *  not ignorance; never mintable, and never volunteer teaching there */
  delegated: string[];
}

const kebab = (t: string): string => t.replace(/[._]+/g, '-');

/**
 * THE ONE WALK — full-text document frequency for the rare band, and the answering turns' true
 * openings for the discriminator, in a single pass over the raw archive (the already-paid flush
 * pattern; never per-key lookups). The card cannot carry this: rarity needs presence-ANYWHERE
 * counts the top-24 cap destroys (see the rare-band note above), and the discriminator wants the
 * true 800-char opening where the card keeps 300.
 */
export interface AnswerWalk {
  /** full-text df: in how many answers each term appears anywhere */
  df: Map<string, number>;
  /** answers walked — the df denominator */
  answers: number;
  /** exchange hash → the answering turn's true opening */
  heads: Map<string, string>;
}

export function walkAnswers(roots: string[] = DEFAULT_ROOTS): AnswerWalk {
  const df = new Map<string, number>();
  const heads = new Map<string, string>();
  let answers = 0;
  for (const ex of iterateExchangesNewestFirst(roots)) {
    const text = `${ex.saidHead ?? ''} ${ex.said}`.trim();
    if (!text) continue;
    answers++;
    if (ex.saidHead && !heads.has(ex.hash)) heads.set(ex.hash, ex.saidHead);
    for (const t of new Set(termsOf(text, Number.MAX_SAFE_INTEGER))) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return { df, answers, heads };
}

/** The rare band: recurring enough to thread, rare enough to be a subject rather than this
 *  person's background vocabulary. Judged on full-text df, never candidate df. */
function rareSet(df: Map<string, number>, answers: number): Set<string> {
  const ceil = Math.max(RARE_CEIL_MIN, Math.floor(answers * RARE_FRAC));
  const out = new Set<string>();
  for (const [t, n] of df) if (n >= RARE_MIN && n <= ceil) out.add(t);
  return out;
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
  // The base rate: how often ANY reply is answered with an explanation.
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

/** Locate every ask and attribute it: topic terms from the AI context on both sides, bounce from
 *  the immediate return. */
function askEvents(labelled: Labelled[], adj: Adjacency, rituals: Set<string>, rare: Set<string>): AskEvent[] {
  const out: AskEvent[] = [];
  for (const l of labelled) {
    if (!isAsk(l.moment.reply, rituals)) continue;
    const ts = Date.parse(l.moment.ts);
    if (!Number.isFinite(ts)) continue;
    const answer = adj.next.get(l.moment.key);
    const terms = new Set<string>();
    for (const t of l.moment.aiTerms ?? []) if (rare.has(t)) terms.add(t);
    for (const t of answer?.aiTerms ?? []) if (rare.has(t)) terms.add(t);
    // The bounce: the explanation came back as another ask, immediately. Attributable only to the
    // rare terms the failed explanation itself named.
    const bounceTerms = new Set<string>();
    let bounced = false;
    if (answer && isExplanation(answer) && isAsk(answer.reply, rituals)) {
      bounced = true;
      for (const t of answer.aiTerms ?? []) if (rare.has(t)) bounceTerms.add(t);
    }
    out.push({
      key: l.moment.key,
      session: l.moment.session,
      ts,
      ...(answer ? { answerKey: answer.key } : {}),
      terms,
      bounced,
      bounceTerms,
    });
  }
  return out;
}

/** Union-find, the small honest kind. */
function unionFind(n: number): { find: (i: number) => number; union: (a: number, b: number) => void } {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  return { find, union: (a, b) => void (parent[find(a)] = find(b)) };
}

/**
 * Thread the asks: per rare term, the asks whose context named it; a term threads at the LOCKED
 * bar; aliases that answer the same asks (wrangler/workers) fold into one thread by Jaccard
 * overlap of their ask sets.
 */
function threadsOf(events: AskEvent[]): TopicThread[] {
  const byTerm = new Map<string, AskEvent[]>();
  for (const e of events) for (const t of e.terms) (byTerm.get(t) ?? byTerm.set(t, []).get(t)!).push(e);

  const qualifying: { term: string; events: AskEvent[] }[] = [];
  for (const [term, evs] of byTerm) {
    if (evs.length < THREAD_ASK_MIN) continue;
    if (new Set(evs.map((e) => e.session)).size < THREAD_SESS_MIN) continue;
    const ts = evs.map((e) => e.ts);
    if ((Math.max(...ts) - Math.min(...ts)) / 86400_000 < THREAD_DAYS_MIN) continue;
    qualifying.push({ term, events: evs });
  }
  qualifying.sort((a, b) => a.term.localeCompare(b.term)); // deterministic merge order

  const uf = unionFind(qualifying.length);
  for (let i = 0; i < qualifying.length; i++) {
    const a = new Set(qualifying[i].events.map((e) => e.key));
    for (let j = i + 1; j < qualifying.length; j++) {
      const b = qualifying[j].events;
      let inter = 0;
      for (const e of b) if (a.has(e.key)) inter++;
      const union = a.size + b.length - inter;
      if (union && inter / union >= MERGE_J) uf.union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < qualifying.length; i++) {
    const r = uf.find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(i);
  }

  const out: TopicThread[] = [];
  for (const members of groups.values()) {
    const terms = members
      .map((i) => qualifying[i])
      .sort((a, b) => b.events.length - a.events.length || a.term.localeCompare(b.term))
      .map((q) => q.term);
    const termSet = new Set(terms);
    const byKey = new Map<string, AskEvent>();
    for (const i of members) for (const e of qualifying[i].events) byKey.set(e.key, e);
    const evs = [...byKey.values()].sort((a, b) => a.ts - b.ts);
    const bounces = evs.filter((e) => e.bounced && [...e.bounceTerms].some((t) => termSet.has(t))).length;
    const answered = evs.filter((e): e is AskEvent & { answerKey: string } => typeof e.answerKey === 'string');
    out.push({
      terms,
      slug: terms.slice(0, 2).map(kebab).join('-'),
      askCount: evs.length,
      askSessions: new Set(evs.map((e) => e.session)).size,
      spanDays: Math.round((evs[evs.length - 1].ts - evs[0].ts) / 86400_000),
      bounces,
      askKeys: evs.map((e) => e.key),
      answerKeys: answered.map((e) => e.answerKey),
      answerSessions: answered.map((e) => e.session),
    });
  }
  return out.sort((a, b) => b.bounces - a.bounces || b.askCount - a.askCount || a.slug.localeCompare(b.slug));
}

/**
 * The whole knowledge read. Returns undefined when it cannot run honestly: a pile with no topic
 * channel (pre-v3 — must not read as "this person has no topics"), or a walk that found nothing
 * (rarity would be judged on a falsified basis; refuse, don't lie).
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
  const events = askEvents(labelled, adj, rituals, rare);
  const threads = threadsOf(events);

  // The bright zones, mapped over the rare terms OUTSIDE every thread. Person-side usage is the
  // person's own reply vocabulary, same extractor as the AI side — one mechanical ruler for both.
  const threaded = new Set(threads.flatMap((t) => t.terms));
  const askedTerms = new Set<string>();
  for (const e of events) for (const t of e.terms) askedTerms.add(t);
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
    if (threaded.has(t)) continue;
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

  return { rituals: [...rituals].sort(), threads, strong, delegated };
}

/**
 * One window's re-measurement of a topic — the lifecycle's ruler (the gapWindowRead shape).
 * `askRate` is asks whose context names the topic, per window moment; `engageRate` is the person
 * TYPING the topic's terms outside an ask, per window moment — the absorbed-vs-decay
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

/* ——— THE RELATIVE DISCRIMINATOR ———
 *
 * Re-teaching vs co-construction, told apart by how the assistant's explanations RELATE TO EACH
 * OTHER: an explanation re-delivered near-identically across a thread is the same lesson not
 * landing (a gap); explanations that evolve are work moving forward (never mint). Measured first
 * (Phase 0b): an absolute similarity threshold was FALSIFIED, but the RANKING was correct — the
 * known re-taught thread scored highest, strategy threads lowest. So the verdict is relative: each
 * thread's mean answer-similarity against the median of all candidate threads, this corpus's own
 * baseline. The same relative-not-absolute conclusion is written down independently in cluster.ts's
 * header — absolute cosine cuts fail on this substrate.
 */

/** Fewer candidate threads than this and there is no baseline to be relative TO — the
 *  discriminator abstains and nothing mints this flush. Refuse, don't lie. */
export const DISC_BASELINE_MIN = 4;
/** Most recent answers embedded per thread — the cost bound (~20 × threads embeds per flush). */
const ANSWER_HEAD_CAP = 20;

/**
 * Score every eligible thread's answer-similarity and stamp `simMargin` (score − corpus median).
 * Returns false without touching anything when it cannot run honestly: the runtime is absent (a
 * background path must NEVER fetch it — the grow precedent), or there are too few threads to have
 * a baseline. The mint gate downstream treats an unstamped thread as unmintable.
 */
export async function discriminate(threads: TopicThread[], heads: Map<string, string>): Promise<boolean> {
  if (process.env.STRATLESS_FAKE_EMBED !== '1' && !runtimePresent()) return false;
  const jobs: { t: TopicThread; texts: string[]; sessions: string[] }[] = [];
  const all: string[] = [];
  for (const t of threads) {
    const keys = t.answerKeys.slice(-ANSWER_HEAD_CAP);
    const sess = t.answerSessions.slice(-ANSWER_HEAD_CAP);
    const texts: string[] = [];
    const sessions: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      const h = heads.get(keys[i]);
      if (!h) continue;
      texts.push(h);
      sessions.push(sess[i] ?? '');
    }
    // Cross-session pairs only (see answerSessions above): a thread answered inside one
    // conversation has NO re-teaching evidence — it stays unstamped and cannot mint. Measured on
    // the blind run (2026-07-29): same-session pairs inflated single-burst design threads to the
    // top of the ranking while the known re-taught threads sat below them.
    if (new Set(sessions).size < 2) continue;
    jobs.push({ t, texts, sessions });
    all.push(...texts);
  }
  if (jobs.length < DISC_BASELINE_MIN) return false;
  const vecs = await embedAll(all);
  let off = 0;
  const scored: { t: TopicThread; score: number }[] = [];
  for (const { t, texts, sessions } of jobs) {
    const vs = vecs.slice(off, off + texts.length);
    off += texts.length;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < vs.length; i++)
      for (let j = i + 1; j < vs.length; j++) {
        if (sessions[i] === sessions[j]) continue; // same conversation — context, not re-teaching
        sum += dot(vs[i], vs[j]);
        n++;
      }
    if (!n) continue;
    scored.push({ t, score: sum / n });
  }
  if (scored.length < DISC_BASELINE_MIN) return false;
  const sorted = scored.map((s) => s.score).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  for (const { t, score } of scored) t.simMargin = score - median;
  return true;
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
