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
import type { Pattern } from './miner.js';

/**
 * The synthesis model. Reading the shape of a person is subtle work, so it does not ride the tiny
 * judge model — but 0.2.4 measured what "run on the user's default" really means: a frontier default
 * spent $0.62 per synthesis (~5k thinking tokens at frontier rates for a 250-word profile), about 32
 * judge calls' worth and ~80% of all spend. Sonnet with thinking reads just as deliberately at
 * ~$0.10–0.15. Pinned, so the cost is predictable and publishable (token-economics §5);
 * STRATLESS_SYNTH_MODEL overrides it for anyone who wants their default back. An unrecognised alias
 * is safe — runClaude falls back to the default model rather than failing.
 */
const synthModel = (): string => process.env.STRATLESS_SYNTH_MODEL || 'sonnet';

/**
 * Judgments that carry signal. A `none` verdict is, by the judge's own definition, a reaction that
 * says nothing about understanding (pure logistics, a thank-you) — so it never reaches the writer.
 * It stays cached forever like everything else: filtered at synthesis time, never re-judged.
 * (v2: read from the structured field, not the rendered line. The `none` pile is not waste — it is
 * exactly where the miner will hunt how-they-work and trigger patterns, and where Law 3 evidence
 * accumulates.)
 */
export function hasSignal(j: Judgment): boolean {
  return j.verdict !== 'none';
}

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

/**
 * The newest N judgments, newest first — BY TIMESTAMP, never by trusting the caller's order (C10).
 * Phase 0's B2: the pattern-era writer took `signal.slice(-25)` from a newest-first list — the
 * OLDEST 25, labelled "MOST RECENT" — so every profile since 0.3.1 had its current-direction
 * evidence backwards. Sorting here makes the block correct no matter what order a future caller
 * passes. Pinned by test; exported for it.
 */
export function mostRecent(judgments: Judgment[], n: number): Judgment[] {
  return [...judgments].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, n);
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

/**
 * Render the pattern sheet the writer reasons from — the ONLY place its numbers may come from.
 * One line per pattern: kind, count, window, trend, stability, confidence, audit tally, statement.
 * Exported for tests (the numbers-lint's allowed set is literally "numerals shown to the model").
 */
export function renderPatternSheet(patterns: Pattern[]): string {
  return patterns
    .map((p) => {
      const audit = p.audit ? ` · audited ${p.audit.kept}/${p.audit.kept + p.audit.evicted}` : '';
      const flagged = p.flagged ? ' · CONTRADICTED (hold very lightly)' : '';
      return `[${p.kind} · ${p.count}x · ${p.window.from} → ${p.window.to} · ${p.trend} · ${p.stability} · ${p.confidence}${audit}${flagged}] ${p.statement}`;
    })
    .join('\n');
}

/**
 * The grader's recent misses, rendered for the REPORT only (Sun's rule: HUMAN.md carries no
 * receipts, no bookkeeping — the AI reads current truth, the human reads the diary). Exported for
 * tests.
 */
export function renderSurprises(patterns: Pattern[], now: Date, windowDays = 14): string {
  const cutoff = now.getTime() - windowDays * 86_400_000;
  const items: string[] = [];
  for (const p of patterns) {
    for (const s of p.record?.surprises ?? []) {
      if (new Date(s.at).getTime() >= cutoff) {
        items.push(`- claimed: "${p.statement}" · contradicted ${s.at.slice(0, 10)}${p.flagged ? ' · now under revision' : ''}`);
      }
    }
  }
  return items.join('\n');
}

/**
 * THE NUMBERS-LINT (promise layer): every numeral in the writer's output must already exist in the
 * input it was shown. No new numbers means no invented counts, no rounded frequencies, no
 * hallucinated dates — a wrong frequency is a lie wearing precision, and this makes it a build
 * failure instead. Pure; exported for tests.
 */
export function inventedNumbers(output: string, input: string): string[] {
  const numerals = (s: string) => new Set(s.match(/\d+/g) ?? []);
  const allowed = numerals(input);
  return [...numerals(output)].filter((n) => !allowed.has(n));
}

const PATTERNS_PROFILE_PROMPT = `You are writing the file an AI coding assistant loads at the start
of every session so it knows WHO IT IS TALKING TO. The reader is the assistant, not the person.

Your evidence comes in two blocks:
A — MINED PATTERNS: named regularities about this person. Each carries a real count, a time window,
a trend (rising/steady/fading), a stability class and a confidence, audited against the underlying
exchanges. These are the claims to reason FROM: lean hardest on bedrock and strong patterns; treat
volatile or thin ones lightly.
B — MOST RECENT raw observations: their current focus. If B contradicts an older pattern, the
person changed — describe NOW, never the historical average.

Write a model of a human to reason FROM — never a list of rules ("do X, don't do Y"), which this
person rejects as more paper.

TIME IS PART OF EVERY CLAIM: narrate trend and window where they matter ("has held for two months,
lean on it", "faded through July: who they WERE", "new this week, hold it lightly"). If a pattern is
time-conditioned (mornings vs late nights), describe the MODES and their tells — never predict which
mode is active; the assistant reading this will read the room.

FORMAT — sections with EXACTLY these headings, in this order, KEEPING ONLY sections with real
evidence (omit empty ones; never pad):
WHAT THEY KNOW
HOW THEY THINK
HOW THEY WORK
DIRECTION
FAILURE SIGNALS
TRIGGERS
Each pattern's [kind] tag names its home section (know/think/work/direction/failure-signals/
triggers; unsorted goes where it fits best or stays out). Headings in ALL CAPS on their own line,
plain prose beneath, no other markdown.

Hard rules:
- SPECIFIC or nothing. A sentence that could describe anyone is a failure, so cut it.
- THE METADATA IS FOR WEIGHING, NEVER FOR QUOTING. The bracketed tags on each pattern (counts,
  windows, trend, stability, confidence, audit) tell you what to say and how firmly — they never
  appear in your text. No "12x", no "audited 5/5", no "rising/fading/bedrock/thin". Express weight
  as calibrated language: "reliably", "consistently this month", "early signs of", "this has
  softened lately". A pattern marked CONTRADICTED is barely worth a hedge, or nothing.
- Real frequencies of the PERSON'S OWN behavior may be narrated as facts ("caught you nine times in
  one day") when the number itself tells the assistant something. Numbers only as they appear in
  your evidence; never compute, round, or invent one.
- Ground every claim in the evidence. Invent nothing. Thin evidence means say less, don't pad.
- Never use an em dash or en dash (— or –). Use a comma, a colon, a period, or parentheses instead.
- Second person, addressed to the assistant about the person. Under 350 words total. Lead each
  section with what matters most.
- Output the document text ONLY, starting with its first heading. No preamble, no commentary, no
  word counts, nothing about this task — the output IS the file.`;

const PATTERNS_REPORT_PROMPT = `You are writing a short, honest note to a PERSON about their own
pattern of working with an AI coding assistant. The reader is that person — not their assistant.

Your evidence: A — MINED PATTERNS (each with a real count, time window, trend, stability, audited
against real exchanges); B — their MOST RECENT raw observations.

Tell them, warmly and without flattery:
- where things click and where they get lost — real topics, real moments
- the pattern underneath (is the block the tech, or meaning?)
- the TRAJECTORY — the heart of this note, the thing only time can show: what stopped ("you used to
  bounce on X; it faded in July"), what holds ("Y has held for two months"), what is new this week
- if a pattern is time-conditioned (mornings vs late nights), name it kindly as a mode
- if block C (SURPRISES) is present: these are claims this file made about them that new evidence
  CONTRADICTED. Narrate honestly, never as apology — and SCALE the language to the weight: a single
  counter-example means "took its first exception this week, still holds" (light, one clause); only
  a claim marked "now under revision" gets the full "this file thought X; it's revising" treatment.
  Self-correction is the point, not a drama.

Hard rules:
- SPECIFIC or nothing: real topics, real frequencies. No horoscope, no generic praise.
- NUMBERS: only as they appear in the evidence. Never compute, round, or invent one.
- Ground every claim in the evidence. Invent nothing.
- Never use an em dash or en dash (— or –). Use a comma, a colon, a period, or parentheses instead.
- Second person ("you"), plain and kind, no headings, under 220 words.
- Output the note text ONLY. No preamble, no commentary, nothing about this task.`;

/** Shared assembly for the two pattern-grounded renderings — one evidence block, two audiences. */
function synthesizeFromPatterns(
  prompt: string,
  patterns: Pattern[],
  recent: Judgment[],
  corpus: Corpus,
  bin: string,
  extraBlock?: string,
): { text?: string; invented?: string[] } {
  if (!patterns.length && !recent.length) return {};
  const input = [
    prompt,
    '',
    `CORPUS: ${ground(corpus)}`,
    '',
    'A — MINED PATTERNS (audited, counted, dated):',
    patterns.length ? renderPatternSheet(patterns) : '(none admitted yet — reason from block B only, and say less)',
    '',
    'B — MOST RECENT raw observations:',
    recent.length ? recent.map((j) => j.line).join('\n') : '(none)',
    ...(extraBlock ? ['', extraBlock] : []),
  ].join('\n');
  const out = runClaude(bin, input, synthModel(), 'synthesis');
  if (!out) return {};
  const text = deDash(stripPreamble(out));
  const invented = inventedNumbers(text, input);
  if (invented.length) return { invented }; // the promise layer: refuse, don't lie
  return { text };
}

/**
 * Strip a leading line of task meta-chatter ("Good, exactly 350. Here's the profile:") — caught
 * live in the polish dogfood, where it reached the saved artifact. The numbers-lint could not
 * catch it: the numeral came from the prompt itself. Narrow on purpose: only ONE leading line,
 * only when it reads as the model addressing its task. The prompt also forbids it; this is the
 * promise. Exported for tests.
 */
export function stripPreamble(s: string): string {
  const lines = s.split('\n');
  if (lines.length > 1 && /^(good|sure|okay|ok|here|certainly|alright|done)\b.*:\s*$/i.test(lines[0].trim())) {
    return lines.slice(1).join('\n').replace(/^\s+/, '');
  }
  return s;
}

/**
 * The AI's copy, reasoned FROM the mined patterns — the writer as spokesperson: it may only weaken
 * claims, never mint them. 0.3.1: sectioned (the six kinds as headings — the protocol made visible,
 * ≤350 words) and time-narrating. Input stays flat no matter how large the judgment pile grows.
 * Returns the text, or the invented numerals if the lint refused the build (silence over a
 * precise-looking lie).
 */
export function synthesizeProfileFromPatterns(
  patterns: Pattern[],
  recent: Judgment[],
  corpus: Corpus,
  bin: string,
): { text?: string; invented?: string[] } {
  return synthesizeFromPatterns(PATTERNS_PROFILE_PROMPT, patterns, recent, corpus, bin);
}

/**
 * The human's copy, reasoned FROM the patterns (0.3.1) — the mirror finally gets the trajectory:
 * what stopped, what holds, what is new. Same evidence, same lint, kinder register.
 */
export function synthesizeReportFromPatterns(
  patterns: Pattern[],
  recent: Judgment[],
  corpus: Corpus,
  bin: string,
): { text?: string; invented?: string[] } {
  const surprises = renderSurprises(patterns, new Date());
  const extra = surprises ? `C — SURPRISES (claims this file recently got wrong):\n${surprises}` : undefined;
  return synthesizeFromPatterns(PATTERNS_REPORT_PROMPT, patterns, recent, corpus, bin, extra);
}

/** The AI's copy — what loads into its context. Returns undefined if the read couldn't be done. */
export function synthesizeProfile(judgments: Judgment[], corpus: Corpus, bin: string): string | undefined {
  if (!judgments.length) return undefined;
  const input = `${PROFILE_PROMPT}\n\nCORPUS: ${ground(corpus)}\n\n${recencyBlocks(judgments)}`;
  const out = runClaude(bin, input, synthModel(), 'synthesis');
  return out ? deDash(out) : undefined;
}

/** The human's copy — what the person reads. Returns undefined if the read couldn't be done. */
export function synthesizeReport(judgments: Judgment[], corpus: Corpus, bin: string): string | undefined {
  if (!judgments.length) return undefined;
  const input = `${REPORT_PROMPT}\n\nCORPUS: ${ground(corpus)}\n\n${recencyBlocks(judgments)}`;
  const out = runClaude(bin, input, synthModel(), 'synthesis');
  return out ? deDash(out) : undefined;
}

/** The pile's own centre of gravity — the topics that come up most, for grounding + `stats`.
 *  (v2: reads the structured topic field — no more parsing the rendered line by its separator.) */
export function topTopics(judgments: Judgment[], n = 8): string[] {
  const counts = new Map<string, number>();
  for (const j of judgments) {
    const topic = j.topic?.trim().toLowerCase();
    if (!topic) continue;
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}
