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

function pile(judgments: Judgment[]): string {
  // Oldest first — the model reads the arc, not just the snapshot.
  return judgments.map((j) => j.line).join('\n');
}

function ground(corpus: Corpus): string {
  const bits = [`${corpus.sessions} sessions`, `${corpus.exchanges} judged exchanges`];
  if (corpus.from && corpus.to) bits.push(`${corpus.from} → ${corpus.to}`);
  return bits.join(' · ');
}

const PROFILE_PROMPT = `You are writing the file an AI coding assistant loads at the start of every
session so it knows WHO IT IS TALKING TO. The reader is the assistant, not the person.

Below is a stack of one-line observations, each from one real exchange, oldest first. Each says
whether understanding transferred and about what. Read the whole pile and describe the PERSON.

Write it as a model of a human to reason FROM — never a list of rules ("do X, don't do Y"), which
this person rejects as more paper. Cover, only where the evidence supports it:
- what they KNOW and don't (are they fluent or a beginner? name the tell)
- what actually stalls them — is it the tech, or is it MEANING and altitude?
- how they think and talk (do they think out loud? give orders or reason?)
- what they are building and WHY (their direction — the thing to lean on hardest)
- the FAILURE SIGNAL: the exact words/moves that mean the assistant just went abstract or long

Hard rules:
- SPECIFIC or nothing. Cite concrete topics and, where the pile shows them, real frequencies. A
  sentence that could describe anyone is a failure — cut it.
- Ground every claim in the observations. Invent nothing. If the evidence is thin on something,
  say less, don't pad.
- Second person, addressed to the assistant about "you"/"they" the person. Plain text, no markdown
  headings, under 250 words. Lead with what matters most.`;

const REPORT_PROMPT = `You are writing a short, honest note to a PERSON about their own pattern of
working with an AI coding assistant. The reader is that person — not their assistant.

Below is a stack of one-line observations, each from one real exchange of theirs, oldest first.
Each says whether understanding transferred and about what. Read the whole pile and tell them,
warmly and without flattery:
- where things clicked, and where you can see they got lost or felt stupid — name the moments/topics
- the pattern underneath it (is the block the tech, or is it meaning — "what does this mean for us")
- the trend over time, if the pile shows one

Hard rules:
- SPECIFIC or nothing — real topics, real moments, real frequencies where the pile shows them. No
  horoscope, no generic praise.
- Ground every claim in the observations. Invent nothing.
- Second person ("you"), plain and kind, no markdown headings, under 220 words.`;

/** The AI's copy — what loads into its context. Returns undefined if the read couldn't be done. */
export function synthesizeProfile(judgments: Judgment[], corpus: Corpus, bin: string): string | undefined {
  if (!judgments.length) return undefined;
  const input = `${PROFILE_PROMPT}\n\nCORPUS: ${ground(corpus)}\n\nOBSERVATIONS (oldest first):\n${pile(judgments)}`;
  return runClaude(bin, input);
}

/** The human's copy — what the person reads. Returns undefined if the read couldn't be done. */
export function synthesizeReport(judgments: Judgment[], corpus: Corpus, bin: string): string | undefined {
  if (!judgments.length) return undefined;
  const input = `${REPORT_PROMPT}\n\nCORPUS: ${ground(corpus)}\n\nOBSERVATIONS (oldest first):\n${pile(judgments)}`;
  return runClaude(bin, input);
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
