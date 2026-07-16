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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { hasToolResult, isRealPrompt, textOf } from './transcript.js';

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

/** Parse one session transcript into its (AI turn → human reaction) pairs. */
export function parseExchanges(path: string): Exchange[] {
  const out: Exchange[] = [];
  const session = basename(path, '.jsonl');

  let prompt = ''; // the human message that opened the current turn
  let said: string[] = []; // assistant text accumulated since then
  let saidTs = '';

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue; // a truncated final line is normal; skip it
    }
    if (d.isSidechain || d.isMeta) continue; // subagents aren't the person's conversation

    const content = d.message?.content;

    if (d.type === 'user') {
      if (hasToolResult(content)) continue; // tool output, not the human
      const s = textOf(content).trim();
      if (!isRealPrompt(s)) continue;

      // The human just spoke: close the turn that was open. It only counts if the person had
      // asked something AND the assistant actually said something back — a turn where the
      // assistant only ran tools has no understanding to transfer, so there's nothing to judge.
      // `said` keeps its TAIL (slice(-CAP)): the reaction answers the end, not the preamble.
      const saidText = said.join('\n').trim().slice(-CAP);
      if (prompt && saidText) {
        const p = prompt.slice(0, CAP);
        const r = s.slice(0, CAP);
        out.push({ prompt: p, said: saidText, reaction: r, ts: d.timestamp ?? saidTs, session, hash: hashOf(p, saidText, r) });
      }
      prompt = s;
      said = [];
      continue;
    }

    if (d.type !== 'assistant' || !Array.isArray(content)) continue;
    if (d.timestamp) saidTs = d.timestamp;
    for (const b of content) {
      if (typeof b === 'object' && b !== null && b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        said.push(b.text.trim());
      }
    }
  }
  return out;
}

const PROJECTS = join(homedir(), '.claude', 'projects');
const ARCHIVE = join(homedir(), '.stratless', 'archive');

/** Every .jsonl under a root, at any depth (subagent transcripts nest). */
export function allJsonl(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allJsonl(p, out);
    else if (name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

/** Hard ceiling on bytes read in one pass. The profile only needs the recent window, and reading the
 *  whole corpus (which can be many gigabytes) just to keep the last few hundred is what hung low-memory
 *  machines. This bounds peak memory no matter how the history is shaped. */
const CAP_BYTES = 96 * 1024 * 1024;
/** A file's mtime only APPROXIMATES its newest exchange's ts, so once we have enough we read a few more
 *  files before trusting the boundary — cheap insurance against a slightly-wrong window edge. */
const FILE_MARGIN = 4;

/**
 * The most recent `want` exchanges, loaded CHEAPLY — newest transcripts first, stopping the moment we
 * have enough. The profile is a model of a PERSON across the whole corpus, but it only ever needs the
 * recent window (see JUDGE_WINDOW in index.ts); the corpus itself can be thousands of files and gigabytes.
 * Reading ALL of it just to keep the last 200 is what took machines down. This touches only the handful of
 * most-recently-written transcripts it takes to fill `want`, bounded hard by CAP_BYTES — never the tail.
 *
 * `roots` defaults to the live logs (`~/.claude/projects`, which `init` keeps the reaper from thinning)
 * unioned with the archive (`~/.stratless/archive`); the same session in both dedupes by content hash.
 * It is a parameter so tests can point the loader at a temp dir.
 */
export function loadRecentExchanges(
  want: number,
  roots: string[] = [PROJECTS, ARCHIVE],
  opts: { capBytes?: number; fileMargin?: number } = {},
): Exchange[] {
  const capBytes = opts.capBytes ?? CAP_BYTES;
  const fileMargin = opts.fileMargin ?? FILE_MARGIN;
  // newest-modified transcripts first — their tails hold the newest exchanges
  const files = roots
    .flatMap((r) => allJsonl(r))
    .map((p) => {
      try {
        const s = statSync(p);
        return { p, mtime: s.mtimeMs, size: s.size };
      } catch {
        return { p, mtime: 0, size: 0 };
      }
    })
    .sort((a, b) => b.mtime - a.mtime);

  const seen = new Set<string>();
  const all: Exchange[] = [];
  let bytes = 0;
  let enoughAt = -1;
  for (let i = 0; i < files.length; i++) {
    if (bytes >= capBytes) break; // memory backstop — never read more than this in one pass
    bytes += files[i].size;
    let ex: Exchange[];
    try {
      ex = parseExchanges(files[i].p);
    } catch {
      continue; // one unreadable file must not sink the whole read
    }
    for (const e of ex) {
      if (seen.has(e.hash)) continue;
      seen.add(e.hash);
      all.push(e);
    }
    if (all.length >= want) {
      if (enoughAt < 0) enoughAt = i;
      if (i - enoughAt >= fileMargin) break; // have enough + a margin — stop before the archive tail
    }
  }
  all.sort((a, b) => a.ts.localeCompare(b.ts));
  return all.slice(-want);
}

/** How many distinct sessions the exchanges span — a headline stat, free to compute. */
export function sessionCount(exchanges: Exchange[]): number {
  return new Set(exchanges.map((e) => e.session)).size;
}
