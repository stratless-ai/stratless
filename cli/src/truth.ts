/**
 * THE TRUTH TEST — the first instrument that asks whether a judgment is RIGHT about the person.
 *
 * Everything else in this codebase measures whether the machinery WORKS: fields populate, metrics
 * move, sentences change between arms. None of it has ever checked whether "stopped the assistant
 * from testing before understanding" is an accurate reading of what the person did. That question
 * has been deferred three times and the sample built for it was deleted unread. The miner is
 * blocked behind it — there is no sense redesigning a miner over evidence nobody has confirmed.
 *
 * WHY DISCRIMINATION AND NOT A SURVEY. Asking "is this right about you?" invites agreement: people
 * accept plausible descriptions of themselves. That is the horoscope failure, and we already guard
 * patterns against it while never once applying the guard to judgments. So this asks the person to
 * CHOOSE instead — their own words, three candidate sentences, one of which really happened. They
 * are never asked to agree with anything, and the result is a number with a known baseline: 33%.
 *
 * WHAT A SCORE MEANS (fixed before the first run, so it cannot be reinterpreted afterwards):
 *   · near 33%  — judgments are generic. They would fit any moment, everything downstream stands
 *                 on sand, and the miner is the wrong next problem.
 *   · high, few corrections — the judge is sound and the miner is genuinely the next rung.
 *   · high, many corrections — specific but MISCHARACTERISING. The most dangerous outcome, and
 *                 precisely the one a yes/no survey would have hidden.
 *
 * GRADE THE ACT, NOT THE DETAILS. Measured 2026-07-20: three readings of one exchange agree on what
 * the person did and diverge on the trailing specifics (median text similarity 0.16). Scoring the
 * details would measure the dice, not the judge.
 *
 * Zero model calls. The only cost is the person's attention, which is the scarcest thing here.
 */
import type { Judgment } from './judge.js';

/** How much of the person's own words to show. Enough to recognise the moment, not so much that
 *  reading the sheet becomes the expensive part. */
const WORDS_VIEW = 320;

/** The assistant's turn keeps its TAIL — the part that was reacted to (`exchange.ts`, measured). */
const SAID_VIEW = 420;

/** One question: the person's words, three candidate sentences, and which one is real. */
export interface TruthItem {
  hash: string;
  prompt: string;
  /** what the assistant said back — the same context the judge had, so the person can locate the
   *  moment. Without it a reaction like "go" is unplaceable and the question measures nothing. */
  said: string;
  reaction: string;
  /** shuffled — the true sentence is at `answer` */
  candidates: string[];
  /** index into `candidates`; never rendered into the sheet */
  answer: number;
  /** where the decoys came from, for auditing how hard the question was */
  distractorHashes: string[];
}

const flat = (s: string, cap = WORDS_VIEW): string => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length <= cap ? one : `${one.slice(0, cap)}…`;
};

/** The assistant's turn keeps its TAIL — the reaction answers the END of the turn, not its
 *  preamble (measured 2026-07-16, and the same rule `exchange.ts` and the judge's view both use). */
const tail = (s: string, cap: number): string => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length <= cap ? one : one.slice(-cap);
};

/**
 * Strip quoted spans from a candidate sentence.
 *
 * FOUND IN THE FIRST DRY RUN, and it would have invalidated the whole instrument: the judge quotes
 * the person verbatim in 44% of behaviors, so a candidate written about THIS moment repeats words
 * shown two lines above it as "You replied". The first three questions rendered were all solvable
 * by string matching — the sheet would have scored near 100% while measuring nothing.
 *
 * Applied to EVERY candidate, not just the true one. Masking only the leaky one would replace the
 * tell with its mirror image: "the sentence with the ellipsis is the answer."
 *
 * Stripping the quote also matches the grading intent — a quote is a detail, and detail is the part
 * that resamples between readings. The act is what is being judged.
 */
export function maskQuotes(s: string): string {
  return s
    .replace(/["“”][^"“”]{1,200}["“”]/g, '"…"')
    .replace(/'[^']{2,200}'/g, "'…'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A seeded PRNG so a sheet is reproducible and its scoring auditable.
 *
 * `Math.random()` would mean a rendered sheet could never be regenerated, so an answer key could
 * not be re-derived from the store and a disputed score could not be re-checked. mulberry32 over a
 * hash of the judgment id is enough: this shuffles three items, it is not cryptography.
 */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates under a seeded PRNG. Pure: returns a new array. */
export function shuffleDeterministic<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const rnd = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Two decoys for one target.
 *
 * SAME PROJECT, DIFFERENT SESSION, and that combination is the whole design:
 *  · same `at.project` — otherwise the subject matter gives the answer away and we would be
 *    measuring whether the person can spot which sentence mentions the right repository.
 *  · different session — judgments from the same conversation legitimately describe the same act,
 *    so a "wrong" answer could be genuinely right and the score would be meaningless.
 *
 * Falls back to widening the pool rather than returning too few: a question with one decoy has a
 * 50% baseline and would silently corrupt the arithmetic.
 */
export function distractorsFor(target: Judgment, pool: readonly Judgment[], n = 2): Judgment[] {
  const eligible = pool.filter((j) => j.hash !== target.hash && j.session !== target.session && j.behavior);
  const sameProject = eligible.filter((j) => j.at?.project && j.at.project === target.at?.project);
  const ordered = [...shuffleDeterministic(sameProject, `${target.hash}:near`), ...shuffleDeterministic(eligible, `${target.hash}:far`)];
  const picked: Judgment[] = [];
  const seen = new Set<string>();
  for (const j of ordered) {
    if (seen.has(j.hash)) continue;
    seen.add(j.hash);
    picked.push(j);
    if (picked.length === n) break;
  }
  return picked;
}

/** Build the question set. `exchangeOf` resolves a judgment back to the person's raw words; a
 *  judgment whose transcript is gone is skipped rather than guessed at. */
export function buildTruthSet(
  judgments: readonly Judgment[],
  exchangeOf: (hash: string) => { prompt: string; said: string; reaction: string } | undefined,
  opts: { n?: number; exclude?: ReadonlySet<string> } = {},
): TruthItem[] {
  const n = opts.n ?? 20;
  const usable = judgments.filter((j) => j.behavior && !opts.exclude?.has(j.hash) && exchangeOf(j.hash));
  // Even stride across the pile rather than the newest n — a profile built only from today would
  // be graded only on today, and recency is exactly what we are NOT trying to measure.
  const stride = Math.max(1, Math.floor(usable.length / n));
  const chosen = Array.from({ length: n }, (_, i) => usable[i * stride]).filter(Boolean);

  const items: TruthItem[] = [];
  for (const target of chosen) {
    const decoys = distractorsFor(target, usable);
    if (decoys.length < 2) continue; // a 2-way question has a different baseline — drop it
    const ex = exchangeOf(target.hash)!;
    const all = shuffleDeterministic([target, ...decoys], `${target.hash}:order`);
    items.push({
      hash: target.hash,
      prompt: flat(ex.prompt),
      said: tail(ex.said, SAID_VIEW),
      reaction: flat(ex.reaction),
      candidates: all.map((j) => maskQuotes(j.behavior)),
      answer: all.findIndex((j) => j.hash === target.hash),
      distractorHashes: decoys.map((j) => j.hash),
    });
  }
  return items;
}

const LETTERS = 'ABC';

/**
 * The sheet the person fills in. Deliberately plain markdown: no scores, no hints, and NOTHING
 * that identifies the real sentence — not order, not length, not a marker. The answer key lives
 * only in the returned items.
 */
export function renderSheet(items: readonly TruthItem[]): string {
  const out: string[] = [
    '# Which sentence describes what you did?',
    '',
    'Your own words are quoted. One of the three sentences was written about THIS moment; the other',
    'two were written about different moments. Pick the one that describes this one.',
    '',
    'Answer with a letter. If none of them fit, write `-`. Guessing is fine and expected.',
    '',
    '---',
    '',
  ];
  items.forEach((it, i) => {
    out.push(`## ${i + 1}`);
    out.push('');
    out.push(`**You asked:** ${it.prompt}`);
    out.push('');
    out.push(`**Claude answered:** …${it.said}`);
    out.push('');
    out.push(`**You replied:** ${it.reaction}`);
    out.push('');
    it.candidates.forEach((c, k) => out.push(`- **${LETTERS[k]}.** ${c}`));
    out.push('');
    out.push('**Answer:** ');
    out.push('');
  });
  return out.join('\n');
}

/** One question as it appears in the fillable JSON — the answer key is NOT in this shape. */
export interface SheetQuestion {
  n: number;
  asked: string;
  claudeAnswered: string;
  youReplied: string;
  A: string;
  B: string;
  C: string;
  /** the person writes "A" | "B" | "C" | "-" here */
  answer: string;
}

/**
 * The same sheet as fillable JSON.
 *
 * Same discipline as `renderSheet`: no hash, no key, nothing correlated with which candidate is
 * real. `answer` ships EMPTY — a pre-filled field would be an invitation to agree, which is the
 * exact bias this instrument exists to avoid.
 */
export function renderSheetJson(items: readonly TruthItem[]): string {
  const questions: SheetQuestion[] = items.map((it, i) => ({
    n: i + 1,
    asked: it.prompt,
    claudeAnswered: it.said,
    youReplied: it.reaction,
    A: it.candidates[0],
    B: it.candidates[1],
    C: it.candidates[2],
    answer: '',
  }));
  return `${JSON.stringify(
    {
      instructions:
        'One of A/B/C was written about this exact moment; the other two were written about different moments. Put A, B, or C in "answer". Use "-" if none of them fit. Guessing is expected.',
      chance: '33% — the score has to beat this to mean anything',
      questions,
    },
    null,
    2,
  )}\n`;
}

export interface TruthScore {
  n: number;
  correct: number;
  /** answered '-' — none of the three fitted. Counted apart from wrong: it is a different failure */
  none: number;
  answered: number;
  accuracy: number;
  /** 1/candidates — the baseline this must beat to mean anything */
  chance: number;
  perItem: { n: number; picked: string; correct: boolean; behavior: string }[];
}

/**
 * Score a filled sheet. `answers` is one entry per item: 'A' | 'B' | 'C' | '-' (or '' for skipped).
 *
 * A '-' is tallied separately and EXCLUDED from accuracy. "None of these describe me" is not the
 * same failure as picking the wrong one: the first says the judge mischaracterised the moment, the
 * second says the sentence was not specific to it. Folding them together would hide the difference
 * that matters most.
 */
export function scoreSheet(items: readonly TruthItem[], answers: readonly string[]): TruthScore {
  const perItem: TruthScore['perItem'] = [];
  let correct = 0;
  let none = 0;
  let answered = 0;
  items.forEach((it, i) => {
    const raw = (answers[i] ?? '').trim().toUpperCase();
    if (raw === '-') {
      none++;
      perItem.push({ n: i + 1, picked: '-', correct: false, behavior: it.candidates[it.answer] });
      return;
    }
    const k = LETTERS.indexOf(raw);
    if (k < 0) {
      perItem.push({ n: i + 1, picked: '', correct: false, behavior: it.candidates[it.answer] });
      return; // unanswered
    }
    answered++;
    const ok = k === it.answer;
    if (ok) correct++;
    perItem.push({ n: i + 1, picked: raw, correct: ok, behavior: it.candidates[it.answer] });
  });
  return {
    n: items.length,
    correct,
    none,
    answered,
    accuracy: answered ? correct / answered : 0,
    chance: items.length ? 1 / items[0].candidates.length : 0,
    perItem,
  };
}
