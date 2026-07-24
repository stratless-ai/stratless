/**
 * WRITE — the file. Assembles HUMAN.md from the scored pile: the person, in their own counts and
 * quotes. Code-assembled — nothing here a model invents — save for ONE call, which for each category
 * picks the demonstrating quote AND re-voices it into a conductor's instruction (0.5.0). The counts and
 * ordering are arithmetic; which real line best SHOWS a behaviour, which section it serves, and how to
 * phrase the instruction, are judgements — and that is the one thing worth a model call.
 *
 * THREE SECTIONS — the conductor's brief (positioning.md): "What to offer me before I ask" (Frame),
 * "What to catch for me" (Judge), "How to talk to me" (Register). The model routes each category to its
 * section; code assembles. This REPLACED the lift-split ("gone wrong" vs "how they work"): the sections
 * are functional now, not distress-based — though lift still rides in as a routing HINT (a catch fires
 * in the high-lift reactions). Count-ordered within each section. Person-scoped only — project
 * categories are the project layer's job. The "In the moment" shorthand decode still opens the file.
 *
 * The text produced here starts at the provenance line: `injectProfile` (sink.ts) adds the
 * `# Who you are working with` header and the humanmd/v2 marker when it installs, so repeating the
 * header here would double it.
 */
import { findAssistant, runClaude } from './claude.js';
import { loadCategories } from './categories.js';
import { loadAssignments } from './assign.js';
import { loadMoments, type Moment } from './moments.js';
import { join, tally, LIFT_CUT, type Labelled, type CategoryStat } from './count.js';
import { signatures, type Signature } from './shorthand.js';

/** The whole file targets this size; Frame + Judge always ship in full, Register fills the rest by
 *  count until the budget runs out. */
const CHAR_BUDGET = 5800;
/** A quote long enough to carry meaning, short enough to read cold. */
const QUOTE_MIN = 25;
const QUOTE_MAX = 210;
/** The quote+voice pass can think for a while over every category at once. */
const QUOTE_TIMEOUT_MS = 900_000;
/** The anchor pile is built FROM interrupts, so a bare-interruption category re-derives our own
 *  labelling — it never belongs in the file (the prototype's CIRCULAR). */
const CIRCULAR = new Set(['interjects-single-word-pause']);

export interface ProfileMeta {
  sessions: number;
  moments: number;
  from: string;
  to: string;
  /** entries in "What to offer me before I ask" (Frame) */
  frame: number;
  /** entries in "What to catch for me" (Judge) */
  judge: number;
  /** entries shipped in "How to talk to me" (Register, after the char budget) */
  register: number;
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

const VOICE_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          section: { type: 'string' },
          line: { type: 'string' },
          quote: { type: 'number' },
          signal: { type: 'string' },
        },
        required: ['name', 'section', 'line', 'quote', 'signal'],
      },
    },
  },
  required: ['picks'],
});

export type Section = 'frame' | 'judge' | 'register';

export interface Voiced {
  /** which part of the brief this category belongs in */
  section: Section;
  /** the chosen demonstrating quote (empty = none clear; the entry then drops) */
  quote: string;
  /** the category re-voiced as an instruction to the assistant */
  line: string;
  /** a ≤6-word decode of what the person is signalling (for the "In the moment" key) */
  signal: string;
}

/** The one model call. For each category it: routes to a section (frame/judge/register), re-voices it
 *  into an instruction to the assistant, picks the demonstrating quote (1..N, or 0 for none), and
 *  writes a short decode for the "In the moment" key. A category with no clear quote drops from the
 *  file rather than ship a line whose receipt fails. */
export function pickAndVoice(
  bin: string,
  work: { name: string; description: string; lift: number; cands: Moment[] }[],
): Map<string, Voiced> {
  const body = work
    .map((w) => {
      const fires = w.lift >= LIFT_CUT ? 'high' : 'ordinary';
      return `CATEGORY: ${w.name}  (fires in: ${fires})\n  ${w.description}\n${w.cands.map((m, i) => `  ${i + 1}. "${m.reply}"`).join('\n')}`;
    })
    .join('\n\n');
  const prompt = `For each CATEGORY below you are given real quotes from ONE person's conversations with an AI coding assistant. Every quote was already tagged as an instance of that category. You are assembling a "conductor's brief" the assistant reads BEFORE working with this person: what to OFFER, what to CATCH, how to TALK.

Give FOUR things per category.

SECTION: which part of the brief it belongs in:
- "frame" — something to OFFER before they ask (how they set work up: a plan first, a small probe, options laid out, one thing at a time, a review point). Proactive.
- "judge" — something to CATCH for them (what they reliably challenge or refuse: an unverified number, a summary in place of raw output, a quick patch job, unsanctioned spend, a hedge when the answer is known). Reactive; these are usually marked "fires in: high".
- "register" — how to TALK to them (bluntness, plain language, what their shorthand means, pacing).

LINE: one sentence written AS AN INSTRUCTION TO THE ASSISTANT (offer X, catch Y, talk like Z), never a
description of the person. Plain language; where they reach for a recurring phrase, quote it. Use commas
or colons, never an em dash.

QUOTE: the ONE quote (by number) that most clearly SHOWS this to someone who never met them; 0 if none.
- Prefer a quote that demonstrates it over one that merely mentions the topic; short over meandering.

SIGNAL: a plain decode, SIX WORDS OR FEWER, of what the person is ASKING FOR when they do this: what it
MEANS, never an instruction. E.g. "wants a plan before building", "wants it proven, not asserted".

Reply with JSON only:
{"picks":[{"name":"<exact name>","section":"frame|judge|register","line":"<instruction>","quote":<number or 0>,"signal":"<six words or fewer>"}]}

${body}`;
  const raw = runClaude(bin, prompt, 'sonnet', 'write', QUOTE_TIMEOUT_MS, VOICE_SCHEMA, 0); // thinking capped
  const out = new Map<string, Voiced>();
  if (!raw) return out;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return out;
  try {
    const picks = (JSON.parse(m[0]).picks ?? []) as { name?: unknown; section?: unknown; line?: unknown; quote?: unknown; signal?: unknown }[];
    const byName = new Map(work.map((w) => [w.name, w]));
    for (const p of picks) {
      const name = typeof p.name === 'string' ? p.name : '';
      const w = byName.get(name);
      if (!w) continue;
      const section: Section | undefined =
        p.section === 'judge' ? 'judge' : p.section === 'register' ? 'register' : p.section === 'frame' ? 'frame' : undefined;
      const line = typeof p.line === 'string' ? p.line.replace(/\s+/g, ' ').trim() : '';
      if (!section || !line) continue;
      const q = Number(p.quote);
      const quote = Number.isInteger(q) && q >= 1 && q <= w.cands.length ? w.cands[q - 1].reply : '';
      const signal = typeof p.signal === 'string' ? p.signal.trim() : '';
      out.set(name, { section, quote, line, signal });
    }
  } catch {
    /* unparseable — nothing voiced; every entry needs a quote, so the file comes back empty */
  }
  return out;
}

/** One entry's three lines: the re-voiced instruction · weight+direction · quote. */
function block(claim: string, stat: CategoryStat, quote: string): string {
  const bits: string[] = [];
  if (stat.direction === 'rising' || stat.direction === 'fading') bits.push(stat.direction);
  if (stat.burst) bits.push('comes in bursts');
  const note = bits.length ? ` · ${bits.join(' · ')}` : '';
  const c = claim.replace(/\s+/g, ' ').trim();
  return `**${c}**\n${stat.count} times across ${stat.sessions} conversations${note}\n> ${quote}\n\n`;
}

interface Entry {
  stat: CategoryStat;
  v: Voiced;
}

/**
 * THE PURE ASSEMBLER — given per-category stats, a routing+quote+line per category, and provenance,
 * build the file text. Pure and no model, so the whole shape is testable from fixtures. Returns null
 * when no bookend earned a place (neither a Frame nor a Judge entry survived with a quote — a brief
 * with neither bookend is not a conductor's brief).
 */
export function assemble(
  stats: CategoryStat[],
  voiced: Map<string, Voiced>,
  prov: { sessions: number; moments: number; from: string; to: string },
  decode?: { sigs: Signature[]; signals: Map<string, string> },
): { text: string; meta: ProfileMeta } | null {
  const entries: Entry[] = stats
    .filter((s) => s.scope !== 'project' && s.count > 0)
    .map((s) => ({ stat: s, v: voiced.get(s.name) }))
    .filter((e): e is Entry => !!e.v && typeof e.v.quote === 'string' && e.v.quote.length > 0);

  const inSection = (sec: Section): Entry[] =>
    entries.filter((e) => e.v.section === sec).sort((a, b) => b.stat.count - a.stat.count);
  const frame = inSection('frame');
  const judge = inSection('judge');
  const register = inSection('register');
  if (!frame.length && !judge.length) return null; // no bookend earned a place

  const decodeLines = decode ? decodeKey(decode) : [];
  const head: string[] = [
    `Derived from ${prov.sessions} of this person's own conversations with an AI assistant, ${prov.from} to ${prov.to}. Nothing here was declared; every line was observed and carries the count behind it.`,
    '',
    '**Read this as a prior, not a law.** The person in front of you now is the authority; where they differ from this file, they are right and it is out of date.',
    '',
  ];
  if (decodeLines.length) {
    head.push('## In the moment', '', 'Their shorthand. Recognise these live; the detail is in the sections below.', '', ...decodeLines, '');
  }
  let text = head.join('\n');

  // Frame + Judge are the bookends — always shipped in full. Register fills the remaining budget.
  if (frame.length) {
    text += ['## What to offer me before I ask', '', 'Set these up or hand them over before I ask. Offering them unprompted is the point, not overstepping.', '', ''].join('\n');
    for (const e of frame) text += block(e.v.line, e.stat, e.v.quote);
  }
  if (judge.length) {
    text += ['## What to catch for me', '', 'What I reliably challenge or refuse. Pre-empt these, so I do not have to catch them myself.', '', ''].join('\n');
    for (const e of judge) text += block(e.v.line, e.stat, e.v.quote);
  }
  let shippedReg = 0;
  if (register.length) {
    text += ['## How to talk to me', '', 'The register I work in. Match it rather than smoothing it over.', '', ''].join('\n');
    for (const e of register) {
      if (text.length + block(e.v.line, e.stat, e.v.quote).length > CHAR_BUDGET) break;
      text += block(e.v.line, e.stat, e.v.quote);
      shippedReg++;
    }
  }

  return {
    text,
    meta: {
      sessions: prov.sessions,
      moments: prov.moments,
      from: prov.from,
      to: prov.to,
      frame: frame.length,
      judge: judge.length,
      register: shippedReg,
      shorthand: decodeLines.length,
    },
  };
}

/** The decode-key lines: code-extracted phrases → the model's short signal, for categories that
 *  have both. The numbered-reply marker carries its own parens, so it is not wrapped in quotes. */
function decodeKey(decode: { sigs: Signature[]; signals: Map<string, string> }): string[] {
  return decode.sigs
    .map((s) => ({ s, signal: decode.signals.get(s.name) }))
    .filter((x): x is { s: Signature; signal: string } => typeof x.signal === 'string' && x.signal.trim().length > 0)
    .map(({ s, signal }) => `- ${s.phrases.map((p) => (p.includes('(') ? p : `"${p}"`)).join(' · ')} → ${signal.trim()}`);
}

/** The artifact-shape lint: does this read like a conductor's brief, not chatter? Guards against the
 *  2026-07-18 incident where a plain reply was loaded as HUMAN.md. Cheap, the last line of defence. */
export function looksLikeProfile(text: string): boolean {
  return text.includes('Read this as a prior, not a law') && /^## What to (offer|catch)/m.test(text);
}

/**
 * Build the whole profile from the live stores: tally the scores, then in one model call route each
 * person-scoped category to its section, re-voice it, and pick a demonstrating quote; assemble the
 * three sections. Null when there is nothing worth shipping. `injectProfile` (sink.ts) installs the text.
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
    .map((s) => ({ name: s.name, description: s.description, lift: s.lift, cands: candidatesFor(s.name, labelled) }))
    .filter((w) => w.cands.length);
  const bin = findAssistant();
  const voiced = bin && work.length ? pickAndVoice(bin, work) : new Map<string, Voiced>();
  const signals = new Map<string, string>();
  for (const [name, v] of voiced) if (v.signal) signals.set(name, v.signal);
  const sigs = signatures(labelled, cats);

  const times = moments.map((m) => m.ts).filter(Boolean).sort();
  return assemble(
    stats,
    voiced,
    {
      sessions: new Set(moments.map((m) => m.session)).size,
      moments: moments.length,
      from: (times[0] ?? '').slice(0, 10),
      to: (times[times.length - 1] ?? '').slice(0, 10),
    },
    { sigs, signals },
  );
}
