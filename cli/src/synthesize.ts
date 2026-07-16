/**
 * SYNTHESIZE — the big read over the pile.
 *
 * The judgments are hundreds of one-liners about single moments. This hands the whole stack to the
 * person's own `claude` once and asks for the shape of the PERSON behind them (handover §3.3, §8).
 * Same evidence, two renderings for two audiences:
 *   profile — the AI's copy. What loads into its context so it speaks to a person, not a blank.
 *   report — the human's copy. What the person reads about themselves.
 *
 * The profile is a MODEL OF A PERSON, reasoned from — not a rules sheet, not a list of behaviours
 * (the person rejected "more paper" outright, §4). It is specific or it is nothing: a horoscope
 * that could be anyone is worse than silence.
 *
 * RECENCY IS STRUCTURED IN CODE. LLMs reason poorly about time from a flat timestamped pile, so we
 * sort, window, and label recency here and hand the model a "recent vs earlier" split it cannot
 * misread — otherwise it averages the whole history and reports the person's DOMINANT (often
 * outdated) direction, missing a pivot. This was a real dogfooding bug: the first profile described
 * a product Sun had already pivoted away from, because the pile was weighted by volume, not recency.
 */
import { runClaude } from './claude.js';
import type { Judgment } from './judge.js';

/** Free, raw counts that ground the synthesis so it can cite real frequencies. */
export interface Corpus {
  sessions: number;
  exchanges: number;
  /** the most-judged topics, most first — the pile's own centre of gravity */
  topics?: string[];
  /** earliest / latest exchange dates (YYYY-MM-DD), to describe the span */
  from?: string;
  to?: string;
}

function ground(corpus: Corpus): string {
  const bits = [`${corpus.sessions} sessions`, `${corpus.exchanges} judged exchanges`];
  if (corpus.from && corpus.to) bits.push(`${corpus.from} → ${corpus.to}`);
  return bits.join(' · ');
}

const RECENT_DAYS = 14; // "recent" = within this many days of the newest exchange…
const RECENT_FLOOR = 15; // …but always at least this many, so the window is never empty or tiny.

function isoDaysBefore(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/**
 * Split the judgments into a RECENT window and the EARLIER record and hand them to the model as two
 * clearly-labelled blocks. This is the recency fix: the model takes CURRENT direction from RECENT and
 * stable traits from the whole, and can see a pivot because the split is EXPLICIT — not something it
 * has to infer from timestamps (which it does badly).
 */
function recencyBlocks(judgments: Judgment[]): string {
  const sorted = [...judgments].sort((a, b) => b.ts.localeCompare(a.ts)); // newest first
  const newest = sorted[0]?.ts ?? '';
  const cutoff = newest ? isoDaysBefore(newest, RECENT_DAYS) : '';
  let recent = cutoff ? sorted.filter((j) => j.ts >= cutoff) : sorted;
  if (recent.length < RECENT_FLOOR) recent = sorted.slice(0, RECENT_FLOOR);
  const earlier = sorted.slice(recent.length);
  const lines = (js: Judgment[]) => js.map((j) => j.line).join('\n');
  return [
    'MOST RECENT — their current focus and direction (weight THIS for what they are building now):',
    lines(recent),
    '',
    'EARLIER — the longer record (for stable traits: what they know, how they think, their altitude,',
    'the failure signal):',
    earlier.length ? lines(earlier) : '(none — the recent window is the whole record)',
  ].join('\n');
}

const PROFILE_PROMPT = `You are writing the file an AI coding assistant loads at the start of every
session so it knows WHO IT IS TALKING TO. The reader is the assistant, not the person.

Below are one-line observations from real exchanges, split into their MOST RECENT and their EARLIER
record. Each says whether understanding transferred and about what. Describe the PERSON.

RECENCY — this matters most and is the easy thing to get wrong:
- What they are BUILDING and their CURRENT direction: take it from the MOST RECENT block. People pivot;
  the recent window is the truth about NOW. If MOST RECENT differs from EARLIER they changed direction
  — describe the CURRENT one, never the historical average.
- Stable traits (what they know, how they think, their altitude, the failure signal): read the WHOLE
  record — these change slowly.

Write it as a model of a human to reason FROM — never a list of rules ("do X, don't do Y"), which this
person rejects as more paper. Cover, only where the evidence supports it:
- what they KNOW and don't (fluent or beginner? name the tell)
- what actually stalls them — the tech, or MEANING and altitude?
- how they think and talk (think out loud? give orders or reason?)
- what they are building and WHY — their CURRENT direction, the thing to lean on hardest
- the FAILURE SIGNAL: the exact words/moves that mean the assistant just went abstract or long

Hard rules:
- SPECIFIC or nothing. Cite concrete topics and real frequencies where the pile shows them. A sentence
  that could describe anyone is a failure, so cut it.
- Ground every claim in the observations. Invent nothing. Thin evidence on something means say less, don't pad.
- Never use an em dash or en dash (— or –). Use a comma, a colon, a period, or parentheses instead. They
  read as machine-written and this person treats them as a tell.
- Second person, addressed to the assistant about the person. Plain text, no markdown headings, under
  250 words. Lead with what matters most.`;

const REPORT_PROMPT = `You are writing a short, honest note to a PERSON about their own pattern of
working with an AI coding assistant. The reader is that person — not their assistant.

Below are one-line observations from their real exchanges, split into MOST RECENT and EARLIER. Each
says whether understanding transferred and about what. Tell them, warmly and without flattery:
- where things clicked, and where they got lost or felt stupid — name the moments/topics
- the pattern underneath it (is the block the tech, or meaning — "what does this mean for us")
- the TREND: what changed between EARLIER and MOST RECENT — where they've grown, where they pivoted

Hard rules:
- SPECIFIC or nothing: real topics, moments, frequencies. No horoscope, no generic praise.
- Ground every claim in the observations. Invent nothing. Weight MOST RECENT for who they are now.
- Never use an em dash or en dash (— or –). Use a comma, a colon, a period, or parentheses instead.
- Second person ("you"), plain and kind, no markdown headings, under 220 words.`;

/**
 * Guarantee no em/en dash reaches the artifact. The prompt asks the model to avoid them, but a prompt
 * is a request, not a promise — this is the promise. Sun reads a stray "—" as an AI wrote this, and
 * the profile's whole job is to not feel machine-made, so we strip them deterministically, in code.
 */
function deDash(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ', ');
}

/** The AI's copy — what loads into its context. Returns undefined if the read couldn't be done. */
export function synthesizeProfile(judgments: Judgment[], corpus: Corpus, bin: string): string | undefined {
  if (!judgments.length) return undefined;
  const input = `${PROFILE_PROMPT}\n\nCORPUS: ${ground(corpus)}\n\n${recencyBlocks(judgments)}`;
  const out = runClaude(bin, input);
  return out ? deDash(out) : undefined;
}

/** The human's copy — what the person reads. Returns undefined if the read couldn't be done. */
export function synthesizeReport(judgments: Judgment[], corpus: Corpus, bin: string): string | undefined {
  if (!judgments.length) return undefined;
  const input = `${REPORT_PROMPT}\n\nCORPUS: ${ground(corpus)}\n\n${recencyBlocks(judgments)}`;
  const out = runClaude(bin, input);
  return out ? deDash(out) : undefined;
}

/** The pile's own centre of gravity — the topics that come up most, for grounding + `stats`. */
export function topTopics(judgments: Judgment[], n = 8): string[] {
  const counts = new Map<string, number>();
  for (const j of judgments) {
    // line shape: "<verdict> — <topic> — <what they did>"; the middle field is the topic
    const topic = j.line.split('—')[1]?.trim().toLowerCase();
    if (!topic) continue;
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}
