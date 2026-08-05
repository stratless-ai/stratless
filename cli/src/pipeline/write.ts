/**
 * WRITE — the file. Assembles HUMAN.md from the scored pile: the person, in their own counts and
 * quotes. Code-assembled — nothing here a model invents — save for ONE call, which voices each NEW
 * category once (picks the demonstrating quote, routes the section, words the instruction) and is
 * skipped entirely when the voice cache already covers the pile (voiced.ts — a steady-state rebuild
 * is $0). The counts and ordering are arithmetic; which real line best SHOWS a behaviour, which
 * section it serves, and how to phrase the instruction, are judgements — the one thing worth a
 * model call, paid once per category, not per build.
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
 * The text produced here starts at the provenance line: `injectProfile` (load.ts) adds the
 * `# Who you are working with` header and the format marker when it installs, so repeating the
 * header here would double it.
 */
import { brainFor } from '../integrations/brains/registry.js';
import { loadCategories } from './categories.js';
import { loadAssignments } from './assign.js';
import { loadMoments, type Moment } from './moments.js';
import { join, tally, LIFT_CUT, type Labelled, type CategoryStat } from './count.js';
import { liftPrint, type Clause, type LiftPrint } from './lift.js';
import { readVoiced, rememberVoiced, voicingPlan, type VoicedRow } from './voiced.js';
import { signatures, type Signature } from './shorthand.js';
import { hasNumeral } from './numerals.js';

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

/** A break longer than this ends a stretch of history. A month off is a holiday; six months is a
 *  different era, and a lone session on the far side of one does not describe where a person's
 *  history is. */
const WINDOW_GAP_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * WHERE THE EVIDENCE ACTUALLY IS — the span the provenance line may claim.
 *
 * Naïvely this is min(ts) to max(ts), and that broke the moment a second assistant arrived: one
 * Codex rollout from December 2025 sat six months before the rest of the corpus and stretched the
 * stated range to "2025-12-17 to 2026-08-03" over a pile that is 99.98% ten weeks old. True, and
 * misleading — the line exists to tell a reader where the evidence is.
 *
 * PER RECORD, THEN UNION, and the order matters. Continuity belongs to one assistant's own
 * timeline: a person who worked in Codex through the spring and Claude Code since June has two
 * unbroken stretches, not one broken one, and judging them together would bridge nothing and drop
 * the spring entirely. Judged separately and then spanned, both eras are claimed — which is the
 * truth about that person even though no single tool covers it.
 *
 * The span may therefore contain a gap. That is correct: this is a window, not a promise of daily
 * activity. What it may not do is start at a session that has nothing near it.
 */
export function evidenceWindow(moments: Moment[]): { from: string; to: string } {
  const byRecord = new Map<string, string[]>();
  for (const m of moments) {
    if (!m.ts) continue;
    const day = m.ts.slice(0, 10);
    const days = byRecord.get(m.record);
    if (days) days.push(day);
    else byRecord.set(m.record, [day]);
  }
  let from: string | undefined;
  let to: string | undefined;
  let rawFrom: string | undefined;
  let rawTo: string | undefined;
  for (const days of byRecord.values()) {
    const uniq = [...new Set(days)].sort();
    const end = uniq[uniq.length - 1];
    if (!rawFrom || uniq[0] < rawFrom) rawFrom = uniq[0];
    if (!rawTo || end > rawTo) rawTo = end;
    let start = uniq[0];
    let startIdx = 0;
    for (let i = 0; i + 1 < uniq.length; i++) {
      const gap = (Date.parse(uniq[i + 1]) - Date.parse(uniq[i])) / DAY_MS;
      if (Number.isFinite(gap) && gap > WINDOW_GAP_DAYS) {
        start = uniq[i + 1];
        startIdx = i + 1;
      }
    }
    // A SINGLE DAY IS NOT A STRETCH. Without this an assistant whose entire history is one ancient
    // session still sets the boundary — there is no gap *within* one day to break, so the per-record
    // rule never fires and the six-month lie comes straight back. Two days of use is the smallest
    // thing that can honestly be called a period of working.
    if (uniq.length - startIdx < 2) continue;
    if (!from || start < from) from = start;
    if (!to || end > to) to = end;
  }
  // Nobody has two days yet — a machine days old. Claim the raw span rather than nothing: there is
  // no era to distinguish, so there is nothing to be misled about.
  return { from: from ?? rawFrom ?? '', to: to ?? rawTo ?? '' };
}

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
  /** when-clauses attached to their host rows (LIFT is dynamics, never surface — no section of its own) */
  rules: number;
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
  additionalProperties: false,
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
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

export type VoicePickResult =
  | { status: 'accepted'; rows: Map<string, Voiced> }
  | { status: 'refused-numerals' };

/** The one model call. For each category it: routes to a section (frame/judge/register), re-voices it
 *  into an instruction to the assistant, picks the demonstrating quote (1..N, or 0 for none), and
 *  writes a short decode for the "In the moment" key. A category with no clear quote drops from the
 *  file rather than ship a line whose receipt fails. */
export function pickAndVoice(
  work: { name: string; description: string; lift: number; cands: Moment[] }[],
  record: string,
): VoicePickResult {
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

NUMERALS: use no numeric characters in LINE or SIGNAL. The renderer adds every count and quantitative
receipt itself; model-authored precision is refused rather than loaded.

Reply with JSON only:
{"picks":[{"name":"<exact name>","section":"frame|judge|register|none","line":"<instruction>","quote":<number or 0>,"signal":"<six words or fewer>"}]}

${body}`;
  const brain = brainFor(record);
  if (!brain) return { status: 'accepted', rows: new Map<string, Voiced>() };
  const answer = brain.ask(prompt, { role: 'main', feature: 'write', timeoutMs: QUOTE_TIMEOUT_MS, schema: VOICE_SCHEMA });
  const out = new Map<string, Voiced>();
  if (!answer) return { status: 'accepted', rows: out };
  const raw = answer.text;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { status: 'accepted', rows: out };
  try {
    const picks = (JSON.parse(m[0]).picks ?? []) as { name?: unknown; section?: unknown; line?: unknown; quote?: unknown; signal?: unknown }[];
    const byName = new Map(work.map((w) => [w.name, w]));
    for (const p of picks) {
      const name = typeof p.name === 'string' ? p.name : '';
      const w = byName.get(name);
      if (!w) continue;
      // 'none' is a REAL answer, not a parse failure: the router said this behaviour is not an
      // offer, a catch, or a register note. It is RETURNED (and cached — a rejected category
      // stays rejected; re-asking would re-bill forever) and assemble routes it into no section.
      // Only a malformed value is dropped, so the model can be re-asked next flush.
      if (p.section === 'none') {
        out.set(name, { section: 'none', quote: '', line: '', signal: '' });
        continue;
      }
      const section: Section | undefined =
        p.section === 'judge' ? 'judge' : p.section === 'register' ? 'register' : p.section === 'frame' ? 'frame' : undefined;
      const line = typeof p.line === 'string' ? p.line.replace(/\s+/g, ' ').trim() : '';
      if (!section || !line) continue;
      const q = Number(p.quote);
      const quote = Number.isInteger(q) && q >= 1 && q <= w.cands.length ? w.cands[q - 1].reply : '';
      const signal = typeof p.signal === 'string' ? p.signal.trim() : '';
      // Refuse the WHOLE call, not only this row. Partial acceptance would let the same unsupported
      // response quietly reshape the profile while claiming it was refused.
      if (hasNumeral(line, signal)) return { status: 'refused-numerals' };
      out.set(name, { section, quote, line, signal });
    }
  } catch {
    /* unparseable — nothing voiced; every entry needs a quote, so the file comes back empty */
  }
  return { status: 'accepted', rows: out };
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
function block(claim: string, stat: CategoryStat, sec: Section, cl?: Clause): string {
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
  // THE WHEN-CLAUSE (2026-07-28). A mode-1 patch prints as a when-clause on the row its category already
  // earned — never a section of its own (the founder's read killed that: a separate section was
  // the design's internal schema leaking into the file). The receipt then carries both sides:
  // the row's own count and the gap's slip count, with any trend word on the gap itself.
  // The verdict prints bare — `met`, no owner label — because the FILE is the owner now: every
  // count and both sides of every verdict in a pair's profile were measured inside that one
  // relationship (the per-record doctrine). The other assistant has its own file and its own
  // verdicts; naming tools inside this one would be exactly the cross-pair claim the split removed.
  const bits: string[] = [];
  if (stat.direction && (sec === 'register' || stat.verified)) bits.push(stat.direction);
  if (stat.burst) bits.push('comes in bursts');
  const base = claim.replace(/\s+/g, ' ').trim();
  const c = cl ? `${base.replace(/\s*\.\s*$/, '')} — and ${cl.clause.replace(/\s*\.\s*$/, '').replace(/\s+/g, ' ').trim()}.` : base;
  const slipBit = cl ? ` · slip ${cl.slip}×${cl.trend ? ', ' + cl.trend : ''}` : '';
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
  lift?: LiftPrint,
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

  // Clauses attach only to categories that earned a row — a patch whose home has no entry stays
  // invisible, key line and all (the file may not gesture at something it cannot host). Attachment
  // is judged pre-budget; in the rare case a register host is later budget-dropped, its key line
  // still stands — a true trigger without its detail row, which the key's own subtitle allows.
  const clauses = lift?.clauses;
  const clauseFor = (name: string): Clause | undefined => clauses?.get(name);
  const attached = [...(clauses?.keys() ?? [])].filter((n) => entries.some((e) => e.stat.name === n));

  const decodeLines = decode ? decodeKey(decode) : [];
  // THE SITUATION TRIGGERS — the gap's live recognizer. Phrase triggers are states the person
  // announces; a gap's trigger is the state they don't (if they had announced it, there would be
  // no gap). Derived mechanically from the patch's when-clause; an unparseable clause casts none.
  const situations: string[] = [];
  for (const n of attached) {
    const m = clauses!.get(n)!.clause.match(/^when\s+([^,]+),\s*(.+)$/i);
    if (m) situations.push(`- ${m[1].trim()} → ${m[2].trim().replace(/\.\s*$/, '')}`);
  }
  // THE LOOP'S KEY LINES (2026-07-29) — mode 2's templated trigger patches: the signature line
  // (it stands on its OWN evidence floor — the founder's call) and the delegated line. Templated
  // upstream, never voiced; a third bucket after the situations, same grammar (state → move).
  // liftPrint owns every gating decision — assembly just prints what it was handed.
  const loopKey = (lift?.keyLines ?? []).map((l) => `- ${l}`);
  const keyLines = [...decodeLines, ...situations, ...loopKey];

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
      situations.length || loopKey.length
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
      const cl = clauseFor(e.stat.name);
      if (cl) attachedPrinted++;
      text += block(e.v.line, e.stat, 'frame', cl);
    }
    text += '\n';
  }
  if (judge.length) {
    text += ['## What to catch for me', '', 'What I reliably challenge or refuse. Pre-empt these, so I do not have to catch them myself.', '', ''].join('\n');
    for (const e of judge) {
      const cl = clauseFor(e.stat.name);
      if (cl) attachedPrinted++;
      text += block(e.v.line, e.stat, 'judge', cl);
    }
    text += '\n';
  }
  let shippedReg = 0;
  if (register.length) {
    text += ['## How to talk to me', '', 'The register I work in. Match it rather than smoothing it over.', '', ''].join('\n');
    for (const e of register) {
      const cl = clauseFor(e.stat.name);
      const row = block(e.v.line, e.stat, 'register', cl);
      if (text.length + row.length > CHAR_BUDGET) break;
      if (cl) attachedPrinted++;
      text += row;
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
      rules: attachedPrinted,
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
 * Build the whole profile from the live stores — VOICE ONCE, RE-STAMP FOREVER (2026-07-30).
 * Every category's voice (section routing, instruction line, decode signal, register quote-gate)
 * is read from the cache first; the model is asked only for categories with no stored voice for
 * their generation, or a register row whose quote-proof aged out. In steady state that is ZERO
 * categories and the whole rebuild is free arithmetic: counts, trends, met/slip, clauses and key
 * lines re-stamp fresh while the wording never moves — which also ends the write-side wobble.
 * `empty` when there is nothing worth shipping; `refused-numerals` keeps the previous artifact.
 */
export type ProfileBuildResult =
  | { status: 'built'; text: string; meta: ProfileMeta }
  | { status: 'empty' }
  | { status: 'refused-numerals' };

export function buildProfile(record: string): ProfileBuildResult {
  // ONE PAIR'S FILE FROM ONE PAIR'S EVIDENCE. Everything below — the categories, the slice of the
  // pile, the assignments, the voice cache, the lift print — is this record's own. A count in the
  // file it produces was counted inside one relationship, which is what lets every receipt print
  // bare: the file itself is the owner label.
  const cats = loadCategories(record).filter((c) => !CIRCULAR.has(c.name));
  if (!cats.length) return { status: 'empty' };
  const moments = loadMoments().filter((m) => m.record === record);
  if (!moments.length) return { status: 'empty' };
  const labelled = join(moments, loadAssignments(record));
  const stats = tally(labelled, cats);

  const work = stats
    .filter((s) => s.scope !== 'project' && s.count > 0)
    .map((s) => ({ name: s.name, description: s.description, lift: s.lift, cands: candidatesFor(s.name, labelled) }))
    .filter((w) => w.cands.length);

  const bornOf = new Map(cats.map((c) => [c.name, c.bornAt]));
  const plan = voicingPlan(
    work.map((w) => ({ name: w.name, bornAt: bornOf.get(w.name) ?? '', candidateReplies: w.cands.map((m) => m.reply) })),
    readVoiced(record),
  );
  const missingWork = work.filter((w) => plan.missing.includes(w.name));
  const picked = missingWork.length
    ? pickAndVoice(missingWork, record)
    : { status: 'accepted' as const, rows: new Map<string, Voiced>() };
  if (picked.status === 'refused-numerals') return picked;
  const fresh = picked.rows;
  // An old cache row containing model-authored precision is not allowed to disappear silently. It
  // must be replaced in full; if the borrowed model did not answer, keep the old loaded profile and
  // retry rather than writing a thinner file around the omission.
  if (plan.replace.some((name) => !fresh.has(name))) return { status: 'refused-numerals' };
  if (fresh.size) {
    const voicedAt = new Date().toISOString();
    rememberVoiced(
      [...fresh].map(([name, v]): VoicedRow => ({
        name,
        bornAt: bornOf.get(name) ?? '',
        section: v.section,
        line: v.line,
        signal: v.signal,
        quote: v.section === 'register' ? v.quote : '',
        voicedAt,
      })),
      cats.map((c) => ({ name: c.name, bornAt: c.bornAt })),
      record,
      undefined,
      plan.replace,
    );
  }

  const voiced = new Map<string, Voiced>();
  for (const [name, row] of plan.reuse) voiced.set(name, { section: row.section, line: row.line, signal: row.signal, quote: row.quote });
  for (const [name, v] of fresh) voiced.set(name, v);
  const signals = new Map<string, string>();
  for (const [name, v] of voiced) if (v.signal) signals.set(name, v.signal);
  const sigs = signatures(labelled, cats);

  // EVERY NUMBER IN THE PROVENANCE DESCRIBES THE SAME WINDOW. Counting conversations over the whole
  // pile while stating a trimmed range would put the seam back in a different place: a reader could
  // not reconcile "161 conversations" with a span that holds 162. The moment outside it is not
  // discarded — it is in the piles, it is evidence, it counts toward every row — it simply does not
  // get to set the boundary or be advertised in it.
  const win = evidenceWindow(moments);
  const inWindow = moments.filter((m) => m.ts && m.ts.slice(0, 10) >= win.from && m.ts.slice(0, 10) <= win.to);
  const assembled = assemble(
    stats,
    voiced,
    {
      sessions: new Set(inWindow.map((m) => m.session)).size,
      moments: inWindow.length,
      from: win.from,
      to: win.to,
    },
    { sigs, signals },
    liftPrint(record),
  );
  return assembled ? { status: 'built', ...assembled } : { status: 'empty' };
}
