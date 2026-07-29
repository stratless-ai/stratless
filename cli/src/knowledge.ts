/**
 * KNOWLEDGE — the knowledge leg (LIFT layer 3, 2026-07-29).
 *
 * The ledger of topics this person's own questions circle, and what to do about them: at most two
 * temporary rows in the talk section, worded in the person's OWN delivery spec, expiring on their
 * own evidence — plus THE META SURFACE (direction C, 2026-07-29), the leg's main product: one
 * templated line carrying the person's epistemic signature, distilled from every qualifying pile,
 * project-bound ones included. What exists is decided by arithmetic and geometry (topics.ts: the
 * pile bar, the bounce gate, cross-session tightness, the portability gate); the model's only job
 * is wording each named row ONCE, at mint — the rules.ts discipline, verbatim. A row instructs
 * the assistant's DELIVERY in that topic's moments; it never states, implies, or grades what the
 * person doesn't know.
 *
 * THE THREE-STATE MAP the gates stand on (measured before built, Phase 0b):
 *   · thin      — they ask and bounce. The only mintable state.
 *   · strong    — they engage in the topic's own vocabulary without asking. Never mintable.
 *   · delegated — they never enter the topic at all. Never mintable — AND the assistant must not
 *                 volunteer teaching there: ask-absence is chosen outsourcing, not ignorance
 *                 (measured: the reference person's near-zero-ask zones are CSS — delegation).
 *
 * Every topic carries its own death sentence, judged against its BIRTH baseline:
 *   · learned   — the asks fade while engagement in the topic CONTINUES (absorbed, not decayed —
 *                 the two-sided discriminator from the fading spike). Success; the row removes
 *                 itself. The file thins as the person gets better.
 *   · lapsed    — the topic left their work entirely. No credit, no fault; expires neutral.
 *   · falsified — the asks persist despite the grounding. The row was wrong for them; dropped,
 *                 and recorded as feedback on the delivery spec (v1 records; a later surface reads).
 *
 * v1 LIMITATION, ON THE RECORD: the supply side (did the assistant actually deliver the grounding
 * the row asked for) is unmeasured until the offer/pick trace exists. Every eval here is
 * person-side. Named in the war room; not hidden.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import { atomicWriteFileSync } from './atomic.js';
import { runClaude } from './claude.js';
import { loadEngine } from './engine.js';
import { adjacencyOf, type Labelled, type Adjacency } from './count.js';
import { norm, allStop, isMachineArtifact } from './shorthand.js';
import {
  topicsRead,
  topicPiles,
  topicSpanRead,
  topicWindowRead,
  walkAnswers,
  askRituals,
  isAsk,
  type TopicPile,
} from './topics.js';

const knowledgePath = (): string => process.env.STRATLESS_KNOWLEDGE || join(homedir(), '.stratless', 'knowledge.json');

/* ——— pre-registered gates and lifecycle constants (2026-07-29) ———
 * LOCKED values come from the handover and the Phase 0b probes; MEASURE-THEN-LOCK values are
 * provisional until the pre-registration pass on the real archive — and immovable after it. */
/** two bounces mint… (LOCKED — the handover's gate) */
const BOUNCE_MIN = 2;
/** …or one bounce plus asks across this many sessions (LOCKED). */
const REASK_SESS_MIN = 3;
/** the tightness floor: a pile mints only this far above the corpus's own cross-session
 *  answer-similarity median — the same lesson re-delivered, not work moving forward.
 *  (MEASURE-THEN-LOCK in pile-space; the thread-space 0.04 does not carry over unmeasured.) */
const TIGHT_MARGIN = 0.04;
/** THE PORTABILITY GATE (direction C, Sun's call 2026-07-29): a named row may only describe a
 *  subject that travels — its answers span at least two known projects and no single project
 *  dominates. A majority of the pile must carry a KNOWN project at all: unknown provenance can
 *  block portability, never argue for it. Project-bound piles are not discarded — they are the
 *  EVIDENCE for the meta surface below. */
const PORT_PROJECTS_MIN = 2;
const PORT_FRAC = 0.7;
/** at most this many knowledge rows print — the leg's own cap, not the gap leg's. */
export const KNOWLEDGE_PRINT_CAP = 2;
/** a window must hold this many moments before its rates may retire a topic — a quiet stretch
 *  must never read as learned. (MEASURE-THEN-LOCK.) */
const KNOWLEDGE_SAMPLE_MIN = 30;
/** learned: asks at or below this share of the birth ask-rate… */
const LEARN_FACTOR = 0.5;
/** …while engagement holds at least this share of its birth rate… */
const ENGAGE_HOLD = 0.7;
/** …for this many consecutive builds. */
const LEARN_BUILDS = 2;
/** lapsed: no topic-touching moment for this many days. */
const LAPSE_DAYS = 42;
/** falsified: enough builds, enough days, the solid windows' asks never once dipped meaningfully. */
const FALSIFY_BUILDS = 6;
const FALSIFY_DAYS = 42;
const FALSIFY_FACTOR = 0.8;
const HISTORY_CAP = 12;
const VOICE_TIMEOUT_MS = 300_000;

export type KnowledgeLifecycle = 'open' | 'learned' | 'lapsed' | 'falsified';

export interface KnowledgeHistoryEntry {
  builtAt: string;
  askRate: number;
  engageRate: number;
  sessions: number;
  sample: number;
}

export interface KnowledgeTopic {
  id: string;
  bornAt: string;
  /** display + covered-set identity, from the pile's lead terms */
  slug: string;
  /** the pile's salient terms — how later windows find the topic again (term-based on purpose:
   *  retirement never needs the runtime; no centroid is stored — the AI-common drop set drifts
   *  with the corpus, so frozen pile geometry would decay exactly the way engine.ts's
   *  frozen-vocab note warns; identity across flushes is `covers()` term overlap) */
  terms: string[];
  /** the embedding pipeline the tightness margin was measured in */
  pipeline: string;
  /** birth evidence, verbatim from the gates — the receipt and the audit trail */
  bounces: number;
  askCount: number;
  askSessions: number;
  tightMargin: number;
  /** distinct known projects at birth — the portability audit */
  projects: number;
  /** birth-window rates — every later build's rates are judged against these */
  baseline: { askRate: number; engageRate: number };
  /** the voiced row — written once at mint, never re-rolled */
  row?: string;
  /** the derived delivery spec quoted to the voicer, kept for the audit trail */
  deliveryPhrases?: string[];
  history: KnowledgeHistoryEntry[];
  lifecycle: KnowledgeLifecycle;
  /** falsified only: the drop is feedback on the delivery spec — recorded now, read later */
  deliveryFeedback?: true;
}

/** THE META SURFACE's stored evidence (direction C: the leg's main product). A snapshot fact,
 *  refreshed each flush from the qualifying piles — portable AND project-bound alike, because the
 *  person-level truth (how grounding must arrive) is distilled FROM the project-bound asks. The
 *  printed line is a code template over these numbers plus the person's own derived delivery
 *  phrases — never voiced, so it cannot wobble; the counts move each flush like every receipt. */
export interface MetaEvidence {
  asks: number;
  sessions: number;
  bounces: number;
  /** the person's own recurring ask modifiers ("in layman"), derived — possibly empty, never defaulted */
  specPhrases: string[];
}

interface KnowledgeStore {
  topics: KnowledgeTopic[];
  /** how many delegated zones the last run saw — the delegated key line's trigger. A snapshot
   *  fact refreshed each flush (the zones themselves are recomputed, never stored). */
  delegatedZones?: number;
  /** the meta surface's evidence — absent until a run has measured it */
  meta?: MetaEvidence;
}

/** Defensive read — corrupt input degrades to empty, never throws (the renders.json discipline). */
export function readKnowledge(file: string = knowledgePath()): KnowledgeStore {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { topics?: unknown; delegatedZones?: unknown; meta?: unknown };
    if (!Array.isArray(raw.topics)) return { topics: [] };
    const topics: KnowledgeTopic[] = [];
    for (const t of raw.topics) {
      if (typeof t !== 'object' || t === null) continue;
      const o = t as Record<string, unknown>;
      if (typeof o.id !== 'string' || typeof o.slug !== 'string' || !Array.isArray(o.terms)) continue;
      if (typeof o.baseline !== 'object' || o.baseline === null) continue;
      const b = o.baseline as Record<string, unknown>;
      topics.push({
        id: o.id,
        bornAt: typeof o.bornAt === 'string' ? o.bornAt : '',
        slug: o.slug,
        terms: o.terms.filter((x): x is string => typeof x === 'string'),
        pipeline: typeof o.pipeline === 'string' ? o.pipeline : '',
        bounces: typeof o.bounces === 'number' ? o.bounces : 0,
        askCount: typeof o.askCount === 'number' ? o.askCount : 0,
        askSessions: typeof o.askSessions === 'number' ? o.askSessions : 0,
        tightMargin: typeof o.tightMargin === 'number' ? o.tightMargin : 0,
        projects: typeof o.projects === 'number' ? o.projects : 0,
        baseline: { askRate: typeof b.askRate === 'number' ? b.askRate : 0, engageRate: typeof b.engageRate === 'number' ? b.engageRate : 0 },
        ...(typeof o.row === 'string' ? { row: o.row } : {}),
        ...(Array.isArray(o.deliveryPhrases) ? { deliveryPhrases: o.deliveryPhrases.filter((x): x is string => typeof x === 'string') } : {}),
        history: Array.isArray(o.history) ? (o.history as KnowledgeHistoryEntry[]) : [],
        lifecycle: o.lifecycle === 'learned' || o.lifecycle === 'lapsed' || o.lifecycle === 'falsified' ? o.lifecycle : 'open',
        ...(o.deliveryFeedback === true ? { deliveryFeedback: true } : {}),
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
      topics,
      ...(typeof raw.delegatedZones === 'number' ? { delegatedZones: raw.delegatedZones } : {}),
      ...(meta ? { meta } : {}),
    };
  } catch {
    return { topics: [] };
  }
}

export function writeKnowledge(store: KnowledgeStore, file: string = knowledgePath()): void {
  atomicWriteFileSync(file, JSON.stringify(store, null, 1));
}

/* ——— the mint gates ——— */

/** Does this pile's subject TRAVEL? A majority of its answers must carry a known project at all
 *  (unknown provenance blocks, never enables), those must span at least two projects, and no
 *  single one may dominate. A pile that fails is not discarded — it feeds the meta surface. */
export function portable(t: TopicPile): boolean {
  if (t.known * 2 < t.askCount) return false;
  if (t.projects < PORT_PROJECTS_MIN) return false;
  return t.dominant / t.known <= PORT_FRAC;
}

/** The evidence gate over a pile that already cleared the LOCKED bar in topics.ts. The tightness
 *  leg is structural: an unstamped pile (runtime absent, one conversation, too few piles for a
 *  baseline) can never mint — refuse, don't lie. Direction C: only a PORTABLE subject may become
 *  a named row. */
export function mintable(t: TopicPile): boolean {
  const evidence = t.bounces >= BOUNCE_MIN || (t.bounces >= 1 && t.askSessions >= REASK_SESS_MIN);
  return evidence && typeof t.tightMargin === 'number' && t.tightMargin >= TIGHT_MARGIN && portable(t);
}

/** One entry per topic, EVER — a retired topic's axis does not silently re-mint (the rules.ts
 *  doctrine). Identity is the slug, or a majority of lead terms shared. */
export function covers(existing: KnowledgeTopic, t: TopicPile): boolean {
  if (existing.slug === t.slug) return true;
  const a = new Set(existing.terms.slice(0, 5));
  const lead = t.terms.slice(0, 5);
  const shared = lead.filter((x) => a.has(x)).length;
  return shared * 2 >= Math.min(a.size, lead.length);
}

/* ——— the lifecycle ——— */

/** The exits, applied to a topic's history (oldest → newest). Pure; every threshold above.
 *  Order matters: learned (the success) → lapsed (the neutral quiet) → falsified (the persistent
 *  gap) — a topic that simply left their work must land lapsed, not falsified. */
export function nextKnowledgeState(topic: KnowledgeTopic, nowMs: number): KnowledgeLifecycle {
  const h = topic.history;
  const solid = (e: KnowledgeHistoryEntry): boolean => e.sample >= KNOWLEDGE_SAMPLE_MIN;

  // learned — only claimable when birth ENGAGEMENT existed: asks fading with no engagement signal
  // is indistinguishable from the topic decaying out of their work, and absorbed-vs-decay is the
  // whole point of the two-sided read.
  if (topic.baseline.engageRate > 0) {
    const slice = h.slice(-LEARN_BUILDS);
    if (
      slice.length >= LEARN_BUILDS &&
      slice.every((e) => solid(e) && e.askRate <= topic.baseline.askRate * LEARN_FACTOR && e.engageRate >= topic.baseline.engageRate * ENGAGE_HOLD)
    ) {
      return 'learned';
    }
  }

  // lapsed — the last sign of life is too old (or never existed since birth).
  const lastAlive = [...h].reverse().find((e) => e.sessions > 0);
  const aliveAt = lastAlive ? Date.parse(lastAlive.builtAt) : Date.parse(topic.bornAt);
  if (Number.isFinite(aliveAt) && nowMs - aliveAt >= LAPSE_DAYS * 24 * 3600_000) return 'lapsed';

  // falsified — enough builds, enough days, and the solid windows' asks never meaningfully fell.
  const ageDays = (nowMs - Date.parse(topic.bornAt)) / (24 * 3600_000);
  if (
    h.length >= FALSIFY_BUILDS &&
    ageDays >= FALSIFY_DAYS &&
    h.some(solid) &&
    h.every((e) => !solid(e) || e.askRate > topic.baseline.askRate * FALSIFY_FACTOR)
  ) {
    return 'falsified';
  }

  return 'open';
}

/* ——— the delivery spec — derived, never defaulted ——— */

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
 * are the rituals themselves (decode-key material), and a spec built from them would say "they
 * want explanations explained". Derived per person; when nothing recurs, the spec is honestly
 * empty and the voicer is told so — never defaulted to anyone else's "layman".
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

/* ——— voicing — the model's ONE job here, at mint only ——— */

const KNOWLEDGE_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: { slug: { type: 'string' }, row: { type: 'string' } },
        required: ['slug', 'row'],
      },
    },
  },
  required: ['rows'],
});

const SAMPLE_CAP = 5;
const SAMPLE_CHARS = 240;

export interface KnowledgeVoiceJob {
  pile: TopicPile;
  askQuotes: string[];
  bounceQuotes: string[];
  delivery: { phrase: string; count: number }[];
}

/** Per-session ask quotes for a pile — the voicer sees how the person actually asks. */
export function knowledgeVoiceJobs(
  labelled: Labelled[],
  piles: TopicPile[],
  delivery: { phrase: string; count: number }[],
  adj: Adjacency,
): KnowledgeVoiceJob[] {
  const byKey = new Map(labelled.map((l) => [l.moment.key, l]));
  const quotesOf = (keys: string[], bounceOnly: boolean): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const key of keys) {
      const l = byKey.get(key);
      if (!l || seen.has(l.moment.session)) continue;
      if (bounceOnly) {
        // a bounce quote is the reply that came BACK at the failed explanation — the next moment's reply
        const nxt = adj.next.get(l.moment.key);
        if (!nxt) continue;
        const q = nxt.reply.replace(/\s+/g, ' ').trim().slice(0, SAMPLE_CHARS);
        if (q.length < 4) continue;
        seen.add(l.moment.session);
        out.push(q);
      } else {
        const q = l.moment.reply.replace(/\s+/g, ' ').trim().slice(0, SAMPLE_CHARS);
        if (q.length < 4) continue;
        seen.add(l.moment.session);
        out.push(q);
      }
      if (out.length >= SAMPLE_CAP) break;
    }
    return out;
  };
  return piles.map((t) => ({
    pile: t,
    askQuotes: quotesOf(t.askKeys, false),
    bounceQuotes: quotesOf(t.askKeys, true),
    delivery,
  }));
}

/**
 * Word the rows. Constraints carried from the framework guardrails: the row instructs the
 * assistant's DELIVERY when the conversation enters this topic; it never states or implies the
 * person lacks knowledge — no grades, no "not well-versed", ever. The person's own delivery
 * phrases (when any exist) are embedded verbatim: their spec, not ours.
 */
export function voiceTopics(bin: string, jobs: KnowledgeVoiceJob[]): Map<string, string> {
  const body = jobs
    .map((j) => {
      const parts = [
        `TOPIC ${j.pile.slug}: the subject their questions keep circling, in its own words: ${j.pile.terms.slice(0, 5).join(', ')}`,
        `asked ${j.pile.askCount} times across ${j.pile.askSessions} conversations; ${j.pile.bounces} explanations came straight back`,
        `how they ask:`,
        ...j.askQuotes.map((q) => `  · "${q}"`),
      ];
      if (j.bounceQuotes.length) parts.push(`what they said when an explanation did not land:`, ...j.bounceQuotes.map((q) => `  · "${q}"`));
      parts.push(
        j.delivery.length
          ? `their own delivery spec, from their asks: ${j.delivery.map((d) => `"${d.phrase}" (${d.count}×)`).join(' · ')}`
          : `no recurring delivery phrase of their own was found — do not invent one; write the row from how they ask alone`,
      );
      return parts.join('\n');
    })
    .join('\n\n');

  const prompt = [
    'You are wording rows for an AI-loaded working brief — the "how to talk to me" section of a',
    'person\'s profile. Each TOPIC below is a subject this person\'s own questions keep circling.',
    'For each, write ONE row telling the ASSISTANT how to deliver explanations whenever the',
    'conversation enters that topic. Return JSON: {"rows":[{"slug","row"}]} — slug copied exactly.',
    '',
    'Each row (≤20 words): starts with "talk"; names the topic by its own terms so the assistant',
    'recognises the moment; instructs the DELIVERY (level, order, grounding) in the person\'s own',
    'style — embed their delivery phrase verbatim when one is given.',
    '',
    'Hard rules: the row is about HOW TO DELIVER, never about what the person knows — no grades,',
    'no "struggles with", no "not familiar", nothing a reader could take as a report card. First',
    'person is the person\'s voice in their own file ("ground it for me"). No project or product',
    'nouns beyond the topic\'s own terms.',
    '',
    body,
  ].join('\n');

  const out = new Map<string, string>();
  const reply = runClaude(bin, prompt, 'sonnet', 'knowledge', VOICE_TIMEOUT_MS, KNOWLEDGE_SCHEMA, 0);
  if (!reply) return out;
  try {
    const m = reply.match(/\{[\s\S]*\}/);
    if (!m) return out;
    const parsed = JSON.parse(m[0]) as { rows?: { slug?: string; row?: string }[] };
    const known = new Set(jobs.map((j) => j.pile.slug));
    for (const r of parsed.rows ?? []) {
      if (!r.slug || !known.has(r.slug) || !r.row) continue;
      out.set(r.slug, r.row.trim());
    }
  } catch {
    /* a bad reply mints nothing this build; candidates retry next flush */
  }
  return out;
}

/* ——— the per-build run: evaluate, retire, mint ——— */

export interface KnowledgeRunResult {
  minted: number;
  retired: number;
  open: number;
  /** anything that PRINTS moved — the profile should rebuild */
  changed: boolean;
}

const NO_RUN: KnowledgeRunResult = { minted: 0, retired: 0, open: 0, changed: false };

export async function runKnowledge(
  bin: string | undefined,
  labelled: Labelled[],
  nowMs: number,
  opts: { file?: string; roots?: string[] } = {},
): Promise<KnowledgeRunResult> {
  const file = opts.file ?? knowledgePath();
  // Refuse, don't lie: a pile with no topic channel (pre-v3 shape) must not read as "no topics" —
  // the leg does nothing until the free backfill has run.
  if (!labelled.some((l) => l.moment.aiTerms?.length)) return NO_RUN;
  const adj = adjacencyOf(labelled);
  const rituals = askRituals(labelled, adj);

  const store = readKnowledge(file);
  const builtAt = new Date(nowMs).toISOString();
  let changed = false;
  let storeMoved = false;
  let retired = 0;

  // 1. Re-measure every open topic, apply the exits — cards only, so retirement never stalls on
  //    the walk below.
  for (const topic of store.topics) {
    if (topic.lifecycle !== 'open') continue; // terminal states are skipped forever
    const win = topicWindowRead(labelled, topic.terms, adj, rituals, nowMs);
    const entry: KnowledgeHistoryEntry = { builtAt, ...win };
    topic.history = [...topic.history.filter((e) => e.builtAt !== builtAt), entry].slice(-HISTORY_CAP);
    storeMoved = true;
    const next = nextKnowledgeState(topic, nowMs);
    if (next !== topic.lifecycle) {
      topic.lifecycle = next;
      if (next === 'falsified') topic.deliveryFeedback = true; // the drop IS the delivery-spec feedback
      retired++;
      changed = true;
    }
  }

  // 2. The one walk (full-text rarity + the answering turns' openings), then the threading read.
  //    A walk that found nothing → no threading this flush, retirement above still counted.
  const walk = walkAnswers(opts.roots);
  const read = topicsRead(labelled, adj, walk);
  if (!read) {
    if (storeMoved) writeKnowledge(store, file);
    return { minted: 0, retired, open: store.topics.filter((t) => t.lifecycle === 'open').length, changed };
  }

  // 3. The delegated snapshot — the key line's trigger, refreshed every run.
  if (store.delegatedZones !== read.delegated.length) {
    store.delegatedZones = read.delegated.length;
    storeMoved = true;
    changed = true; // the delegated key line may appear or vanish
  }

  // 4. The pile construction — subjects as regions of answer-space. Guards its own honesty
  //    (runtime absent → [], a background path never fetches; margins stamped only against a
  //    real baseline).
  const piles = await topicPiles(read.events, labelled, walk);
  const delivery = deliverySpec(labelled, rituals);

  // 5. The meta surface's evidence (direction C, Sun's call 2026-07-29): EVERY bar-clearing pile
  //    feeds it — the project-bound piles are exactly where the bounces live, and the person-level
  //    truth they carry is how grounding must arrive, which travels. Refreshed each flush.
  const askKeys = new Set<string>();
  const metaSessions = new Set<string>();
  let metaBounces = 0;
  for (const p of piles) {
    for (const k of p.askKeys) askKeys.add(k);
    metaBounces += p.bounces;
  }
  for (const e of read.events) if (askKeys.has(e.key)) metaSessions.add(e.session);
  const meta: MetaEvidence = {
    asks: askKeys.size,
    sessions: metaSessions.size,
    bounces: metaBounces,
    specPhrases: delivery.map((d) => d.phrase),
  };
  if (JSON.stringify(store.meta) !== JSON.stringify(meta)) {
    store.meta = meta;
    storeMoved = true;
    changed = true; // the meta line's receipt moved (or the line appears/vanishes at the floor)
  }

  // 6. Mint: gate-clearing PORTABLE piles not already covered, voiced in one batched call.
  const candidates = piles.filter((t) => mintable(t) && !store.topics.some((k) => covers(k, t)));
  let minted = 0;
  if (bin && candidates.length) {
    const jobs = knowledgeVoiceJobs(labelled, candidates, delivery, adj);
    const voiced = voiceTopics(bin, jobs);
    const pipeline = loadEngine()?.pipeline ?? '';
    for (const j of jobs) {
      const row = voiced.get(j.pile.slug);
      if (!row) continue; // no voiced row, no mint — retry next flush
      const span = topicSpanRead(labelled, j.pile.terms, j.pile.askKeys, adj, rituals);
      if (span.askRate <= 0) continue; // unfalsifiable — cannot exist (alive by construction, guarded anyway)
      store.topics.push({
        id: `${builtAt}·${j.pile.slug}`,
        bornAt: builtAt,
        slug: j.pile.slug,
        terms: j.pile.terms,
        pipeline,
        bounces: j.pile.bounces,
        askCount: j.pile.askCount,
        askSessions: j.pile.askSessions,
        tightMargin: j.pile.tightMargin!,
        projects: j.pile.projects,
        baseline: { askRate: span.askRate, engageRate: span.engageRate },
        row,
        ...(delivery.length ? { deliveryPhrases: delivery.map((d) => d.phrase) } : {}),
        history: [{ builtAt, askRate: span.askRate, engageRate: span.engageRate, sessions: span.sessions, sample: span.sample }],
        lifecycle: 'open',
      });
      minted++;
      changed = true;
      storeMoved = true;
    }
  }

  if (storeMoved) writeKnowledge(store, file);
  return { minted, retired, open: store.topics.filter((t) => t.lifecycle === 'open').length, changed };
}

/* ——— what the profile prints ———
 *
 * LIFT is dynamics, never surface (the founder's architecture, 2026-07-28): no heading, no
 * section, ever. At most KNOWLEDGE_PRINT_CAP temporary rows at the end of the talk section, one
 * templated meta line in the decode key, and — when delegated zones exist — one templated
 * delegated line. The templates are CODE, not model output: they are generic reader instructions
 * (like headings), and a template cannot wobble. */

/** THE META SURFACE prints only above this much bounce evidence — a couple of stray bounces is
 *  noise, not a signature. (MEASURE-THEN-LOCK.) */
const META_FLOOR = 10;

/** The meta line — THE C SURFACE (Sun's call, 2026-07-29): it prints on its own evidence, named
 *  row or not, because the person-level truth it carries (how grounding must arrive) is distilled
 *  from every qualifying pile, project-bound ones included. A code template over measured
 *  numbers and the person's own derived phrases — never voiced, so it cannot wobble. The exact
 *  wording is felt-gate material at acceptance. */
export function metaLine(meta: MetaEvidence): string {
  const spec = meta.specPhrases.length ? `${meta.specPhrases.slice(0, 2).join(', ')}, ` : '';
  return `my questions circle a mechanism → drop a level: ${spec}mechanism before number (${meta.asks}× across ${meta.sessions} conversations, ${meta.bounces} didn't land)`;
}

/** The delegated line: prints only when the leg is active and delegated zones exist. Names no
 *  topic, ever — naming would grade the choice it protects. Worded at the felt gate (2026-07-29):
 *  the first draft ("delegated, not unknown") BOUNCED with the founder — design vocabulary
 *  leaking into the file, the exact sin the rider section died for — and was re-worded plain. */
export const DELEGATED_LINE = "where I never ask questions, I don't want lessons → just do the work, skip the teaching";

export interface KnowledgeRow {
  /** the voiced-once row, verbatim — assembly never re-words */
  row: string;
  askCount: number;
  askSessions: number;
}

export interface KnowledgePrint {
  rows: KnowledgeRow[];
  /** the decode-key lines the leg contributes, in print order */
  keyLines: string[];
}

/** Open topics as printable rows, bounce-heaviest first, capped — plus the key lines the leg's
 *  evidence earns. The meta line stands on its own floor; the delegated line requires the leg to
 *  be visibly active (a key line may not gesture at machinery the file shows nothing of). */
export function knowledgePrint(file: string = knowledgePath()): KnowledgePrint {
  const store = readKnowledge(file);
  const rows = store.topics
    .filter((t) => t.lifecycle === 'open' && t.row)
    .sort((a, b) => b.bounces - a.bounces || b.askCount - a.askCount || a.slug.localeCompare(b.slug))
    .slice(0, KNOWLEDGE_PRINT_CAP)
    .map((t) => ({ row: t.row!, askCount: t.askCount, askSessions: t.askSessions }));
  const keyLines: string[] = [];
  const metaQualifies = !!store.meta && store.meta.bounces >= META_FLOOR;
  if (metaQualifies) keyLines.push(metaLine(store.meta!));
  if ((rows.length || metaQualifies) && (store.delegatedZones ?? 0) > 0) keyLines.push(DELEGATED_LINE);
  return { rows, keyLines };
}
