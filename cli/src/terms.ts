/**
 * TERMS — the topic channel's collect-time half. What subject an assistant answer was about, as
 * candidate terms, extracted mechanically while the full text still exists (exchange.ts holds the
 * whole answer for one moment; the caps then keep 800 head + 8000 tail, and the card 300 + 300).
 *
 * CANDIDATES, NOT TOPICS — the load-bearing decision:
 *
 *   · The card stores a PURE FUNCTION OF THE ANSWER TEXT ALONE. Rarity is corpus-relative, and a
 *     card scored against "the corpus as of today" would depend on when it was written — a rebuild
 *     and an append would produce different cards from the same archive. Candidates keep the store's
 *     own doctrine (same exchange → same card, forever); which candidates are RARE, and whether they
 *     thread across sessions, is decided downstream against the whole pile (topics.ts), where the
 *     answer is re-derivable and deterministic.
 *
 *   · THE 99.5% GHOST, argued past: the v2 judge had a `topic` field and it was cut — a model's
 *     free-text label per moment, 99.5% unique, grouped nothing (exchange.ts keeps the tombstone).
 *     These are not labels. They are the answer's own surface tokens, verbatim; identity across
 *     sessions is literal string equality, and threading on exactly this was measured working
 *     before it was built (Phase 0b, 2026-07-28: 16 self-naming threads on the reference archive).
 *
 *   · CONTAINMENT: these terms are subject vocabulary — the exact dimension shape.ts exists to
 *     REMOVE from clustering. They must never reach `shapeOf`/`vocabulary` input; the engine reads
 *     `m.reply` only, and the byte-identical-stamp test pins that it stays that way.
 *
 * Every filter here is language- or machine-mechanical, never person-calibrated — the same list for
 * every person, with the person-relative work (rarity against THEIR corpus) done downstream. That is
 * the profile-agnostic constraint: nothing in this file encodes what any one person talks about.
 *
 * A LEAF MODULE ON PURPOSE: exchange.ts imports it, and everything imports exchange.ts eventually —
 * a project import here would close the cycle. node:os only.
 *
 * NO MODEL CALLS. Pure arithmetic. Cost is zero.
 */
import { hostname, userInfo } from 'node:os';

/** How many candidate terms a card keeps — enough for every thread the answer could seed (~250B a
 *  card, ~1.5MB on the reference pile). MEASURE-THEN-LOCK: the 16 known threads' terms must survive
 *  this cap on the real archive before it is final; raise to 32 if recall misses. */
export const TERMS_CAP = 24;

/** Words only, three characters up, dotted/hyphenated identifiers kept whole (`wrangler.toml`,
 *  `cache-economics`) — the same shape as shape.ts's WORD, one character stricter because a topic
 *  term under three characters does not exist. */
const WORD = /[a-zA-Z][a-zA-Z0-9_.-]{2,}/g;

/** A token longer than this is a paste artifact (a base64 run, a data URI), not a term. Identifiers
 *  and hostnames measure well under it. */
const MAX_TERM = 40;

/**
 * English function words, three-plus characters (the tokenizer already drops shorter). Mechanical
 * only — auxiliaries, pronouns, determiners, prepositions, and the handful of verbs generic enough
 * to appear in any answer about anything. Domain-generic words ("file", "code") are deliberately NOT
 * here: what counts as background vocabulary differs per person, and the downstream rarity band
 * (document frequency against THEIR corpus) is the honest filter for it.
 */
const FUNCTION_WORDS = new Set([
  'the', 'and', 'but', 'nor', 'not', 'you', 'your', 'yours', 'our', 'ours', 'their', 'theirs',
  'its', 'his', 'her', 'hers', 'this', 'that', 'these', 'those', 'they', 'them', 'then', 'than',
  'there', 'here', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'whose', 'why', 'how',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'others', 'some', 'such', 'only',
  'own', 'same', 'very', 'can', 'cannot', 'could', 'did', 'does', 'done', 'doing', 'has', 'have',
  'had', 'having', 'was', 'were', 'been', 'being', 'are', 'will', 'would', 'should', 'may', 'might',
  'must', 'shall', 'into', 'onto', 'over', 'under', 'between', 'through', 'during', 'before',
  'after', 'above', 'below', 'from', 'with', 'without', 'within', 'about', 'against', 'again',
  'further', 'once', 'out', 'off', 'now', 'just', 'also', 'too', 'one', 'two', 'first', 'second',
  'next', 'last', 'new', 'still', 'yet', 'per', 'via', 'use', 'using', 'used', 'uses', 'get',
  'gets', 'got', 'make', 'makes', 'made', 'let', 'lets', 'see', 'want', 'wants', 'need', 'needs',
  'way', 'ways', 'well', 'like', 'back', 'because', 'instead', 'rather', 'already', 'itself',
  'yourself', 'themselves', 'something', 'anything', 'everything', 'nothing',
]);

/**
 * This machine's own names — the per-token form of shorthand.ts's machine-artifact rule. Pasted
 * terminal output carries the shell prompt ("jxs-MacBook-Air web % …") often enough that hostname
 * and username fragments would clear every downstream bar and thread as if they were subjects.
 * Local and generic: this machine's names, nobody else's.
 */
function machineTokens(): Set<string> {
  let user = '';
  try {
    user = userInfo().username;
  } catch {
    /* some sandboxes have no user info — the hostname alone still covers the pasted prompt line */
  }
  const out = new Set<string>();
  for (const raw of [hostname(), user]) {
    for (const t of raw.toLowerCase().match(WORD) ?? []) out.add(t);
  }
  return out;
}
const MACHINE = machineTokens();

/**
 * The candidate terms of one answer: distinct surviving tokens ranked by in-answer count (desc),
 * then first appearance (asc — an answer leads with its subject), then name (a deterministic
 * tiebreak, same discipline as shape.ts's vocabulary). No occurrence floor: with count-first
 * ranking the cap admits repeated terms in long answers and single mentions in short ones, which
 * is the adaptive behaviour a fixed floor would break.
 */
export function termsOf(text: string, cap: number = TERMS_CAP, machine: Set<string> = MACHINE): string[] {
  const seen = new Map<string, { n: number; first: number }>();
  let i = 0;
  for (const m of text.match(WORD) ?? []) {
    i++;
    // A sentence-final "deploy." tokenizes with its period — trim trailing punctuation so the term
    // matches its mid-sentence self (identity downstream is literal string equality).
    const t = m.toLowerCase().replace(/[._-]+$/, '');
    if (t.length < 3 || t.length > MAX_TERM) continue;
    if (FUNCTION_WORDS.has(t) || machine.has(t)) continue;
    const cur = seen.get(t);
    if (cur) cur.n++;
    else seen.set(t, { n: 1, first: i });
  }
  return [...seen.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first || a[0].localeCompare(b[0]))
    .slice(0, cap)
    .map(([t]) => t);
}
