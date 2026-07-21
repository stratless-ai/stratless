/**
 * COUNT — the adder-upper. Pure arithmetic over the checkmarks; no model, no cost.
 *
 * This is what v1 paid a model to do (mine → audit → grade, $24 and 84% of its evidence lost).
 * Once the labels exist, everything the profile needs is counting:
 *
 *   · lift      — how much more a behaviour fires when something went wrong (distress vs ordinary).
 *                 THE cut that splits the file: above 2.0 is a distress signal, below is how they work.
 *   · direction — rising or fading, read ONLY from the moments a category actually carries (frozen-once
 *                 guarantees those never predate its birth, so there is no birth-boundary to police).
 *   · misfit    — the share of recent moments that matched nothing. Stage 3's re-discovery trigger.
 *   · scoreboard— the one number the person sees: how much of what they typed was correcting the AI.
 *
 * Every function is pure and takes its inputs — trivially testable offline, like moments before it.
 */
import type { Category } from './categories.js';
import type { Assignment } from './assign.js';
import type { Moment } from './moments.js';

/** The lift cut. Above: a distress signal (fires when something went wrong). Below: working style. */
export const LIFT_CUT = 2.0;

/** A behaviour must appear in this many DIFFERENT conversations before it can count on the
 *  scoreboard — three times in one bad afternoon is a bad afternoon, not a habit. It is also what
 *  keeps a thin fluke out of the headline number: an Infinity lift built on 3 moments in one session
 *  no longer registers as distress. This gives the design's oldest dead instrument its first job. */
export const MIN_CONVERSATIONS = 3;

/** Not enough evidence to claim a trend under this many carrying moments. */
const MIN_FOR_TREND = 6;
const RISE = 1.3;
const FADE = 0.7;

/** A moment paired with the categories it carries — the join every metric reads. */
export interface Labelled {
  moment: Moment;
  kinds: string[];
}

/** Join the pile to the checkmarks. Only assigned moments appear (an unassigned moment has no
 *  signal status yet). Assignments whose moment is gone (a shape rebuild) are dropped. */
export function join(moments: Moment[], assignments: Assignment[]): Labelled[] {
  const byKey = new Map(moments.map((m) => [m.key, m]));
  const out: Labelled[] = [];
  for (const a of assignments) {
    const moment = byKey.get(a.key);
    if (moment) out.push({ moment, kinds: a.kinds });
  }
  return out;
}

const isNegative = (m: Moment): boolean => m.pile === 'interrupt' || m.pile === 'decline';

/** lift = P(cat │ negative moment) / P(cat │ ordinary moment). A behaviour only ever seen in
 *  distress returns Infinity (maximal — it never appears in ordinary work); never seen returns 0. */
export function computeLift(neg: number, negTotal: number, ord: number, ordTotal: number): number {
  const pNeg = negTotal ? neg / negTotal : 0;
  const pOrd = ordTotal ? ord / ordTotal : 0;
  if (pOrd === 0) return pNeg > 0 ? Infinity : 0;
  return pNeg / pOrd;
}

/**
 * Rising or fading, read from the moments carrying this category. The rate is normalised by ALL
 * assigned moments in each half of the span, so a busy week cannot masquerade as a trend. Returns
 * undefined for steady or too-little-evidence — an absent marker already means "no claim", and
 * spelling out "we don't know" is hedging noise.
 */
export function direction(labelled: Labelled[], name: string): 'rising' | 'fading' | undefined {
  const carry = labelled.filter((l) => l.kinds.includes(name)).map((l) => Date.parse(l.moment.ts)).filter(Number.isFinite);
  if (carry.length < MIN_FOR_TREND) return undefined;
  carry.sort((a, b) => a - b);
  const start = carry[0];
  const end = carry[carry.length - 1];
  if (end <= start) return undefined;
  const mid = start + (end - start) / 2;

  const all = labelled.map((l) => Date.parse(l.moment.ts)).filter(Number.isFinite);
  const earlyAll = all.filter((t) => t >= start && t < mid).length;
  const lateAll = all.filter((t) => t >= mid && t <= end).length;
  const earlyRate = earlyAll ? carry.filter((t) => t < mid).length / earlyAll : 0;
  const lateRate = lateAll ? carry.filter((t) => t >= mid).length / lateAll : 0;

  if (earlyRate === 0) return lateRate > 0 ? 'rising' : undefined;
  if (lateRate >= earlyRate * RISE) return 'rising';
  if (lateRate <= earlyRate * FADE) return 'fading';
  return undefined;
}

/** One category's full arithmetic. */
export interface CategoryStat {
  name: string;
  description: string;
  count: number;
  sessions: number;
  lift: number;
  direction?: 'rising' | 'fading';
  bornAt: string;
  firstSeen?: string;
  lastSeen?: string;
  scope?: string;
}

/** Every category's counts in one pass over the labelled moments. */
export function tally(labelled: Labelled[], categories: Category[]): CategoryStat[] {
  const negTotal = labelled.filter((l) => isNegative(l.moment)).length;
  const ordTotal = labelled.filter((l) => l.moment.pile === 'ordinary').length;

  return categories.map((c) => {
    const carry = labelled.filter((l) => l.kinds.includes(c.name));
    if (!carry.length) {
      return { name: c.name, description: c.description, count: 0, sessions: 0, lift: 0, bornAt: c.bornAt, ...(c.scope ? { scope: c.scope } : {}) };
    }
    const neg = carry.filter((l) => isNegative(l.moment)).length;
    const ord = carry.filter((l) => l.moment.pile === 'ordinary').length;
    const ts = carry.map((l) => l.moment.ts).sort();
    const dir = direction(labelled, c.name);
    return {
      name: c.name,
      description: c.description,
      count: carry.length,
      sessions: new Set(carry.map((l) => l.moment.session)).size,
      lift: computeLift(neg, negTotal, ord, ordTotal),
      ...(dir ? { direction: dir } : {}),
      bornAt: c.bornAt,
      firstSeen: ts[0],
      lastSeen: ts[ts.length - 1],
      ...(c.scope ? { scope: c.scope } : {}),
    };
  });
}

/**
 * The misfit rate — the share of assigned moments that matched NOTHING. Stage 3's re-discovery
 * trigger: ~10% is healthy, a sustained rise means the columns no longer cover the person. `since`
 * bounds it to recent conversation time (by the moment's own timestamp, not when it was assigned —
 * at cold start everything is assigned at once).
 */
export function misfitRate(labelled: Labelled[], opts: { since?: Date } = {}): number {
  const rows = opts.since ? labelled.filter((l) => Date.parse(l.moment.ts) >= opts.since!.getTime()) : labelled;
  if (!rows.length) return 0;
  return rows.filter((l) => l.kinds.length === 0).length / rows.length;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The scoreboard: distinct moments carrying a distress category (lift ≥ cut), as a rate per 100
 *  messages. NOTHING below the cut may enter this number — otherwise a "successful" profile would
 *  look identical to the person going quiet. */
export interface Scoreboard {
  rate: number;
  signalMoments: number;
  total: number;
  signalCategories: string[];
}

export function scoreboard(labelled: Labelled[], categories: Category[]): Scoreboard {
  const stats = tally(labelled, categories);
  // A category counts only if it is BOTH a distress signal (lift) AND well-evidenced (conversations).
  // The second gate is what stops a 3-moment fluke — including an Infinity lift built on one bad
  // session — from entering the headline number.
  const signal = new Set(stats.filter((s) => s.lift >= LIFT_CUT && s.sessions >= MIN_CONVERSATIONS).map((s) => s.name));
  const total = labelled.length;
  const signalMoments = labelled.filter((l) => l.kinds.some((k) => signal.has(k))).length;
  return {
    rate: total ? round1((signalMoments / total) * 100) : 0,
    signalMoments,
    total,
    signalCategories: [...signal],
  };
}

/** The one line printed at the end of `update`. The delta prints only when there is a prior build. */
export function scoreboardLine(board: Scoreboard, prevRate?: number): string {
  const now = `corrections: ${board.rate} per 100 messages`;
  return prevRate === undefined ? now : `${now}  (was ${round1(prevRate)} last build)`;
}
