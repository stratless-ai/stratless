/**
 * FACTS — what the code knows for certain about one moment, written down as data.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE (judge v2, Sun 2026-07-20): the model is only asked for
 * what only a model can answer. Everything the code already knows, the code writes down.
 *
 * The judge used to do the reverse. `interrupted` and `declined` were rendered into an English
 * "PERSON ALSO" line, handed to the model as a stated RECORDED FACT, and then — measured across the
 * whole corpus — **dropped in 19 of the 20 judged cases. A 95% loss on the one signal in the entire
 * product that is free, objective, and certain.** The moments it lost were not marginal: they were
 * the ones where Sun hit escape mid-answer and hard-redirected. A certainty rendered into prose
 * becomes an opinion the model may decline to hold.
 *
 * So facts travel as fields, the model is never asked about them, and they can never be lost.
 *
 * Two properties they inherit from living outside the exchange hash (`exchange.ts`):
 *   · adding one never orphans a cached judgment (the hash covers prompt/said/reaction only), and
 *   · they can be enriched later without a PIPELINE_V bump or a single re-judged exchange.
 *
 * Both blocks are OPTIONAL on a Judgment. Entries judged before this existed simply have neither,
 * stay valid, and cost nothing — which is the whole reason the judge could be improved without
 * spending anything (Sun: "if the judge is not up to what i think it is, then there's no point to
 * spend").
 */
import type { Exchange } from './exchange.js';

/** WHERE the moment sat — position, rhythm, and place. All arithmetic or transcript metadata. */
export interface At {
  /** 0-based position in its session. The median exchange is the 39th of its session; before this
   *  the judge could not tell the 1st from the 259th. */
  index?: number;
  /** how many exchanges that session held */
  ofSession?: number;
  /** seconds since the previous exchange in the same session (absent on the first) */
  gapSec?: number;
  /** first exchange of its working day, 04:00 boundary */
  firstOfDay?: boolean;
  /** the project directory — 47 distinct across the archive, and unlike `topic` (99.5% unique) it
   *  actually repeats, which is the entire requirement for grouping anything */
  project?: string;
  /** the git branch at the time */
  branch?: string;
  /** last exchange of its session — closing a session deliberately is an act */
  lastOfSession?: boolean;
  /**
   * The proportions of the moment: characters asked / answered / replied, true lengths.
   *
   * Added because the truth test showed one sentence covering two opposite states — "double check
   * the work" said when the work was too complex to follow, and the same words said out of genuine
   * doubt. The judge scored every one as doubt. The states differ observably in SHAPE (a short
   * generic reply to a long answer vs a specific one), and shape is arithmetic, not inference.
   */
  shape?: { ask: number; said: number; reply: number };
}

/** WHAT THE PERSON DID WITH THEIR HANDS — recorded events, never inferred from wording. */
export interface Did {
  interrupted?: 'plain' | 'tool-use';
  declined?: boolean;
  images?: number;
  pasted?: boolean;
}

/**
 * WHAT THE ASSISTANT DID WITH ITS HANDS — the other party's actions, and the largest fact the
 * judge was never given.
 *
 * `said` carries text only; tool calls are stripped in `exchange.ts`. Measured across the corpus,
 * **57% of exchanges have an assistant turn that ran tools** — so in more than half of all moments
 * the person is reacting to WORK PERFORMED, and the judge was reading it as a reaction to prose.
 * "ok good" after twelve file edits and a passing test run is not the same behavior as "ok good"
 * after a paragraph of explanation.
 */
export interface Ran {
  /** distinct tool names, first-seen order */
  tools: string[];
  /** total invocations, duplicates included — the size of the work, not just its kind */
  calls: number;
}

/** How many distinct tool names to name before the list stops being read as a list. */
const RAN_NAMES = 8;

/** Drop keys whose value is undefined so a judgment never carries empty noise, and return
 *  undefined rather than `{}` when nothing at all is known. */
function compact<T extends object>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return Object.keys(out).length ? out : undefined;
}

/** The positional facts of one exchange. Pure. */
export function atOf(ex: Exchange): At | undefined {
  return compact<At>({
    index: ex.index,
    ofSession: ex.ofSession,
    gapSec: ex.gapSec,
    firstOfDay: ex.firstOfDay,
    project: ex.project,
    branch: ex.branch,
    lastOfSession: ex.lastOfSession,
    shape: ex.shape,
  });
}

/** The recorded actions of one exchange. Pure. Absent entirely on the ~97% that carry none. */
export function didOf(ex: Exchange): Did | undefined {
  return compact<Did>({
    interrupted: ex.interrupted,
    declined: ex.declined,
    images: ex.images,
    pasted: ex.pasted,
  });
}

/** The assistant's actions during one exchange. Pure. Absent on the ~43% that were pure talk. */
export function ranOf(ex: Exchange): Ran | undefined {
  if (!ex.tools?.length) return undefined;
  return { tools: [...new Set(ex.tools)].slice(0, RAN_NAMES), calls: ex.tools.length };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// SHOWING the facts, which is a different job from RECORDING them.
//
// Recording (above) is what makes a fact unlosable. Showing it to the judge is what makes the
// judge's sentence better informed. The order matters: because the fact is already stored as data,
// putting it in the prompt is PURELY ADDITIVE — if the model ignores every word of context we lose
// nothing, because nothing here is the only copy. That was not true before `at`/`did` existed, and
// it is why this arrived second.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** A gap a person would recognise. Rounded deliberately: the judge is being told roughly how long
 *  the pause was, and false precision ("1,982s") reads as data rather than as rhythm. */
export function humanGap(sec: number): string {
  if (sec < 90) return `${sec}s later`;
  const min = Math.round(sec / 60);
  if (min < 90) return `${min} min later`;
  // Round to one decimal, then let JS drop a trailing zero: "2 h", never "2.0 h".
  const h = sec / 3600;
  return `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h)} h later`;
}

/**
 * The one-line frame for a moment: where in the session, how long since the last one, what project.
 *
 * The judge could not previously tell the 1st exchange of a session from the 259th — the median is
 * the 39th — and treated a reply typed 20 seconds later identically to one typed after a 33-minute
 * break. Every value here is code-computed, which is why the rules tell the model it is trustworthy.
 *
 * Returns '' when nothing is known, so an old exchange renders exactly as it always did.
 */
/**
 * The assistant's work, stated NEUTRALLY and appended to its turn.
 *
 * Wording discipline carried over from the "PERSON ALSO" line, which was measured: the first cut
 * said "cut the answer off" / "refused a tool it wanted to run" and the verdicts collapsed toward
 * failure. State the event; let the reaction carry the meaning. So this names tools and counts
 * calls and says nothing about whether the work was good, wanted, or finished.
 */
export function ranLine(ran: Ran): string {
  const names = ran.tools.join(' · ');
  return ran.calls > ran.tools.length ? `${names} (${ran.calls} calls)` : names;
}

export function contextLine(ex: Exchange): string {
  const bits: string[] = [];
  if (ex.index !== undefined && ex.ofSession !== undefined) bits.push(`exchange ${ex.index + 1} of ${ex.ofSession}`);
  if (ex.index === 0) bits.push('start of the session');
  else if (ex.gapSec !== undefined) bits.push(humanGap(ex.gapSec));
  if (ex.firstOfDay) bits.push('first of the day');
  if (ex.project) bits.push(ex.branch ? `${ex.project} (${ex.branch})` : ex.project);
  return bits.join(' · ');
}
