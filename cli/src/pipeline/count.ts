/**
 * COUNT — the adder-upper. Pure arithmetic over the checkmarks; no model, no cost.
 *
 * THE DOCTRINE (adopted 2026-07-29): **LIFT grades the AI, never the human.** The mode-1 witness
 * lives here — a fading ask is re-read against the assistant's own actions, so what gets graded
 * is the AI's supply, never the person's asking.
 *
 * This is what v1 paid a model to do (mine → audit → grade, $24 and 84% of its evidence lost).
 * Once the labels exist, everything the profile needs is counting:
 *
 *   · lift      — how much more a behaviour fires when something went wrong (distress vs ordinary).
 *                 It used to split the file in two; the conductor sections replaced that (see
 *                 write.ts). It now feeds the scoreboard, ranks shorthand, and hints the voicer.
 *   · direction — rising or fading, read ONLY from the moments a category actually carries (frozen-once
 *                 guarantees those never predate its birth, so there is no birth-boundary to police).
 *                 A fading ask is re-read against the assistant's own actions (tools/denied on the
 *                 moment) and may resolve to `met` — the ask faded because it stopped being needed.
 *   · misfit    — the share of recent moments that matched nothing. Read by `status` as coverage;
 *                 it no longer triggers anything (re-discovery went with the discover stage).
 *   · scoreboard— the one number the person sees: how much of what they typed was correcting the AI.
 *
 * Every function is pure and takes its inputs — trivially testable offline, like moments before it.
 */
import type { Category } from './categories.js';
import type { Assignment } from './assign.js';
import type { Moment } from './moments.js';

/** The lift cut. Above: a distress signal (fires when something went wrong). Below: working style.
 *  It no longer decides which section a behaviour lands in — write.ts does that. */
export const LIFT_CUT = 2.0;

/** A behaviour must appear in this many DIFFERENT conversations before it can count on the
 *  scoreboard — three times in one bad afternoon is a bad afternoon, not a habit. It is also what
 *  keeps a thin fluke out of the headline number: an Infinity lift built on 3 moments in one session
 *  no longer registers as distress. This gives the design's oldest dead instrument its first job. */
export const MIN_CONVERSATIONS = 3;

/** Not enough evidence to claim a trend under this many carrying moments. */
const MIN_FOR_TREND = 6;
const RISE = 1.3;
/** Exported: the patch lifecycle (lift.ts) reuses the same steady/fading boundary. */
export const FADE = 0.7;
const WEEK_MS = 7 * 24 * 3600 * 1000;

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

/* ——— THE TWO-SIDED MARKER (2026-07-27) ———
 *
 * A fading stamp read from the person's words alone cannot tell "stopped wanting it" from "stopped
 * having to ask" — and on a demand-shaped row the second is the profile WORKING: an assistant that
 * reads one-sided fading as "ease off" dismantles its own adaptation and brings the asking back.
 * The discriminator is the other side of the conversation, which the pile already carries: what
 * the assistant DID (moment.tools) and what the person REFUSED (moment.denied). Measured on the
 * reference archive before this code existed (the fading spike, 2026-07-27): plan-asks fell to
 * 0.55× while plan-mode actions held 1.20× with near-zero refusals — met, not fading.
 *
 *   met := asks fading AND action-supply steady-or-rising AND declines not rising.
 *
 * Every threshold below was pre-registered from the spike's measurements, not tuned until
 * something passed. */

/** The mapping floor. A category earns an action only by RESPONSE ADJACENCY — the action fires in
 *  the moment right after the ask far more often than its base rate. Measured separation: the one
 *  true pair scored 12.75×, the runner-up 2.17×; the cut sits in the gap, near neither. */
const ADJ_LIFT = 5;
/** ...and the response must be common after the ask, not merely disproportionate. */
const ADJ_P = 0.1;
/** Below this many ask→response pairs, adjacency is anecdote. */
const MIN_ADJ = 30;
/** A tool must appear in this many moments before it can be anyone's mapped action. */
const MIN_ACTION = 30;

export interface Adjacency {
  /** moment.key → the moment that follows it in the same session */
  next: Map<string, Moment>;
  /** tool name → how many moments ran it */
  base: Map<string, number>;
  total: number;
  /** session → its moments in time order — the within-session ordering the pile itself lacks */
  bySession: Map<string, Labelled[]>;
}

export function adjacencyOf(labelled: Labelled[]): Adjacency {
  const ordered = [...labelled].sort((a, b) =>
    a.moment.session === b.moment.session
      ? a.moment.ts.localeCompare(b.moment.ts)
      : a.moment.session.localeCompare(b.moment.session),
  );
  const next = new Map<string, Moment>();
  for (let i = 0; i + 1 < ordered.length; i++) {
    if (ordered[i].moment.session === ordered[i + 1].moment.session) next.set(ordered[i].moment.key, ordered[i + 1].moment);
  }
  const bySession = new Map<string, Labelled[]>();
  for (const l of ordered) {
    const rows = bySession.get(l.moment.session);
    if (rows) rows.push(l);
    else bySession.set(l.moment.session, [l]);
  }
  const base = new Map<string, number>();
  for (const l of labelled) for (const t of l.moment.tools ?? []) base.set(t, (base.get(t) ?? 0) + 1);
  return { next, base, total: labelled.length, bySession };
}

/** The action a category's asks are answered WITH — or nothing. Derived per build, never stored:
 *  category names do not survive a rebuild, and neither should a mapping keyed on them. No tool is
 *  special-cased; whatever answers the asks is the action. */
export function actionFor(labelled: Labelled[], name: string, adj: Adjacency = adjacencyOf(labelled)): string | undefined {
  const answered = labelled.filter((l) => l.kinds.includes(name) && adj.next.has(l.moment.key));
  if (answered.length < MIN_ADJ) return undefined;
  let best: { action: string; lift: number } | undefined;
  for (const [action, n] of adj.base) {
    if (n < MIN_ACTION) continue;
    const p = answered.filter((l) => (adj.next.get(l.moment.key)!.tools ?? []).includes(action)).length / answered.length;
    const lift = p / (n / adj.total);
    if (p >= ADJ_P && lift >= ADJ_LIFT && (!best || lift > best.lift)) best = { action, lift };
  }
  return best?.action;
}

/** The assistant's side of a fading ask, on the same span and normalisation as direction(). */
export interface SupplyRead {
  action: string;
  /** late action-rate over early. ≥ FADE: the assistant kept doing it while the asking faded. */
  supplyRatio: number;
  /** the person refused the action more lately (late refusal-rate > early × RISE) */
  declinesRose: boolean;
}

export function supplyRead(labelled: Labelled[], name: string, adj?: Adjacency): SupplyRead | undefined {
  // ONE ASSISTANT PER READ, enforced rather than assumed. This is the verdict that says an AI met
  // this person, and both of its legs are tool-specific: the actions are that tool's tool names, and
  // a decline means something slightly different in each (a Codex decline covers stopping a running
  // command as well as refusing one). Averaging two tools here would produce a number that describes
  // neither. A caller who has not sliced the pile gets nothing back, which is the honest answer.
  if (new Set(labelled.map((l) => l.moment.record)).size > 1) return undefined;
  const action = actionFor(labelled, name, adj ?? adjacencyOf(labelled));
  if (!action) return undefined;
  // Refuse, don't lie: a pile with no denial data ANYWHERE cannot clear the declines leg — this
  // moment shape may predate the `denied` field, and "no refusals recorded" must not be read as
  // "no refusals happened". Conservative: such a pile never claims met, only bare counts.
  if (!labelled.some((l) => l.moment.denied?.length)) return undefined;
  const carry = labelled
    .filter((l) => l.kinds.includes(name))
    .map((l) => Date.parse(l.moment.ts))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (carry.length < MIN_FOR_TREND) return undefined;
  const start = carry[0];
  const end = carry[carry.length - 1];
  if (end <= start) return undefined;
  const mid = start + (end - start) / 2;
  const half = (lo: number, hi: (t: number) => boolean) => {
    const rows = labelled.filter((l) => {
      const t = Date.parse(l.moment.ts);
      return Number.isFinite(t) && t >= lo && hi(t);
    });
    const acts = rows.filter((l) => (l.moment.tools ?? []).includes(action)).length;
    const refused = rows.filter((l) => (l.moment.denied ?? []).includes(action)).length;
    return { all: rows.length, acts, refused };
  };
  const early = half(start, (t) => t < mid);
  const late = half(mid, (t) => t <= end);
  if (!early.all || !late.all) return undefined;
  const earlyS = early.acts / early.all;
  const lateS = late.acts / late.all;
  if (earlyS === 0 && lateS === 0) return undefined;
  const supplyRatio = earlyS === 0 ? Infinity : lateS / earlyS;
  const earlyD = early.acts ? early.refused / early.acts : 0;
  const lateD = late.acts ? late.refused / late.acts : 0;
  return { action, supplyRatio, declinesRose: lateD > earlyD * RISE };
}

/* ——— THE GAP READ (LIFT layer 2, 2026-07-28) ———
 *
 * A LIFT rule is the gap between a standard the person holds and the moments they pay for not
 * applying it in time. Both valences of one axis land in the SAME pile (the engine clusters by
 * content): "lets plan" said calmly is the standard — pile `ordinary`; "wait, lets plan" said as
 * an interruption is the late catch — pile `interrupt`/`decline`. So the pairing is
 * within-category, split by the recorded pile event. Cross-category centroid pairing was measured
 * dead first (all-pairs cosine mean 0.821, max 0.930 — no decisive gap), and session position was
 * measured to be noise; the pile is the valence, full stop.
 *
 * Every floor below was pre-registered from the reference archive's probes before this code was
 * written (the one clearing candidate: 25 slips / 20 sessions / 7 stumbles / 208 reaches; the
 * runner-up fails twice) — not tuned until something passed. */

/** A slip only counts against the PERSON when no reach preceded it in the session. */
const SLIP_MIN = 15;
const SLIP_SESS_MIN = 8;
const STUMBLE_SESS_MIN = 5;
const REACH_MIN = 30;
/** The lifecycle's measurement window — each build re-measures the gap over this much recent time. */
export const RECENT_DAYS = 21;

export interface GapCandidate {
  name: string;
  /** ordinary-pile carries — the person reaching for their own standard */
  reach: number;
  /** interrupt/decline-pile carries — the recorded late catches */
  slip: number;
  slipSessions: number;
  /** sessions where the slip came with NO reach before it — the rule's whole evidence */
  stumbleSessions: string[];
  /** sessions where the standard WAS deployed and things slipped anyway — the assistant's failure,
   *  excluded from the rule (it is catch-row material, not a gap in the person) */
  guardedSessions: number;
}

/** Did this session stumble (first slip of `name` arrives with no prior ordinary reach)? */
function stumbled(rows: Labelled[], name: string): boolean {
  for (const l of rows) {
    if (!l.kinds.includes(name)) continue;
    if (isNegative(l.moment)) return true; // the slip came first
    if (l.moment.pile === 'ordinary') return false; // the reach came first — guarded
  }
  return false;
}

/** The categories whose gap is real enough to mint a rule from. The ENTRY gate is the scoreboard's
 *  own signal criteria (a distress-shaped, well-evidenced category); the floors are the rule's. */
export function gapCandidates(labelled: Labelled[], categories: Category[], adj: Adjacency = adjacencyOf(labelled)): GapCandidate[] {
  const stats = tally(labelled, categories);
  const out: GapCandidate[] = [];
  for (const s of stats) {
    if (s.scope === 'project') continue;
    if (s.lift < LIFT_CUT || s.sessions < MIN_CONVERSATIONS) continue;
    const carry = labelled.filter((l) => l.kinds.includes(s.name));
    const slip = carry.filter((l) => isNegative(l.moment));
    const reach = carry.filter((l) => l.moment.pile === 'ordinary');
    if (slip.length < SLIP_MIN || reach.length < REACH_MIN) continue;
    const slipSess = new Set(slip.map((l) => l.moment.session));
    if (slipSess.size < SLIP_SESS_MIN) continue;
    const stumbles: string[] = [];
    let guarded = 0;
    for (const sess of slipSess) {
      if (stumbled(adj.bySession.get(sess) ?? [], s.name)) stumbles.push(sess);
      else guarded++;
    }
    if (stumbles.length < STUMBLE_SESS_MIN) continue;
    out.push({ name: s.name, reach: reach.length, slip: slip.length, slipSessions: slipSess.size, stumbleSessions: stumbles.sort(), guardedSessions: guarded });
  }
  return out.sort((a, b) => b.slip - a.slip);
}

/** One build's re-measurement of a rule's gap, over the trailing window. `sample` says how much
 *  recent evidence the rates stand on — a quiet stretch must not read as a closed gap. `chances`
 *  is the shadow rule's unit (pre-registered 2026-07-30): the distinct sessions where the
 *  situation AROSE at all — absence without opportunity is silence, not success. */
export function gapWindowRead(
  labelled: Labelled[],
  name: string,
  nowMs: number,
  days = RECENT_DAYS,
): { slipRate: number; stumbleSessions: number; reach: number; sample: number; chances: number } {
  const cut = nowMs - days * 24 * 3600_000;
  const win = labelled.filter((l) => {
    const t = Date.parse(l.moment.ts);
    return Number.isFinite(t) && t >= cut && t <= nowMs;
  });
  if (!win.length) return { slipRate: 0, stumbleSessions: 0, reach: 0, sample: 0, chances: 0 };
  const adj = adjacencyOf(win);
  const carry = win.filter((l) => l.kinds.includes(name));
  const slip = carry.filter((l) => isNegative(l.moment));
  const reach = carry.filter((l) => l.moment.pile === 'ordinary').length;
  let stumbles = 0;
  for (const sess of new Set(slip.map((l) => l.moment.session))) {
    if (stumbled(adj.bySession.get(sess) ?? [], name)) stumbles++;
  }
  return {
    slipRate: slip.length / win.length,
    stumbleSessions: stumbles,
    reach,
    sample: win.length,
    chances: new Set(carry.map((l) => l.moment.session)).size,
  };
}

/** True when a single ISO week holds at least half a category's moments — concentrated in a bad
 *  stretch, a fact neither the count nor the trend captures. */
function isBurst(carry: Labelled[]): boolean {
  const weeks = new Map<number, number>();
  for (const l of carry) {
    const t = Date.parse(l.moment.ts);
    if (Number.isFinite(t)) {
      const w = Math.floor(t / WEEK_MS);
      weeks.set(w, (weeks.get(w) ?? 0) + 1);
    }
  }
  return weeks.size > 0 && Math.max(...weeks.values()) / carry.length >= 0.5;
}

/** One category's full arithmetic. */
export interface CategoryStat {
  name: string;
  description: string;
  count: number;
  sessions: number;
  lift: number;
  /** an ISO week holds ≥50% of the members — concentrated in a bad stretch vs spread evenly */
  burst: boolean;
  direction?: 'rising' | 'fading' | 'met';
  /** The trend was confirmed from BOTH sides of the conversation: met always is; fading is when
   *  the assistant's supply faded with the asking. Only a verified trend may print on a
   *  demand-shaped row (write.ts) — a one-sided fading there instructs sabotage of a working
   *  adaptation. Both sides belong to ONE pair by construction now: tally's input is a single
   *  record's slice, so a bare `met` needs no owner label — the file it prints in IS the owner. */
  verified?: true;
  /** the assistant action this category's asks are answered with — met's evidence, derived per build */
  action?: string;
  bornAt: string;
  firstSeen?: string;
  lastSeen?: string;
  scope?: string;
}

/** Every category's counts in one pass over the labelled moments. */
export function tally(labelled: Labelled[], categories: Category[]): CategoryStat[] {
  const negTotal = labelled.filter((l) => isNegative(l.moment)).length;
  const ordTotal = labelled.filter((l) => l.moment.pile === 'ordinary').length;
  // Built once, on first fading category — most tallies (a rising pile, a fresh build) never pay it.
  let adj: Adjacency | undefined;

  return categories.map((c) => {
    const carry = labelled.filter((l) => l.kinds.includes(c.name));
    if (!carry.length) {
      return { name: c.name, description: c.description, count: 0, sessions: 0, lift: 0, burst: false, bornAt: c.bornAt, ...(c.scope ? { scope: c.scope } : {}) };
    }
    const neg = carry.filter((l) => isNegative(l.moment)).length;
    const ord = carry.filter((l) => l.moment.pile === 'ordinary').length;
    const ts = carry.map((l) => l.moment.ts).sort();
    const dir = direction(labelled, c.name);
    // Only a fading ask gets the two-sided read: fading is the one stamp that can instruct an
    // assistant to stop doing something that is working, so it alone must survive both sides.
    // The labelled set is one record's slice by construction (the per-record doctrine), so the
    // verdict is that pair's own — `supplyRead`'s mixed-slice refusal is the assertion of that.
    let stamped: 'rising' | 'fading' | 'met' | undefined = dir;
    let verified: true | undefined;
    let action: string | undefined;
    if (dir === 'fading') {
      adj ??= adjacencyOf(labelled);
      const read = supplyRead(labelled, c.name, adj);
      if (read) {
        action = read.action;
        if (read.supplyRatio >= FADE && !read.declinesRose) {
          stamped = 'met'; // the asking faded because the doing kept happening, unrefused
          verified = true;
        } else if (read.supplyRatio <= FADE) {
          verified = true; // both sides quiet — the fade is real on the evidence of both
        }
      }
    }
    return {
      name: c.name,
      description: c.description,
      count: carry.length,
      sessions: new Set(carry.map((l) => l.moment.session)).size,
      lift: computeLift(neg, negTotal, ord, ordTotal),
      burst: isBurst(carry),
      ...(stamped ? { direction: stamped } : {}),
      ...(verified ? { verified } : {}),
      ...(action ? { action } : {}),
      bornAt: c.bornAt,
      firstSeen: ts[0],
      lastSeen: ts[ts.length - 1],
      ...(c.scope ? { scope: c.scope } : {}),
    };
  });
}

/**
 * The misfit rate — the share of assigned moments that matched NOTHING. Reported by `status` as
 * coverage: ~10% is healthy, a sustained rise means the behaviours no longer cover the person. `since`
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

