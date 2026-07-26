/**
 * SHORTHAND — the decode key. The person's recurring opening phrases, per behaviour, extracted by
 * pure code from the moments they already carry. This is the one part of the profile the assistant
 * uses LIVE — to recognise which move the person is making in the moment — not in retrospect.
 *
 * Validated on the real archive (2026-07-21): distinctive phrases like "double check" (lift 17.7)
 * and "make a plan" (lift 20.6) surface cleanly, while generics ("i think", lift 1.1) filter out.
 * No model, no store — derived at build time from the labelled pile, exactly like the quotes.
 */
import { hostname, userInfo } from 'node:os';

import type { Labelled } from './count.js';
import type { Category } from './categories.js';

/** Recurs this often, across this many DIFFERENT conversations, to count — the design floor. */
const MIN_COUNT = 3;
const MIN_CONVS = 3;
/** How much more common in a category than the corpus before a phrase is "distinctive" — raised from
 *  4 after the first real run leaked conversational filler ("i feel", "so we") at the low end. */
const MIN_LIFT = 5;
/** At most this many phrases per behaviour, and this many behaviours in the whole key — a cheat
 *  sheet, not a phone book (the first cut shipped 23 lines and squeezed the detail out). */
const MAX_PHRASES = 2;
const MAX_ENTRIES = 10;

/** Openings made ONLY of these carry no behaviour ("ok so", "so we", "but i") — dropped however
 *  distinctive, because a decode key of filler decodes nothing. */
const STOPWORDS = new Set([
  'ok', 'so', 'i', 'we', 'the', 'a', 'an', 'to', 'is', 'it', 'this', 'that', 'of', 'for', 'and', 'or',
  'but', 'im', 'now', 'yes', 'no', 'good', 'well', 'oh', 'my', 'do', 'us', 'you', 'can', 'be', 'are',
  'just', 'also', 'then', 'thats', 'its', 'ive', 'lets', 'let', 'still', 'if', 'in', 'on', 'at',
]);

/** The structural signature for a numbered-list opening — a shape, not a phrase. */
export const NUMBERED = 'a numbered reply (1. … 2. …)';

export interface Signature {
  name: string;
  phrases: string[];
  /** category size — the decode key is ordered by this (most-used shorthand first) */
  count: number;
}

/** Normalise a reply to comparable words: lowercase, punctuation to spaces, collapsed. */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();

/** Candidate phrases from one reply: the 2/3/4-word opening, the whole reply when short, and a
 *  structural marker when it opens with a numbered list. */
export function phrasesOf(reply: string): string[] {
  const out = new Set<string>();
  if (/^\s*\d+[.)]/.test(reply)) out.add(NUMBERED);
  const w = norm(reply).split(' ').filter(Boolean);
  for (const n of [2, 3, 4]) if (w.length >= n) out.add(w.slice(0, n).join(' '));
  if (w.length >= 1 && w.length <= 5) out.add(w.join(' '));
  return [...out];
}

/** Drop a phrase when a shorter KEPT phrase is its prefix — keep the canonical short form
 *  ("double check", not "double check on the"). Input must be sorted shortest-first. */
function dedupNested(sorted: string[]): string[] {
  const kept: string[] = [];
  for (const p of sorted) {
    if (p === NUMBERED) {
      kept.push(p);
    } else if (!kept.some((k) => k !== NUMBERED && p.startsWith(`${k} `))) {
      kept.push(p);
    }
  }
  return kept;
}

function lift(phrase: string, inCat: number, members: number, corpus: Map<string, number>, N: number): number {
  const corp = corpus.get(phrase) ?? 0;
  return corp ? inCat / members / (corp / N) : 999;
}

/** A phrase made entirely of stopwords carries no signal, however distinctive its count. */
function allStop(phrase: string): boolean {
  return phrase !== NUMBERED && phrase.split(' ').every((w) => STOPWORDS.has(w));
}

/**
 * A phrase that is really the MACHINE talking, not the person. Pasted terminal output carries the
 * shell prompt line ("jxs-MacBook-Air web % …") often enough that its fragments clear every
 * statistical bar and land in the decode key as if they were speech — the first real build shipped
 * `"jxs macbook" → wants space to reason toward pivot`, and after a containment-only filter the
 * phrase simply grew the prompt's cwd ("jxs macbook air web") and escaped (both 2026-07-26). Two
 * rules, both local and generic — this machine's names, nobody else's:
 *   · the phrase sits inside the hostname+username word string (a pure fragment), or
 *   · its FIRST word is the hostname's lead token or the username — the shell prompt starts with
 *     them, so an extracted opening that starts there is a paste, whatever trails behind it.
 */
export interface MachineNames {
  text: string;
  leads: Set<string>;
}
export function isMachineArtifact(phrase: string, m: MachineNames = MACHINE): boolean {
  if (phrase === NUMBERED) return false;
  if (m.text.includes(` ${phrase} `)) return true;
  return m.leads.has(phrase.split(' ')[0]);
}
const MACHINE: MachineNames = ((): MachineNames => {
  let user = '';
  try {
    user = userInfo().username;
  } catch {
    /* some sandboxes have no user info — the hostname alone still covers the pasted prompt line */
  }
  const host = norm(hostname());
  const leads = new Set([host.split(' ')[0], norm(user)].filter(Boolean));
  return { text: ` ${norm(`${hostname()} ${user}`)} `, leads };
})();

/** A handle must not END on a dangling article/preposition ("make a", "i was thinking per") — its
 *  content-bearing extension ("make a plan") reads far better and survives in its place. */
const DANGLING = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'and', 'or', 'with', 'per', 'at']);
function endsDangling(phrase: string): boolean {
  if (phrase === NUMBERED) return false;
  const w = phrase.split(' ');
  return DANGLING.has(w[w.length - 1]);
}

/** The decode key: per person-scoped category, its distinctive recurring opening phrases. Pure. */
export function signatures(labelled: Labelled[], categories: Category[]): Signature[] {
  const person = new Set(categories.filter((c) => c.scope !== 'project').map((c) => c.name));

  const corpus = new Map<string, number>();
  for (const l of labelled) for (const p of phrasesOf(l.moment.reply)) corpus.set(p, (corpus.get(p) ?? 0) + 1);
  const N = labelled.length || 1;

  // Per category, its qualifying phrases each with its lift in THAT category.
  const perCat = new Map<string, { size: number; cands: { phrase: string; lift: number }[] }>();
  for (const name of person) {
    const members = labelled.filter((l) => l.kinds.includes(name));
    if (!members.length) continue;

    const count = new Map<string, number>();
    const convs = new Map<string, Set<string>>();
    for (const l of members)
      for (const p of phrasesOf(l.moment.reply)) {
        count.set(p, (count.get(p) ?? 0) + 1);
        if (!convs.has(p)) convs.set(p, new Set());
        convs.get(p)!.add(l.moment.session);
      }

    const qualifying = [...count.entries()]
      .filter(([p, c]) => c >= MIN_COUNT && (convs.get(p)?.size ?? 0) >= MIN_CONVS && !allStop(p) && !endsDangling(p) && !isMachineArtifact(p) && lift(p, c, members.length, corpus, N) >= MIN_LIFT)
      .sort((a, b) => a[0].length - b[0].length) // shortest first, so dedup keeps the canonical form
      .map(([p]) => p);
    const deduped = dedupNested(qualifying);
    if (deduped.length) {
      perCat.set(name, { size: members.length, cands: deduped.map((p) => ({ phrase: p, lift: lift(p, count.get(p)!, members.length, corpus, N) })) });
    }
  }

  // Cross-category dedup: a phrase belongs to whichever category uses it most distinctively, so no
  // single phrase ends up decoding to two different things.
  const owner = new Map<string, { name: string; lift: number }>();
  for (const [name, { cands }] of perCat)
    for (const { phrase, lift: lf } of cands) {
      const cur = owner.get(phrase);
      if (!cur || lf > cur.lift) owner.set(phrase, { name, lift: lf });
    }

  const out: Signature[] = [];
  for (const [name, { size, cands }] of perCat) {
    const owned = cands.filter(({ phrase }) => owner.get(phrase)?.name === name);
    // prefer the clean structural marker over its literal variants ("a numbered reply" over "1 go")
    owned.sort((a, b) => Number(b.phrase === NUMBERED) - Number(a.phrase === NUMBERED) || b.lift - a.lift);
    const phrases = owned.slice(0, MAX_PHRASES).map((x) => x.phrase);
    if (phrases.length) out.push({ name, phrases, count: size });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, MAX_ENTRIES);
}
