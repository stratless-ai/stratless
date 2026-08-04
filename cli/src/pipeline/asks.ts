/**
 * ASKS — the mode-2 witness. How this person asks to understand, and how the assistant's answers
 * land: the raw material for the wrong-altitude failure mode (the AI emitting denser than the
 * person can absorb) and its evidence surfaces. Pure arithmetic; no model call anywhere; nothing
 * here persists — the read recomputes each flush (same corpus → same read).
 *
 * THE DOCTRINE (adopted 2026-07-29): **LIFT grades the AI, never the human.** Everything measured
 * here is the channel — which emissions failed, at what altitude — never the person's knowledge.
 * A bounce is a defect report against the ANSWER, not the reader.
 *
 * THE TEMPORAL SHAPE, which everything below leans on: a moment is (AI turn → person reply), so
 * when the person ASKS something, the ask is the `reply` of moment m — and the assistant's ANSWER
 * to it is the AI turn of next(m), the following moment in the same session. The ask itself is a
 * deictic ritual ("explain to me", "what does that mean") and carries no subject (measured, Phase
 * 0); whatever subject exists lives in the assistant's response.
 *
 * THE CHANNEL STATES (measured before built; re-read under the doctrine):
 *   · unlanded  — delivery keeps failing: they ask, and explanations come straight back.
 *   · strong    — no intervention needed: they engage in a subject's own vocabulary without asking.
 *   · delegated — no channel wanted: they never enter the subject at all — chosen outsourcing,
 *                 not ignorance (measured: the reference person's near-zero-ask zones are CSS).
 *                 The assistant must not volunteer teaching there.
 *
 * EVERYTHING IS DERIVED PER PERSON. The ask detector is mined from THEIR recurring phrases (the
 * probe regexes that found this design were calibrated to one person and are not in this file);
 * rarity is against THEIR corpus. The floors are counts — content-blind, the same for everyone.
 *
 * Floors marked LOCKED were pre-registered before this code existed. Floors marked
 * MEASURE-THEN-LOCK are provisional until the pre-registration pass on the real archive — and
 * immovable after it.
 */
import type { Labelled, Adjacency } from './count.js';
import { adjacencyOf, RECENT_DAYS } from './count.js';
import type { Moment } from './moments.js';
import { termsOf } from './terms.js';
import { phrasesOf, isMachineArtifact, norm, allStop } from './shorthand.js';
import { iterateExchangesNewestFirst } from './exchange.js';

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

/* ——— the rare band (MEASURED AND LOCKED on the real archive, 2026-07-29) ———
 * Rarity is judged on FULL-TEXT document frequency — how many answers mention the term ANYWHERE —
 * from the flush's one walk over the raw archive, never on the card's capped candidates (the
 * top-24 cap compresses common terms' df by up to 10× and INVERTS the signal). Used only for the
 * bright-zone maps; nothing here mints. */
const RARE_MIN = 3;
const RARE_FRAC = 0.025;
const RARE_CEIL_MIN = 20;

/* ——— the bright-zone floors (MEASURE-THEN-LOCK: CSS must land delegated on the reference
 * archive, and no unlanded zone may) ——— */
const STRONG_MIN = 3;
const STRONG_SESS = 2;
const DELEG_SESS = 3;

/** One ask, located. */
export interface AskEvent {
  key: string;
  session: string;
  ts: number;
  /** the answering turn's moment key */
  answerKey?: string;
  /** the explanation came back as another ask, immediately — the loud witness of wrong altitude */
  bounced: boolean;
}

/** The whole witness read: the person's detectors, every located ask, and the bright zones. */
export interface AskRead {
  /** the person's own mined ask phrases — how an ask is recognised (audit + tests) */
  rituals: string[];
  events: AskEvent[];
  /** rare terms the person USES without asking — their strength; never patch material */
  strong: string[];
  /** rare terms the assistant keeps saying that the person never touches — chosen outsourcing;
   *  never patch material, and never volunteer teaching there */
  delegated: string[];
}

/**
 * THE ONE WALK — full-text document frequency for the rare band, the answering turns' true
 * openings, and each answer's project, in a single pass over the raw archive (the already-paid
 * flush pattern; never per-key lookups). The card cannot carry this: rarity needs
 * presence-ANYWHERE counts the top-24 cap destroys, and `project` was deliberately dropped at
 * the moment boundary.
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

export function walkAnswers(roots?: string[]): AnswerWalk {
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
 *  phrase-candidate generator on both sides, so matching is exact, not fuzzy. */
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
 * The witness read. Sync and cards-plus-walk on purpose; returns undefined when it cannot run
 * honestly: a pile with no answer channel (pre-v3 — must not read as "this person never asks"),
 * or a walk that found nothing (the rare band would be judged on a falsified basis; refuse,
 * don't lie).
 */
export function asksRead(
  labelled: Labelled[],
  adj: Adjacency = adjacencyOf(labelled),
  full?: Pick<AnswerWalk, 'df' | 'answers'>,
): AskRead | undefined {
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
      delegated.push(t);
    }
  }
  strong.sort();
  delegated.sort();

  return { rituals: [...rituals].sort(), events, strong, delegated };
}

/* ——— the window reads — the dyno's per-mode rulers (the gapWindowRead shape) ——— */

/** `askRate` is asks whose context names the terms, per window moment; `engageRate` is the person
 *  TYPING the terms outside an ask — the absorbed-vs-decay discriminator's two hands. `sample`
 *  keeps a quiet window from reading as anything. Term-based and cards-only ON PURPOSE:
 *  re-measurement runs every flush and must never need the runtime or the walk. */
export interface AskWindowRead {
  askRate: number;
  engageRate: number;
  sessions: number;
  sample: number;
}

function readOver(rows: Labelled[], adj: Adjacency, rituals: Set<string>, terms: Set<string>): AskWindowRead {
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

/** The patch's own active span — birth baseline, alive by construction (it brackets the asks). */
export function askSpanRead(labelled: Labelled[], terms: string[], askKeys: string[], adj: Adjacency, rituals: Set<string>): AskWindowRead {
  const keys = new Set(askKeys);
  const ts = labelled.filter((l) => keys.has(l.moment.key)).map((l) => Date.parse(l.moment.ts)).filter(Number.isFinite);
  if (!ts.length) return { askRate: 0, engageRate: 0, sessions: 0, sample: 0 };
  const lo = Math.min(...ts);
  const hi = Math.max(...ts);
  const rows = labelled.filter((l) => {
    const t = Date.parse(l.moment.ts);
    return Number.isFinite(t) && t >= lo && t <= hi;
  });
  return readOver(rows, adj, rituals, new Set(terms));
}

/** The trailing window — what each tune release measures against. */
export function askWindowRead(
  labelled: Labelled[],
  terms: string[],
  adj: Adjacency,
  rituals: Set<string>,
  nowMs: number,
  days: number = RECENT_DAYS,
): AskWindowRead {
  const cut = nowMs - days * 24 * 3600_000;
  const rows = labelled.filter((l) => {
    const t = Date.parse(l.moment.ts);
    return Number.isFinite(t) && t >= cut && t <= nowMs;
  });
  return readOver(rows, adj, rituals, new Set(terms));
}

/* ——— the mode-2 evidence surfaces ——— */

/** THE META EVIDENCE — the signature line's measured backing. A snapshot refreshed each flush
 *  from every located ask: the person-level truth (how grounding must arrive) is distilled from
 *  ALL their asks, project-bound ones included. The printed line is a code template over these
 *  numbers plus the person's own derived delivery phrases — never voiced, so it cannot wobble;
 *  the counts move each flush like every receipt. */
export interface MetaEvidence {
  asks: number;
  sessions: number;
  bounces: number;
  /** the person's own recurring ask modifiers ("in layman"), derived — possibly empty, never defaulted */
  specPhrases: string[];
}

export function metaEvidence(read: AskRead, delivery: { phrase: string; count: number }[]): MetaEvidence {
  const sessions = new Set<string>();
  let bounces = 0;
  for (const e of read.events) {
    sessions.add(e.session);
    if (e.bounced) bounces++;
  }
  return { asks: read.events.length, sessions: sessions.size, bounces, specPhrases: delivery.map((d) => d.phrase) };
}

const DELIV_MIN = 10;
const DELIV_SESS = 3;
const DELIV_TOP = 3;
/** A delivery modifier lives in ASKS: the gram must be near-exclusive to ask replies. Measured on
 *  the real archive (2026-07-29): without this, generic person grammar ("want to", "what i")
 *  cleared the count floors while the true modifier ("in layman") is ask-exclusive. */
const DELIV_ASK_SHARE = 0.7;

/**
 * The person's OWN ask modifiers: recurring interior n-grams of their ask replies ("in layman",
 * "step by step") — how they keep asking to be answered. Interior on purpose: the OPENING grams
 * are the rituals themselves (decode-key material). Derived per person; when nothing recurs, the
 * spec is honestly empty — never defaulted to anyone else's "layman".
 */
export function deliverySpec(labelled: Labelled[], rituals: Set<string>): { phrase: string; count: number }[] {
  const count = new Map<string, { n: number; sessions: Set<string> }>();
  const elsewhere = new Map<string, number>();
  for (const l of labelled) {
    const words = norm(l.moment.reply).split(' ').filter(Boolean);
    if (!isAsk(l.moment.reply, rituals)) {
      // The contrast corpus: a gram the person uses everywhere is their grammar, not a modifier.
      const grams = new Set<string>();
      for (const n of [2, 3]) for (let i = 0; i + n <= words.length; i++) grams.add(words.slice(i, i + n).join(' '));
      for (const g of grams) elsewhere.set(g, (elsewhere.get(g) ?? 0) + 1);
      continue;
    }
    // Grams start AFTER the matched ritual prefix: the ritual's own tail ("to me") recurs exactly
    // as often as any real modifier and would pollute the spec with fragments of the ask itself.
    let start = 1;
    for (const r of rituals) {
      const rw = r.split(' ');
      if (rw.length < words.length && rw.every((w, i) => words[i] === w)) start = Math.max(start, rw.length);
    }
    const grams = new Set<string>();
    for (const n of [2, 3]) {
      for (let i = start; i + n <= words.length; i++) grams.add(words.slice(i, i + n).join(' '));
    }
    // The person's own ritual vocabulary: a gram made entirely of it (plus stopwords) is a
    // fragment of HOW they ask ("it mean"), not of how they want it answered — ask-exclusive by
    // construction, which is exactly why the ask-share test cannot catch it.
    const ritualVocab = new Set<string>();
    for (const r of rituals) for (const w of r.split(' ')) ritualVocab.add(w);
    const ritualFragment = (g: string): boolean => g.split(' ').every((w) => ritualVocab.has(w) || allStop(w));
    for (const g of grams) {
      if (allStop(g) || isMachineArtifact(g) || rituals.has(g) || ritualFragment(g)) continue;
      let cur = count.get(g);
      if (!cur) {
        cur = { n: 0, sessions: new Set() };
        count.set(g, cur);
      }
      cur.n++;
      cur.sessions.add(l.moment.session);
    }
  }
  const kept = [...count.entries()]
    .filter(([g, c]) => c.n >= DELIV_MIN && c.sessions.size >= DELIV_SESS && c.n / (c.n + (elsewhere.get(g) ?? 0)) >= DELIV_ASK_SHARE)
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
  // Keep the canonical short form: drop a gram when a kept shorter gram is contained in it.
  const out: { phrase: string; count: number }[] = [];
  for (const [p, c] of kept) {
    if (out.some((k) => p.includes(k.phrase))) continue;
    out.push({ phrase: p, count: c.n });
    if (out.length >= DELIV_TOP) break;
  }
  return out;
}

/** The signature line — mode 2's trigger-form patch, code-templated (a template cannot wobble).
 *  The exact wording is felt-gate material; it prints only above the evidence floor (lift.ts). */
export function metaLine(meta: MetaEvidence): string {
  const spec = meta.specPhrases.length ? `${meta.specPhrases.slice(0, 2).join(', ')}, ` : '';
  return `my questions circle a mechanism → drop a level: ${spec}mechanism before number (${meta.asks}× across ${meta.sessions} conversations, ${meta.bounces} didn't land)`;
}

/** The delegated line — the altitude instruction for chosen outsourcing: zero words, just do.
 *  Names no topic, ever — naming would grade the choice it protects. Worded at the felt gate
 *  (2026-07-29): the first draft ("delegated, not unknown") BOUNCED with the founder — design
 *  vocabulary leaking into the file — and was re-worded plain. */
export const DELEGATED_LINE = "where I never ask questions, I don't want lessons → just do the work, skip the teaching";
