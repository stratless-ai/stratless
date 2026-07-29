/**
 * WRITE — the file. Assembles HUMAN.md from the scored pile: the person, in their own counts and
 * quotes. Code-assembled — nothing here a model invents — save for ONE call, which for each category
 * picks the demonstrating quote AND re-voices it into a conductor's instruction (0.5.0). The counts and
 * ordering are arithmetic; which real line best SHOWS a behaviour, which section it serves, and how to
 * phrase the instruction, are judgements — and that is the one thing worth a model call.
 *
 * THE SECTIONS — the conductor's brief (positioning.md): "What to offer me before I ask" (Frame),
 * "What to catch for me" (Judge), "How to talk to me" (Register). The model routes each category to
 * its section; code assembles. This REPLACED the lift-split ("gone wrong" vs "how they work"): the
 * sections are functional now, not distress-based — though lift still rides in as a routing HINT (a
 * catch fires in the high-lift reactions). Count-ordered within each section. Person-scoped only —
 * project categories are the project layer's job. The "In the moment" decode still opens the file.
 *
 * THE PROFILE CARRIES WHATEVER THE PERSON'S DATA EARNS (2026-07-26). The headings are instructions to
 * the READER — how to use the list beneath them — not claims about the person, so a stable vocabulary
 * is right. But no section is guaranteed: any of them may be empty and simply not print, a behaviour
 * that fits none is routed to 'none' and left out, and only a file with nothing at all comes back
 * null. Demanding that a person HAVE a section would be declaring, which is the one thing the whole
 * pipeline exists to avoid.
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
import { openRiders, type Rider } from './rules.js';
import { knowledgePrint, type KnowledgePrint } from './knowledge.js';
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
  /** gap riders attached to their host rows (LIFT never gets a section of its own) */
  rules: number;
  /** temporary knowledge rows shipped at the end of the talk section (same doctrine: no section) */
  knowledge: number;
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

/** Where a behaviour belongs in the brief — or 'none' when it belongs in no section. The escape
 *  hatch is deliberate: a forced three-way choice makes the router jam a behaviour that is not an
 *  offer, a catch, or a register note into the least-bad fit, and a jammed entry is a declared one. */
export type Section = 'frame' | 'judge' | 'register' | 'none';

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
- "none" — it is genuinely none of the three. USE THIS rather than forcing a poor fit; a category
  routed to "none" is simply left out of the brief, which is better than a section claiming something
  the evidence does not support.

LINE: one sentence written AS AN INSTRUCTION TO THE ASSISTANT (offer X, catch Y, talk like Z), never a
description of the person. Plain language; where they reach for a recurring phrase, quote it. Use commas
or colons, never an em dash. The line must still be true on this person's NEXT project: if a noun would
name their current project, product, or a specific technology they are evaluating this month, write the
kind of thing it is instead ("their product", "a named tool", "a concrete slice"); keep every other word
as specific as the evidence.

QUOTE: the ONE quote (by number) that most clearly SHOWS this to someone who never met them; 0 if none.
- Prefer a quote that demonstrates it over one that merely mentions the topic; short over meandering.
- Prefer a quote that does not disclose the person's plans, product decisions, or anything they would
  not want read aloud to a stranger; when every candidate does, pick the least revealing.

SIGNAL: a plain decode, SIX WORDS OR FEWER, of what the person is ASKING FOR when they do this: what it
MEANS, never an instruction. E.g. "wants a plan before building", "wants it proven, not asserted".

Reply with JSON only:
{"picks":[{"name":"<exact name>","section":"frame|judge|register|none","line":"<instruction>","quote":<number or 0>,"signal":"<six words or fewer>"}]}

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
      // 'none' is a REAL answer, not a parse failure: the router said this behaviour is not an offer,
      // a catch, or a register note, so it is left out of the brief. It lands as undefined here and
      // takes the same path as a malformed value — dropped — which is the correct outcome for both.
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

/**
 * One entry: one bullet, one receipt — the same shape in every section.
 *
 * NO QUOTE IS PRINTED, anywhere, and the reasons differ by section. Frame and Judge lines are
 * complete instructions — an example adds nothing the assistant can act on, and measured 2026-07-26
 * roughly ONE IN FIVE picked quotes did not demonstrate their line (a wrong quote teaches a wrong
 * trigger, worse than silence). Register lost its printed quote later the same day, for the opposite
 * reason: the conductor voicing EMBEDS the recurring phrase inside the instruction ("treat a short
 * go-ahead like 'looks good, let's move on' as full permission…"), so the blockquote underneath had
 * become a duplicate — 4 of 5 register rows on the real build repeated a phrase their line already
 * carried. The quote still EXISTS for register rows — voice() must pick one or the row drops — it is
 * the quality gate proving the line is demonstrable, not display.
 */
function block(claim: string, stat: CategoryStat, sec: Section, rd?: Rider): string {
  // THE COMPACT RECEIPT (2026-07-26). The row is an instruction with a terse marker, not a claim
  // followed by an evidence SENTENCE — "338 times across 77 conversations" on its own line was
  // written for a human auditor, and the AI gains nothing from the prose. The count itself stays:
  // it is what separates a profile from a prompt (an instruction backed by "(338×)" is observed
  // fact, not author opinion), and the file's own preamble promises every line carries it.
  //
  // WHICH TREND WORDS MAY RIDE IN THE PARENTHESIS depends on the section (2026-07-27). Register
  // rows describe the person, and their one-sided trend stays. Frame and Judge rows instruct the
  // assistant to ACT, so a trend word there is a directive — and it prints only when count.ts
  // confirmed it from both sides of the conversation (`met`, or a fading the assistant's own
  // supply agrees with). A one-sided word on a demand row taught sabotage: the plan row's
  // `fading` told every assistant to ease off the very behaviour that was working.
  //
  // THE RIDER (2026-07-28). A gap rule prints as a when-clause on the row its category already
  // earned — never a section of its own (the founder's read killed that: a separate section was
  // the design's internal schema leaking into the file). The receipt then carries both sides:
  // the row's own count and the gap's slip count, with any trend word on the gap itself.
  const bits: string[] = [];
  if (stat.direction && (sec === 'register' || stat.verified)) bits.push(stat.direction);
  if (stat.burst) bits.push('comes in bursts');
  const base = claim.replace(/\s+/g, ' ').trim();
  const c = rd ? `${base.replace(/\s*\.\s*$/, '')} — and ${rd.rider.replace(/\s*\.\s*$/, '').replace(/\s+/g, ' ').trim()}.` : base;
  const slipBit = rd ? ` · slip ${rd.slip}×${rd.trend ? ', ' + rd.trend : ''}` : '';
  return `- ${c} (${stat.count}×${bits.length ? ', ' + bits.join(', ') : ''}${slipBit})\n`;
}

interface Entry {
  stat: CategoryStat;
  v: Voiced;
}

/**
 * THE PURE ASSEMBLER — given per-category stats, a routing+quote+line per category, and provenance,
 * build the file text. Pure and no model, so the whole shape is testable from fixtures.
 *
 * THE PROFILE CARRIES WHATEVER THE PERSON'S DATA EARNS (2026-07-26). The section HEADINGS are
 * instructions to the reader — "here is how to use the list below" — not claims about the person;
 * a stable vocabulary is what makes the file usable. But nothing may DEMAND that a person have a
 * given section:
 *
 *   · an empty section simply does not print — including BOTH bookends;
 *   · a profile with no "what to catch" entries is a valid profile. It says this person does not
 *     systematically catch things, which is a finding, not a failure. An earlier rule returned null
 *     unless a bookend survived, which quietly required everyone to be a conductor;
 *   · a behaviour that is not an offer, a catch, or a register note is routed to NONE and left out,
 *     rather than jammed into the least-bad of three. Forcing the fit is declaring.
 *
 * Returns null only when NOTHING earned a place at all.
 */
export function assemble(
  stats: CategoryStat[],
  voiced: Map<string, Voiced>,
  prov: { sessions: number; moments: number; from: string; to: string },
  decode?: { sigs: Signature[]; signals: Map<string, string> },
  riders?: Map<string, Rider>,
  knowledge?: KnowledgePrint,
): { text: string; meta: ProfileMeta } | null {
  const entries: Entry[] = stats
    .filter((s) => s.scope !== 'project' && s.count > 0)
    .map((s) => ({ stat: s, v: voiced.get(s.name) }))
    // A quote is REQUIRED only where it is the content — Register. Frame and Judge ship on their
    // instruction plus their count, so a category with no clean quote no longer loses its place in
    // the brief for a receipt the section does not print.
    .filter((e): e is Entry => !!e.v && (e.v.section !== 'register' || (typeof e.v.quote === 'string' && e.v.quote.length > 0)));

  const inSection = (sec: Section): Entry[] =>
    entries.filter((e) => e.v.section === sec).sort((a, b) => b.stat.count - a.stat.count);
  const frame = inSection('frame');
  const judge = inSection('judge');
  const register = inSection('register');
  // Nothing at all earned a place — not "no bookend earned a place". A person with only register
  // notes still has a profile worth loading.
  if (!frame.length && !judge.length && !register.length) return null;

  // Riders attach only to categories that earned a row — a rule whose category has no entry stays
  // invisible, key line and all (the file may not gesture at something it cannot host). Attachment
  // is judged pre-budget; in the rare case a register host is later budget-dropped, its key line
  // still stands — a true trigger without its detail row, which the key's own subtitle allows.
  const riderFor = (name: string): Rider | undefined => riders?.get(name);
  const attached = [...(riders?.keys() ?? [])].filter((n) => entries.some((e) => e.stat.name === n));

  const decodeLines = decode ? decodeKey(decode) : [];
  // THE SITUATION TRIGGERS — the gap's live recognizer. Phrase triggers are states the person
  // announces; a gap's trigger is the state they don't (if they had announced it, there would be
  // no gap). Derived mechanically from the rider's when-clause; an unparseable rider casts none.
  const situations: string[] = [];
  for (const n of attached) {
    const m = riders!.get(n)!.rider.match(/^when\s+([^,]+),\s*(.+)$/i);
    if (m) situations.push(`- ${m[1].trim()} → ${m[2].trim().replace(/\.\s*$/, '')}`);
  }
  // THE KNOWLEDGE KEY LINES (2026-07-29) — the leg's templated reader instructions (the meta line,
  // and the delegated line when delegated zones exist). Code-templated upstream, never voiced; a
  // third bucket after the situations, same grammar (state → move).
  const knowledgeKey = (knowledge?.rows.length ? knowledge.keyLines : []).map((l) => `- ${l}`);
  const keyLines = [...decodeLines, ...situations, ...knowledgeKey];

  const head: string[] = [
    `Derived from ${prov.sessions} of this person's own conversations with an AI assistant, ${prov.from} to ${prov.to}. Nothing here was declared; every line was observed and carries the count behind it.${attached.length ? ' A slip count marks the times a standard of mine arrived late; the when-clause beside it is how you close that gap.' : ''}`,
    '',
    '**Read this as a prior, not a law.** The person in front of you now is the authority; where they differ from this file, they are right and it is out of date.',
    '',
  ];
  if (keyLines.length) {
    head.push(
      '## In the moment',
      '',
      situations.length || knowledgeKey.length
        ? 'Their shorthand, and the situations to catch unprompted. Recognise these live; the detail is in the sections below.'
        : 'Their shorthand. Recognise these live; the detail is in the sections below.',
      '',
      ...keyLines,
      '',
    );
  }
  // One more blank so the first section HEADING gets its own blank line above it. Every later
  // heading gets one for free (block() ends with '\n\n'); the head is the only seam without one,
  // and without this the shorthand list runs straight into `## What to offer me before I ask`.
  head.push('');
  let text = head.join('\n');

  // Frame + Judge are the bookends — always shipped in full. Register fills the remaining budget.
  // Rows are single-line bullets now, so each section closes with one blank line ('\n') to keep the
  // next heading separated — block() no longer carries trailing spacing of its own.
  let attachedPrinted = 0;
  if (frame.length) {
    text += ['## What to offer me before I ask', '', 'Set these up or hand them over before I ask. Offering them unprompted is the point, not overstepping.', '', ''].join('\n');
    for (const e of frame) {
      const rd = riderFor(e.stat.name);
      if (rd) attachedPrinted++;
      text += block(e.v.line, e.stat, 'frame', rd);
    }
    text += '\n';
  }
  if (judge.length) {
    text += ['## What to catch for me', '', 'What I reliably challenge or refuse. Pre-empt these, so I do not have to catch them myself.', '', ''].join('\n');
    for (const e of judge) {
      const rd = riderFor(e.stat.name);
      if (rd) attachedPrinted++;
      text += block(e.v.line, e.stat, 'judge', rd);
    }
    text += '\n';
  }
  // The talk section hosts two kinds of rows: register entries, then THE TEMPORARY KNOWLEDGE ROWS
  // (2026-07-29) at its tail — both inside the same budget (which may honestly drop the second
  // knowledge row). A knowledge row's text is voiced-once, verbatim; its receipt is the mint
  // evidence, and NO trend word ever rides it — the row's disappearance on `learned` IS the trend
  // surface. The file thins as the person gets better. Assembled locally so a section whose every
  // row was budget-dropped never ships a bare heading.
  let shippedReg = 0;
  let shippedKnow = 0;
  const kRows = knowledge?.rows ?? [];
  if (register.length || kRows.length) {
    let sect = ['## How to talk to me', '', 'The register I work in. Match it rather than smoothing it over.', '', ''].join('\n');
    let sectRiders = 0;
    for (const e of register) {
      const rd = riderFor(e.stat.name);
      const row = block(e.v.line, e.stat, 'register', rd);
      if (text.length + sect.length + row.length > CHAR_BUDGET) break;
      if (rd) sectRiders++;
      sect += row;
      shippedReg++;
    }
    for (const k of kRows) {
      const row = `- ${k.row.replace(/\s+/g, ' ').trim().replace(/\.\s*$/, '')} (asked ${k.askCount}× across ${k.askSessions} conversations)\n`;
      if (text.length + sect.length + row.length > CHAR_BUDGET) break;
      sect += row;
      shippedKnow++;
    }
    if (shippedReg || shippedKnow) {
      text += sect;
      attachedPrinted += sectRiders;
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
      rules: attachedPrinted,
      knowledge: shippedKnow,
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
    openRiders(),
    knowledgePrint(),
  );
}
