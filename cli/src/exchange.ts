/**
 * EXCHANGES — the profiler's unit of evidence.
 *
 * transcript.ts reads the log as EDITS — every time the assistant wrote to disk. The profiler
 * reads the SAME log a second way: as (AI turn → human reaction) pairs. Every time the assistant
 * said something and the person answered, that is one chance to learn whether understanding
 * transferred — the single question the whole profile is built from (handover §3.2, §4).
 *
 * The trick that makes the pairs fall out cleanly: each real human message is BOTH the reaction to
 * the turn before it AND the prompt for the turn after it. So we carry the last human message
 * forward, accumulate what the assistant says, and close a pair the instant the human speaks again.
 *
 * Nothing here is generated. Every field is quoted from the log. Interpretation lives downstream
 * (moments.ts on).
 */
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import { PASTE_BOUND, dayKey, type Session, type Turn } from './seam.js';
import { allSessions, recordFor } from './adapters.js';
import { termsOf } from './terms.js';

/**
 * The sessions a walk reads: everything the registry finds, or — when a caller names roots
 * explicitly — only those.
 *
 * Named roots are read by whichever Record claims them (`recordFor`), so this stays true when a
 * second assistant registers: the archive walk, a fixture directory and a live log each get parsed
 * by the reader that understands them, and the engine never learns which one that was.
 */
const sessionsIn = (roots?: string[]): Generator<Session> =>
  roots ? sessionsOfRoots(roots) : allSessions();

function* sessionsOfRoots(roots: string[]): Generator<Session> {
  for (const root of roots) yield* recordFor(root).sessions([root]);
}

/** One (AI turn → human reaction) pair. */
export interface Exchange {
  /** what the person asked that opened this turn — their words */
  prompt: string;
  /** what the assistant said back, its own words (text only; tool calls stripped). Keeps the TAIL —
   *  the reaction answers the END of the turn — so for a turn over the cap this is its ending. */
  said: string;
  /**
   * The OPENING of that same turn — the head, a FACT outside the hash.
   *
   * `said` keeps the tail because the reaction answers the end; `saidHead` keeps the start because
   * the start is often the TRIGGER. "why are you coding suddenly?" reacts to the assistant
   * ANNOUNCING it would code, which lives in the opening move and nowhere else. For a long turn the
   * head cannot be recovered from `said` (that is the tail window), so it is captured separately.
   * Absent when the assistant said nothing — an opener, or a tool-only turn.
   */
  saidHead?: string;
  /** how the person reacted — the next thing they said. THIS carries the signal. */
  reaction: string;
  /** ISO timestamp of the reaction (falls back to the AI turn's) */
  ts: string;
  /** which session this came from */
  session: string;
  /** which Record read it — carried from the `Session`, never derived from the path. The engine
   *  ignores this; the per-assistant half of the profile is the only thing that reads it. */
  record: string;
  /** stable content hash — the cache key. Read once, ever. */
  hash: string;
  /**
   * WHAT THE PERSON DID WITH THEIR HANDS between the prompt and the reaction — recorded fact, not
   * inference. Deliberately OUTSIDE the hash: adding these must not orphan a single cached
   * judgment (measured: 436 of 496 survive the move to the shared reader; only the 60 whose text
   * genuinely changed re-judge).
   *
   * `interrupted` is 'plain' (Escape mid-generation — a spontaneous course correction) or
   * 'tool-use' (the tail of a permission decline). They are NOT the same event.
   */
  interrupted?: 'plain' | 'tool-use';
  /** the person declined a tool during this turn */
  declined?: boolean;

  // ── THE FACTS (judge v2, 2026-07-20) ──────────────────────────────────────────────────────────
  // Everything below is KNOWN FOR CERTAIN by the code at the moment the exchange is built, and all
  // of it used to be thrown away here: reader.ts parses 13 fields per turn and this layer kept 6.
  //
  // Measured why it matters: the judge was handed `interrupted` as an English sentence and DROPPED
  // IT IN 19 OF 20 JUDGED CASES. A certainty rendered into prose becomes an opinion the model may
  // decline. So these travel as data, and the model is never asked about them.
  //
  // ALL OF THEM SIT OUTSIDE THE HASH, exactly like `interrupted` and `declined` — adding a fact
  // must never orphan a cached judgment. Pinned by test.
  // ──────────────────────────────────────────────────────────────────────────────────────────────

  /** where this happened, home-relative (see `projectOf`) — 51 distinct across the archive, and the
   *  ONLY grouping dimension in the product that no language model produced. Contrast `topic`,
   *  which measured 99.5% unique and therefore groups nothing. */
  project?: string;
  /** the git branch at the time */
  branch?: string;
  /** images the person attached to the REACTION — the turn we read as evidence */
  images?: number;
  /** either side of this exchange was pasted, not typed (over PASTE_BOUND) */
  pasted?: boolean;
  /** 0-based position within its session. The median exchange is the 39th; the judge treated the
   *  1st and the 259th as the same kind of event. */
  index?: number;
  /** how many exchanges that session held in total */
  ofSession?: number;
  /** seconds since the previous exchange in the same session (absent on the first) */
  gapSec?: number;
  /** first exchange of its working day (04:00 boundary). Set at window assembly, not here — it
   *  needs corpus order, and this function only ever sees one session. */
  firstOfDay?: boolean;
  /**
   * EVERY TOOL THE ASSISTANT INVOKED while answering, in order, duplicates included.
   *
   * `said` is text only — tool calls are stripped — so the judge could not tell an assistant that
   * EXPLAINED something from one that edited twelve files and ran the tests. Measured: **57% of
   * exchanges have an assistant turn that ran tools.** In all of them the person is reacting to
   * work performed, and "ok good" after completed work is a different behavior from "ok good"
   * after a paragraph. This is the largest fact the judge was never given.
   */
  tools?: string[];
  /**
   * WHICH TOOLS THE PERSON REFUSED in this exchange — the denial's tool_use id resolved to a name
   * (reader.ts). `declined` says a refusal happened; this says what was refused, which is the
   * difference between "he declined something" and "he declined the plan". Only `user-rejected`
   * denials land here — a system block is not the person's act.
   */
  denied?: string[];
  /** last exchange of its session — "ended it here" is an act, and it was invisible */
  lastOfSession?: boolean;
  /**
   * THE ANSWER CHANNEL — salient candidate terms of the assistant's FULL answer, extracted here
   * because this is the only place the whole answer exists as one string (the caps below keep a
   * head and a tail; the card keeps less again). Candidates, not topics: which of these are rare
   * for THIS person, and whether they thread across sessions, is downstream arithmetic (terms.ts
   * has the doctrine — including why the v2 judge's `topic` tombstone above does not apply).
   * Absent when the assistant said nothing, like `saidHead`.
   */
  aiTerms?: string[];
  /**
   * THE SHAPE OF THE MOMENT — true character counts, taken BEFORE the CAP truncation, so a genuine
   * wall of text reports its real size.
   *
   * Its job, established by the truth test 2026-07-20: Sun asks for a double-check in two opposite
   * states that produce the SAME sentence — (1) the work was too complex to follow, so he delegates
   * both doing and checking; (2) he doubts something specific. The judge recorded every one of them
   * as (2). They need opposite responses: re-verifying is right for (2) and useless for (1), where
   * it returns "checked, all good" to someone who still cannot follow.
   *
   * The states are not directly observable — asking a model to guess which one is the trap that
   * killed `verdict` and `onTopic`. What IS observable is the shape: state (1) tends to be a short
   * generic ask after a long answer; state (2) names the thing it doubts. Record the shape, let
   * downstream read it.
   */
  shape?: { ask: number; said: number; reply: number };
}

/** The parse-time cap per field — the IDENTITY layer: capped text is what gets hashed, so this
 *  number may only ever change inside a deliberate pipeline-version bump (0.3.0 raised it 4,000 →
 *  8,000 while v2 was re-judging everything anyway — free churn, and the 21% of long turns keep
 *  more real tail). Cost is unaffected: the judge's VIEW (judge.ts) bounds what a call pays for.
 *  Direction matters: prompt and reaction keep their HEAD (the ask leads, and both measure p99
 *  under 600 chars anyway), but `said` keeps its TAIL — the reaction answers the END of the
 *  assistant's turn (measured 2026-07-16). */
const CAP = 8000;

/** How much of the assistant's OPENING to keep as a fact. Small: the opening MOVE (jump to action,
 *  hedge, restate) is legible in the first few hundred characters; a moment stores less again. */
const SAID_HEAD = 800;

/**
 * The identity of one exchange — CONTENT ONLY, and it stays that way.
 *
 * Session was briefly added here, on the theory that an opener (no prompt, no assistant turn) has
 * two empty fields and so hashes on the person's words alone, letting two sessions that both begin
 * "ok lets continue" collapse into one. Measured on 4,896 real exchanges: **zero collisions**, with
 * or without session in the key. It bought nothing observable and it broke a stated invariant —
 * "same words = same hash, whatever we learned about the surroundings" — which is what lets a fact
 * be added later without orphaning anything. So it was reverted.
 *
 * If it ever does bite, the reaction record carries its own uuid in the transcript and `moments.ts`
 * can key on that. It has not bitten, so nothing was added for it.
 */
function hashOf(prompt: string, said: string, reaction: string): string {
  return createHash('sha256').update(`${prompt}\0${said}\0${reaction}`).digest('hex').slice(0, 16);
}

/**
 * The project label for a working directory — HOME-RELATIVE, never a basename.
 *
 * The first cut used `basename(cwd)` and it was wrong on this very archive: **51 real paths
 * collapsed to 39 labels, with 6 collisions.** `src` alone matched six directories across two
 * different repositories, so `/Users/x/stratless-mono/cli/src` and `/Users/x/stratless/apps/web/src`
 * would have been recorded as the same project — a false grouping, which is the exact failure this
 * field exists to prevent.
 *
 * Stripping HOME keeps every path distinct and readable while keeping the user's home directory out
 * of the store. Anything coarser (a repo root, a first segment) is a GROUPING decision and belongs
 * downstream: this layer records what was true.
 */
export function projectOf(cwd: string): string {
  const home = homedir();
  const rel = cwd.startsWith(`${home}/`) ? cwd.slice(home.length + 1) : cwd;
  return rel || basename(cwd) || cwd;
}

/**
 * Pair one session's clean turns into (AI turn → human reaction) exchanges.
 *
 * Each real human message is BOTH the reaction to the turn before it AND the prompt for the turn
 * after, so we carry the last message forward, accumulate what the assistant says, and close a pair
 * the instant the human speaks again. A pair only counts if the person asked something AND the
 * assistant actually said something back: a turn where it only ran tools has no understanding to
 * transfer, so there is nothing to judge.
 *
 * Control actions seen while the assistant was talking ride along on the exchange they belong to.
 */
export function exchangesOfTurns(turns: Turn[], session: string, record: string): Exchange[] {
  const out: Exchange[] = [];
  let prompt = '';
  let said: string[] = [];
  let saidTs = '';
  let interrupted: 'plain' | 'tool-use' | undefined;
  let declined = false;
  // The environment facts ride along from whichever turn last carried them: every record has them,
  // but a single turn may not, so the latest seen is the truth for the exchange being assembled.
  let cwd: string | undefined;
  let branch: string | undefined;
  let tools: string[] = [];
  let denied: string[] = [];

  for (const t of turns) {
    if (t.cwd) cwd = t.cwd;
    if (t.gitBranch) branch = t.gitBranch;
    if (t.role === 'assistant') {
      if (t.ts) saidTs = t.ts;
      if (t.text) said.push(t.text);
      if (t.tools) tools.push(...t.tools); // accumulated across the whole answering turn
      continue;
    }
    // Control actions are not messages — they annotate the turn in flight.
    if (t.interrupted) {
      interrupted = t.interruptKind ?? 'plain';
      continue;
    }
    if (t.denial === 'user-rejected') {
      declined = true;
      if (t.deniedTools) denied.push(...t.deniedTools);
    }
    if (!t.text) continue;

    // `said` keeps its TAIL: the reaction answers the end of the turn, not its preamble.
    const saidRaw = said.join('\n').trim();
    const saidText = saidRaw.slice(-CAP);
    // EMIT ON THE REACTION ALONE.
    //
    // This used to require `prompt && saidText`, on the reasoning that "a turn where it only ran
    // tools has no understanding to transfer, so there is nothing to judge". That was correct for
    // the judge's question and is wrong for discovery, which reads what the PERSON did — and a
    // reply to work-in-progress is often the most informative moment in the archive.
    //
    // Measured on the reference archive: the old condition dropped 180 moments. 172 of them had no
    // assistant text at all, 72 were session openers. Overall that is 3.7% — but the loss is
    // CORRELATED with the thing being detected: an interrupt is most likely to land while the
    // assistant is mid-tool and has not spoken yet, so it took **25 of 151 anchor moments, 16.6%**.
    if (t.text) {
      const p = prompt.slice(0, CAP);
      const r = t.text.slice(0, CAP);
      // The answer channel reads the UNCAPPED answer — the one string the caps are about to shred.
      const aiTerms = saidRaw ? termsOf(saidRaw) : [];
      out.push({
        prompt: p,
        said: saidText,
        reaction: r,
        ts: t.ts || saidTs,
        session,
        record,
        hash: hashOf(p, saidText, r),
        // The head is a fact, outside the hash — the same slice discipline as `said`, from the other
        // end. Absent when the assistant said nothing at all.
        ...(saidRaw ? { saidHead: saidRaw.slice(0, SAID_HEAD) } : {}),
        ...(aiTerms.length ? { aiTerms } : {}),
        ...(interrupted ? { interrupted } : {}),
        ...(declined ? { declined } : {}),
        // Facts — outside the hash by construction: hashOf() is called above with the three text
        // fields and nothing else, so none of this can orphan a cached judgment.
        ...(cwd ? { project: projectOf(cwd) } : {}),
        ...(branch ? { branch } : {}),
        ...(t.images ? { images: t.images } : {}),
        ...(p.length > PASTE_BOUND || r.length > PASTE_BOUND ? { pasted: true } : {}),
        ...(tools.length ? { tools: [...tools] } : {}),
        ...(denied.length ? { denied: [...denied] } : {}),
        // Raw lengths, before CAP — the point of the field is to say how big the thing actually was.
        shape: { ask: prompt.length, said: saidRaw.length, reply: t.text.length },
      });
    }
    prompt = t.text;
    said = [];
    interrupted = undefined;
    declined = false;
    tools = []; // reset with `said` — tools belong to the answering turn that just closed
    denied = [];
  }

  // Position and rhythm — knowable only once the session is whole, which is why they are set here
  // rather than inside the loop. `gapSec` is absent on the first exchange and on any pair whose
  // timestamps do not parse: an absent fact beats a fabricated zero.
  for (let i = 0; i < out.length; i++) {
    out[i].index = i;
    out[i].ofSession = out.length;
    if (i === out.length - 1) out[i].lastOfSession = true;
    if (i === 0) continue;
    const gap = (new Date(out[i].ts).getTime() - new Date(out[i - 1].ts).getTime()) / 1000;
    if (Number.isFinite(gap) && gap >= 0) out[i].gapSec = Math.round(gap);
  }
  return out;
}

/**
 * Mark the first exchange of each working day, in place, over a list already sorted OLDEST FIRST.
 *
 * Kept out of `exchangesOfTurns` deliberately: that function only ever sees one session, and a day
 * spans sessions. `dayKey` applies the reader's 04:00 boundary, so a run past midnight stays one
 * day instead of being cut in half. Returns the same array for chaining. Exported for tests.
 */
export function markFirstOfDay(sorted: Exchange[]): Exchange[] {
  let day = '';
  for (const e of sorted) {
    const d = dayKey(e.ts);
    if (d !== day) {
      e.firstOfDay = true;
      day = d;
    }
  }
  return sorted;
}

/** One transcript's exchanges. Kept as a named seam so a single file can be parsed directly. */
export function parseExchanges(path: string): Exchange[] {
  const owner = recordFor(path);
  return exchangesOfTurns(owner.turnsOf(path), basename(path, '.jsonl'), owner.id);
}

/** A file's mtime only APPROXIMATES its newest exchange's ts, so once we have enough we read a few
 *  more sessions before trusting the boundary — cheap insurance against a wrong window edge. */
const FILE_MARGIN = 4;

/**
 * The most recent `want` exchanges. reader.ts offers sessions newest-modified first, so this stops
 * the moment it has enough plus a margin — it never walks the tail of a multi-gigabyte corpus.
 */
export function loadRecentExchanges(
  want: number,
  roots?: string[],
  opts: { fileMargin?: number } = {},
): Exchange[] {
  const fileMargin = opts.fileMargin ?? FILE_MARGIN;
  const seen = new Set<string>();
  const all: Exchange[] = [];
  let i = 0;
  let enoughAt = -1;
  for (const session of sessionsIn(roots)) {
    for (const e of exchangesOfTurns(session.turns, basename(session.path, '.jsonl'), session.record)) {
      if (seen.has(e.hash)) continue;
      seen.add(e.hash);
      all.push(e);
    }
    if (all.length >= want) {
      if (enoughAt < 0) enoughAt = i;
      if (i - enoughAt >= fileMargin) break;
    }
    i++;
  }
  all.sort((a, b) => a.ts.localeCompare(b.ts));
  // Mark BEFORE slicing: the oldest exchange left in the window is usually mid-day, and marking
  // after the slice would promote it to "first of the day" every single run.
  markFirstOfDay(all);
  return all.slice(-want);
}

/**
 * Every exchange, newest-first, one at a time — the flat-memory walk (C1) for a full-corpus read.
 * Nothing accumulates but the dedup set.
 */
export function* iterateExchangesNewestFirst(roots?: string[]): Generator<Exchange> {
  // Dedup is per (record, hash): the vault holds COPIES of one record's live sessions — those must
  // collapse — but the same words typed into two different assistants are two exchanges in two
  // relationships, and collapsing THOSE would silently hand one pair the other's evidence.
  const seen = new Set<string>();
  for (const session of sessionsIn(roots)) {
    const ex = exchangesOfTurns(session.turns, basename(session.path, '.jsonl'), session.record);
    for (let k = ex.length - 1; k >= 0; k--) {
      const key = `${session.record}\u0000${ex[k].hash}`;
      if (seen.has(key)) continue;
      seen.add(key);
      yield ex[k];
    }
  }
}

/**
 * Find one exchange by hash — the receipt path, dereferencing a judgment back to the raw words.
 *
 * The HASH is what identifies an exchange; `session` is only a hint and is deliberately not used as
 * a filter. It cannot be: `session` is now the record's own sessionId (so the live copy and the
 * archived copy of one session finally agree), while judgments cached before that change carry the
 * old filename-derived value. Matching on hash alone keeps every existing receipt dereferenceable.
 *
 * Returns undefined when the transcript is gone — the reaper took it — which the caller reports
 * honestly rather than guessing at.
 */
export function findExchange(session: string, hash: string, roots?: string[]): Exchange | undefined {
  for (const s of sessionsIn(roots)) {
    const name = basename(s.path, '.jsonl');
    // Tolerant of either naming: the file's name (what the cache stores) or the record's own
    // sessionId. A receipt written before or after this refactor dereferences the same way.
    if (name !== session && s.session !== session) continue;
    for (const e of exchangesOfTurns(s.turns, name, s.record)) if (e.hash === hash) return e;
  }
  return undefined;
}
