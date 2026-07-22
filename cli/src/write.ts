/**
 * WRITE — the file. Assembles HUMAN.md from the scored pile: the person, in their own counts and
 * quotes. Code-assembled — nothing here a model invents — save for ONE call, the quote picker,
 * because code-picked quotes demonstrated the WRONG thing 3 of 10 times (the prototype's finding):
 * the count and the claim are arithmetic and definitions, but which real line best SHOWS a behaviour
 * to a stranger is a judgement, and that is the one thing worth a model call.
 *
 * TWO LIFT SECTIONS — the one split the data supports ([[metrics-and-units]]): "When something has
 * gone wrong" (lift ≥ cut, distress) and "How they work" (below). Flat and count-ordered within each;
 * no topical grouping. Person-scoped only — project categories are the project layer's job.
 *
 * The text produced here starts at the provenance line: `injectProfile` (sink.ts) adds the
 * `# Who you are working with` header and the humanmd/v1 marker when it installs, so repeating the
 * header here would double it.
 */
import { findAssistant, runClaude } from './claude.js';
import { loadCategories } from './categories.js';
import { loadAssignments } from './assign.js';
import { loadMoments, type Moment } from './moments.js';
import { join, tally, LIFT_CUT, type Labelled, type CategoryStat } from './count.js';
import { signatures, type Signature } from './shorthand.js';

/** The whole file targets this size; the distress section always ships in full, working-style fills
 *  the rest by count until the budget runs out. */
const CHAR_BUDGET = 5800;
/** A quote long enough to carry meaning, short enough to read cold. */
const QUOTE_MIN = 25;
const QUOTE_MAX = 210;
/** The quote pass can think for a while over every category at once. */
const QUOTE_TIMEOUT_MS = 900_000;
/** The anchor pile is built FROM interrupts, so a bare-interruption category re-derives our own
 *  labelling — it never belongs in the file (the prototype's CIRCULAR). */
const CIRCULAR = new Set(['interjects-single-word-pause']);

export interface ProfileMeta {
  sessions: number;
  moments: number;
  from: string;
  to: string;
  /** entries in "When something has gone wrong" */
  signals: number;
  /** entries shipped in "How they work" (after the char budget) */
  working: number;
  /** lines in the "In the moment" decode key */
  shorthand: number;
}

/** Up to 5 quote candidates for a category: readable length, least-overlapping (most specific to
 *  this behaviour), spread across conversations. */
function candidatesFor(name: string, labelled: Labelled[]): Moment[] {
  const mem = labelled.filter(
    (l) => l.kinds.includes(name) && l.moment.replyLen >= QUOTE_MIN && l.moment.reply.length <= QUOTE_MAX,
  );
  mem.sort((a, b) => a.kinds.length - b.kinds.length || a.moment.reply.length - b.moment.reply.length);
  const seen = new Set<string>();
  const out: Moment[] = [];
  for (const l of mem) {
    if (seen.has(l.moment.session) && out.length >= 3) continue; // prefer variety once we have a few
    seen.add(l.moment.session);
    out.push(l.moment);
    if (out.length >= 5) break;
  }
  return out;
}

const QUOTE_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { behaviour: { type: 'string' }, quote: { type: 'number' }, signal: { type: 'string' } },
        required: ['behaviour', 'quote', 'signal'],
      },
    },
  },
  required: ['picks'],
});

export interface Picks {
  /** name → the chosen demonstrating quote */
  quotes: Map<string, string>;
  /** name → a ≤6-word decode of what the person is signalling (for the "In the moment" key) */
  signals: Map<string, string>;
}

/** The one model call, now doing double duty: for each behaviour, pick the candidate (1..N, or 0
 *  for none) that most clearly SHOWS it, AND write a short decode of what the person is signalling.
 *  A behaviour with no clear quote drops from the file rather than ship a quote that fails its claim. */
export function pickQuotes(bin: string, work: { name: string; description: string; cands: Moment[] }[]): Picks {
  const body = work
    .map((w) => `BEHAVIOUR: ${w.name}\n  ${w.description}\n${w.cands.map((m, i) => `  ${i + 1}. "${m.reply}"`).join('\n')}`)
    .join('\n\n');
  const prompt = `For each BEHAVIOUR below you are given real quotes from ONE person's conversations with an AI coding assistant. Every quote was already tagged as an instance of that behaviour.

Give two things per behaviour.

QUOTE: pick the ONE quote (by number) that most clearly SHOWS the behaviour to someone who has never
met this person — the quote you could read cold and see the behaviour happening.
- Prefer a quote that demonstrates the behaviour over one that merely mentions the same topic.
- Prefer short and unmistakable over long and meandering.
- Avoid quotes that name a specific product, company or file, if a clearer alternative exists.
- Answer 0 if none of them shows it.

SIGNAL: a plain decode, SIX WORDS OR FEWER, of what the person is ASKING FOR when they do this — what
it MEANS, never what the assistant should do. E.g. "wants a plan before building", "wants it proven,
not asserted", "thinking out loud, not deciding". Never an instruction ("do X").

Reply with JSON only:
{"picks":[{"behaviour":"<exact name>","quote":<number or 0>,"signal":"<six words or fewer>"}]}

${body}`;
  const raw = runClaude(bin, prompt, 'sonnet', 'write', QUOTE_TIMEOUT_MS, QUOTE_SCHEMA, 0); // thinking capped
  const quotes = new Map<string, string>();
  const signals = new Map<string, string>();
  if (!raw) return { quotes, signals };
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { quotes, signals };
  try {
    const picks = (JSON.parse(m[0]).picks ?? []) as { behaviour?: unknown; quote?: unknown; signal?: unknown }[];
    const byName = new Map(work.map((w) => [w.name, w]));
    for (const p of picks) {
      const name = typeof p.behaviour === 'string' ? p.behaviour : '';
      const w = byName.get(name);
      if (!w) continue;
      const q = Number(p.quote);
      if (Number.isInteger(q) && q >= 1 && q <= w.cands.length) quotes.set(name, w.cands[q - 1].reply);
      if (typeof p.signal === 'string' && p.signal.trim()) signals.set(name, p.signal.trim());
    }
  } catch {
    /* unparseable — no quotes/signals; every entry needs a quote, so the file comes back empty */
  }
  return { quotes, signals };
}

/** One entry's three lines: claim · weight+direction · quote. */
function block(stat: CategoryStat, quote: string): string {
  const bits: string[] = [];
  if (stat.direction === 'rising' || stat.direction === 'fading') bits.push(stat.direction);
  if (stat.burst) bits.push('comes in bursts');
  const note = bits.length ? ` · ${bits.join(' · ')}` : '';
  const claim = stat.description.replace(/\s+/g, ' ').trim();
  return `**${claim}**\n${stat.count} times across ${stat.sessions} conversations${note}\n> ${quote}\n\n`;
}

/**
 * THE PURE ASSEMBLER — given per-category stats, a chosen quote per category, and provenance, build
 * the file text. Pure and no model, so the whole shape is testable from fixtures. Returns null when
 * nothing earns a place (no person-scoped entry survived with a quote).
 */
export function assemble(
  stats: CategoryStat[],
  quotes: Map<string, string>,
  prov: { sessions: number; moments: number; from: string; to: string },
  decode?: { sigs: Signature[]; signals: Map<string, string> },
): { text: string; meta: ProfileMeta } | null {
  const entries = stats
    .filter((s) => s.scope !== 'project' && s.count > 0)
    .map((s) => ({ stat: s, quote: quotes.get(s.name) }))
    .filter((e): e is { stat: CategoryStat; quote: string } => typeof e.quote === 'string' && e.quote.length > 0);
  if (!entries.length) return null;

  const repair = entries.filter((e) => e.stat.lift >= LIFT_CUT).sort((a, b) => b.stat.count - a.stat.count);
  const working = entries.filter((e) => e.stat.lift < LIFT_CUT).sort((a, b) => b.stat.count - a.stat.count);

  const decodeLines = decode ? decodeKey(decode) : [];
  const head: string[] = [
    `Derived from ${prov.sessions} of this person's own conversations with an AI assistant, ${prov.from} to ${prov.to}. Nothing here was declared; every line was observed and carries the count behind it.`,
    '',
    '**Read this as a prior, not a law.** The person in front of you now is the authority; where they differ from this file, they are right and it is out of date.',
    '',
  ];
  if (decodeLines.length) {
    head.push('## In the moment', '', 'Their shorthand — recognise these live; the detail is in the sections below.', '', ...decodeLines, '');
  }
  head.push(
    '## When something has gone wrong',
    '',
    'These cluster around moments the assistant got it wrong. Treat them as signals to stop and re-read the request, not as ordinary conversation. **If this file is working, these should get rarer.**',
    '',
  );
  let text = head.join('\n');
  for (const e of repair) text += block(e.stat, e.quote);

  text += ['## How they work', '', 'This is not friction and none of it should go away. It is how this person thinks and directs work — expect it, and read it correctly rather than trying to reduce it.', '', ''].join('\n');
  let shipped = 0;
  for (const e of working) {
    if (text.length + block(e.stat, e.quote).length > CHAR_BUDGET) break;
    text += block(e.stat, e.quote);
    shipped++;
  }

  return { text, meta: { sessions: prov.sessions, moments: prov.moments, from: prov.from, to: prov.to, signals: repair.length, working: shipped, shorthand: decodeLines.length } };
}

/** The decode-key lines: code-extracted phrases → the model's short signal, for categories that
 *  have both. The numbered-reply marker carries its own parens, so it is not wrapped in quotes. */
function decodeKey(decode: { sigs: Signature[]; signals: Map<string, string> }): string[] {
  return decode.sigs
    .map((s) => ({ s, signal: decode.signals.get(s.name) }))
    .filter((x): x is { s: Signature; signal: string } => typeof x.signal === 'string' && x.signal.trim().length > 0)
    .map(({ s, signal }) => `- ${s.phrases.map((p) => (p.includes('(') ? p : `"${p}"`)).join(' · ')} → ${signal.trim()}`);
}

/** The artifact-shape lint: does this read like a profile, not chatter? Guards against the 2026-07-18
 *  incident where a plain reply was loaded as HUMAN.md. Cheap, and the last line of defence. */
export function looksLikeProfile(text: string): boolean {
  return text.includes('Read this as a prior, not a law') && /^\*\*.+\*\*$/m.test(text);
}

/**
 * Build the whole profile from the live stores: tally the scores, pick a demonstrating quote per
 * person-scoped category (the one model call), assemble the two sections. Null when there is nothing
 * worth shipping. `injectProfile` (sink.ts) installs the returned text.
 */
export function buildProfile(): { text: string; meta: ProfileMeta } | null {
  const cats = loadCategories().filter((c) => !CIRCULAR.has(c.name));
  if (!cats.length) return null;
  const moments = loadMoments();
  if (!moments.length) return null;
  const labelled = join(moments, loadAssignments());
  const stats = tally(labelled, cats);

  const work = stats
    .filter((s) => s.scope !== 'project' && s.count > 0)
    .map((s) => ({ name: s.name, description: s.description, cands: candidatesFor(s.name, labelled) }))
    .filter((w) => w.cands.length);
  const bin = findAssistant();
  const { quotes, signals } = bin && work.length ? pickQuotes(bin, work) : { quotes: new Map<string, string>(), signals: new Map<string, string>() };
  const sigs = signatures(labelled, cats);

  const times = moments.map((m) => m.ts).filter(Boolean).sort();
  return assemble(
    stats,
    quotes,
    {
      sessions: new Set(moments.map((m) => m.session)).size,
      moments: moments.length,
      from: (times[0] ?? '').slice(0, 10),
      to: (times[times.length - 1] ?? '').slice(0, 10),
    },
    { sigs, signals },
  );
}
