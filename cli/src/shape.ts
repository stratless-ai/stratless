/**
 * SHAPE — what gets embedded. The stage that decides whether clustering groups a person by WHAT THEY
 * DO or by WHAT THEY TALK ABOUT.
 *
 * THE PROBLEM IT SOLVES. Clustering raw replies groups by subject, because a reply about a subject
 * carries more subject words than act words and the subject outvotes the act. Measured on the real
 * pile (2026-07-26): the person's two most frequent behaviours — thinking out loud about direction
 * (882 instances) and floating their own read to check it (743) — dissolved into "talks about
 * $PROJECT", were correctly scoped `project`, and were dropped from the profile entirely. **The
 * engine could see them only when they were terse, and went blind exactly when they were thinking.**
 *
 * THE FIX. Keep the words this person uses most; drop the rest. What survives is grammar and their
 * own habitual verbs — how they talk. What goes is the vocabulary of whatever they happened to be
 * building.
 *
 *     "im thinking about whether $PROJECT positioning holds"  ->  "im thinking about whether holds"
 *     "im thinking about whether the pricing model works"     ->  "im thinking about whether the works"
 *
 * Two sentences about different things, revealed as the same move.
 *
 *   | representation      | subject-trapped moments | pile tightness |
 *   | reply as-is         | 11%                     | 0.775          |
 *   | shaped              | 2%                      | 0.844          |
 *
 * Both axes improve at once — piles get TIGHTER while becoming LESS subject-bound.
 *
 * WHY IT DOES NOT BREAK THE EMBEDDING. The model is untouched; only its input changes. Fragments are
 * closer to its native diet than they look — BERT-family models are pretrained by masking words and
 * predicting them, so incomplete text is the training objective, not an attack. And the transform is
 * applied identically to every moment, so it cannot bias moments RELATIVE to each other; it can only
 * strip a dimension they shared. That dimension was the subject.
 *
 * The project's own name survives the cut and is harmless: a word present in ~9% of everything,
 * spread evenly across every topic, shifts every fingerprint the same way and therefore separates
 * nothing. The words that actually build subject piles are the mid-frequency specific ones, and they
 * all fall below.
 *
 * ⚠️ KNOWN DEBT — N IS A COUNT, NOT A RATIO. 220 words out of a 500-word vocabulary is *everything*;
 * out of 8,562 it is a tight cut. Same number, opposite meaning, so it does NOT mean the same thing
 * at every corpus size — which breaks the rule that the method must not be tuned to how much data
 * there is. The measured scale-free replacement is CONVERSATION SPREAD ("keep words appearing in
 * >=X% of their conversations"), which separates cleanly — `build` 40% and `commit` 51% against
 * `firecrawl` 15%, `schema` 15%, `positioning` 11% — and means the same thing on six conversations
 * as on six hundred. Shipped as N first because N is the configuration that was proven end to end.
 *
 * NO MODEL CALLS. Everything here is arithmetic over the person's own words. Cost is zero.
 */
import type { Moment } from './moments.js';

/** How many of the person's most-used words survive. See the debt note in the header. */
export const KEEP_WORDS = 220;

/** Words only. Keeps dotted/underscored identifiers whole (`classify.ts`) so they count once, not
 *  as fragments — they are exactly the rare vocabulary the cut is meant to remove. */
const WORD = /[a-zA-Z][a-zA-Z0-9_.-]{1,}/g;

const tokens = (s: string): string[] => s.toLowerCase().match(WORD) ?? [];

/**
 * How many MOMENTS each word appears in — presence per moment, not total occurrences. A word repeated
 * five times in one long reply is one moment's worth of evidence, not five; counting raw occurrences
 * would let a single verbose message promote its own vocabulary.
 */
export function wordFrequency(moments: Moment[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const m of moments) {
    for (const t of new Set(tokens(m.reply))) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return df;
}

/** The surviving vocabulary: the `keep` most frequent words in this person's own replies. */
export function vocabulary(moments: Moment[], keep: number = KEEP_WORDS): Set<string> {
  return new Set(
    [...wordFrequency(moments).entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) // name-tiebreak so ties are deterministic
      .slice(0, keep)
      .map(([w]) => w),
  );
}

/**
 * One moment's text as the clusterer sees it. Punctuation and word order are preserved — only
 * out-of-vocabulary words are removed — so the sentence's shape survives even as its subject leaves.
 *
 * A reply that empties completely (a moment made entirely of rare words) falls back to its original
 * text: an empty string carries no signal at all, and the original at least carries something. This
 * fires on ~0.5% of a real pile.
 */
export function shapeOf(reply: string, vocab: Set<string>): string {
  const out = reply.replace(WORD, (w) => (vocab.has(w.toLowerCase()) ? w : '')).replace(/\s+/g, ' ').trim();
  return out || reply;
}
