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
 * Nothing here is generated. Every field is quoted from the log. The judging lives in judge.ts.
 */
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { DEFAULT_ROOTS, readSessions, turnsOfFile, type Turn } from './reader.js';

/** One (AI turn → human reaction) pair. */
export interface Exchange {
  /** what the person asked that opened this turn — their words */
  prompt: string;
  /** what the assistant said back, its own words (text only; tool calls stripped) */
  said: string;
  /** how the person reacted — the next thing they said. THIS carries the signal. */
  reaction: string;
  /** ISO timestamp of the reaction (falls back to the AI turn's) */
  ts: string;
  /** which session this came from */
  session: string;
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
}

/** The parse-time cap per field — the IDENTITY layer: capped text is what gets hashed, so this
 *  number may only ever change inside a deliberate pipeline-version bump (0.3.0 raised it 4,000 →
 *  8,000 while v2 was re-judging everything anyway — free churn, and the 21% of long turns keep
 *  more real tail). Cost is unaffected: the judge's VIEW (judge.ts) bounds what a call pays for.
 *  Direction matters: prompt and reaction keep their HEAD (the ask leads, and both measure p99
 *  under 600 chars anyway), but `said` keeps its TAIL — the reaction answers the END of the
 *  assistant's turn (measured 2026-07-16). */
const CAP = 8000;

function hashOf(prompt: string, said: string, reaction: string): string {
  return createHash('sha256').update(`${prompt}\0${said}\0${reaction}`).digest('hex').slice(0, 16);
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
export function exchangesOfTurns(turns: Turn[], session: string): Exchange[] {
  const out: Exchange[] = [];
  let prompt = '';
  let said: string[] = [];
  let saidTs = '';
  let interrupted: 'plain' | 'tool-use' | undefined;
  let declined = false;

  for (const t of turns) {
    if (t.role === 'assistant') {
      if (t.ts) saidTs = t.ts;
      if (t.text) said.push(t.text);
      continue;
    }
    // Control actions are not messages — they annotate the turn in flight.
    if (t.interrupted) {
      interrupted = t.interruptKind ?? 'plain';
      continue;
    }
    if (t.denial === 'user-rejected') declined = true;
    if (!t.text) continue;

    // `said` keeps its TAIL: the reaction answers the end of the turn, not its preamble.
    const saidText = said.join('\n').trim().slice(-CAP);
    if (prompt && saidText) {
      const p = prompt.slice(0, CAP);
      const r = t.text.slice(0, CAP);
      out.push({
        prompt: p,
        said: saidText,
        reaction: r,
        ts: t.ts || saidTs,
        session,
        hash: hashOf(p, saidText, r),
        ...(interrupted ? { interrupted } : {}),
        ...(declined ? { declined } : {}),
      });
    }
    prompt = t.text;
    said = [];
    interrupted = undefined;
    declined = false;
  }
  return out;
}

/** One transcript's exchanges. Kept as a named seam so a single file can be parsed directly. */
export function parseExchanges(path: string): Exchange[] {
  return exchangesOfTurns(turnsOfFile(path), basename(path, '.jsonl'));
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
  roots: string[] = DEFAULT_ROOTS,
  opts: { fileMargin?: number } = {},
): Exchange[] {
  const fileMargin = opts.fileMargin ?? FILE_MARGIN;
  const seen = new Set<string>();
  const all: Exchange[] = [];
  let i = 0;
  let enoughAt = -1;
  for (const session of readSessions(roots)) {
    for (const e of exchangesOfTurns(session.turns, basename(session.path, '.jsonl'))) {
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
  return all.slice(-want);
}

/** How many distinct sessions the exchanges span — a headline stat, free to compute. */
export function sessionCount(exchanges: Exchange[]): number {
  return new Set(exchanges.map((e) => e.session)).size;
}

/**
 * Every exchange, newest-first, one at a time — the flat-memory walk (C1) for a full-corpus read.
 * Nothing accumulates but the dedup set.
 */
export function* iterateExchangesNewestFirst(roots: string[] = DEFAULT_ROOTS): Generator<Exchange> {
  const seen = new Set<string>();
  for (const session of readSessions(roots)) {
    const ex = exchangesOfTurns(session.turns, basename(session.path, '.jsonl'));
    for (let k = ex.length - 1; k >= 0; k--) {
      if (seen.has(ex[k].hash)) continue;
      seen.add(ex[k].hash);
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
export function findExchange(session: string, hash: string, roots: string[] = DEFAULT_ROOTS): Exchange | undefined {
  for (const s of readSessions(roots)) {
    const name = basename(s.path, '.jsonl');
    // Tolerant of either naming: the file's name (what the cache stores) or the record's own
    // sessionId. A receipt written before or after this refactor dereferences the same way.
    if (name !== session && s.session !== session) continue;
    for (const e of exchangesOfTurns(s.turns, name)) if (e.hash === hash) return e;
  }
  return undefined;
}
