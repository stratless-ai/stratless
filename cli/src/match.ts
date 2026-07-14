/**
 * Find the decision that made this line.
 *
 * The line is still sitting in your file right now — so we don't reconstruct history, we go
 * looking for it. Every edit the assistant ever wrote is in the archive; the most recent one
 * that contains this line is the one that made it what it is.
 *
 * TWO INDEPENDENT WITNESSES:
 *   1. content   — the line's text appears in an edit's body
 *   2. git blame — the commit that last touched the line, and when
 * If they agree, we're confident. If they disagree, we say so. If neither speaks, we refuse.
 *
 * WE NEVER GENERATE. If we can't find it, we say we can't find it. A confident answer about a
 * line we didn't actually match is the one failure that would end this product, so the code is
 * built to make it impossible rather than unlikely.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Edit } from './transcript.js';

export type Verdict =
  /** we found the edit, and git blame agrees */
  | 'matched'
  /** we found a plausible edit, but the witnesses don't corroborate each other */
  | 'likely'
  /** no edit contains this line — you wrote it yourself */
  | 'yours'
  /** the line predates the archive. the transcript that explains it was DELETED. */
  | 'lost';

export interface Answer {
  verdict: Verdict;
  line: string;
  /** 0..1 — share of the anchor found in the winning edit */
  confidence: number;
  edit?: Edit;
  /** what git blame says, if the file is committed */
  blame?: { sha: string; date: string; summary: string };
  /** why we widened, refused, or hedged — always shown, never hidden */
  note?: string;
}

/**
 * A line worth matching on. Punctuation and boilerplate anchor nothing.
 *
 * NOTE: this must NOT exclude `export const X = 48_000` — declarations and thresholds are
 * exactly the consequential lines people ask about. An earlier version filtered any short
 * `export` and silently degraded every constant in the codebase to "too generic to trace".
 * Only bare re-exports and short imports are genuinely un-anchorable.
 */
function isAnchorable(line: string): boolean {
  const t = line.trim();
  if (t.length < 12) return false; // `}`, `);`, `else {`, blank — anchors nothing
  if (/^[{}()[\];,.]+$/.test(t)) return false;
  const isDeclaration = /=|\(|:/.test(t); // has a value, call, or type — it says something
  if (/^(import|export)\s/.test(t) && !isDeclaration && t.length < 60) return false;
  return true;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Build an anchor: the target line plus surrounding context, keeping only lines substantive
 * enough to identify a location. Widens until it has enough to be sure, or gives up honestly.
 */
function buildAnchor(lines: string[], lineNo: number): { anchor: string[]; widened: boolean } {
  const idx = lineNo - 1;
  const target = lines[idx] ?? '';
  let widened = false;

  const collect = (radius: number) => {
    const lo = Math.max(0, idx - radius);
    const hi = Math.min(lines.length, idx + radius + 1);
    return lines.slice(lo, hi).filter(isAnchorable).map(norm);
  };

  // If the target line itself can't anchor, we're now describing the surrounding block —
  // and we must SAY so, because the user asked about line N, not the block.
  if (!isAnchorable(target)) widened = true;

  for (const radius of [2, 5, 10, 20]) {
    const anchor = collect(radius);
    if (anchor.length >= 2) return { anchor, widened: widened || radius > 2 };
  }
  return { anchor: collect(20), widened: true };
}

function gitBlame(file: string, lineNo: number, cwd: string): Answer['blame'] {
  try {
    const out = execFileSync(
      'git',
      ['blame', '-L', `${lineNo},${lineNo}`, '--porcelain', '--', file],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const sha = out.slice(0, 40);
    const t = /^author-time (\d+)$/m.exec(out);
    const s = /^summary (.+)$/m.exec(out);
    if (!t) return undefined;
    const date = new Date(Number(t[1]) * 1000).toISOString().slice(0, 10);
    return { sha: sha.slice(0, 8), date, summary: s?.[1] ?? '' };
  } catch {
    return undefined; // uncommitted, not a repo, or the line moved — all fine, we just lose a witness
  }
}

/** The earliest transcript we have. Anything older than this was eaten by the 30-day reaper. */
function archiveFloor(edits: Edit[]): string {
  return edits.length ? edits[0].date : '9999-99-99';
}

export function why(file: string, lineNo: number, edits: Edit[], cwd: string): Answer {
  const abs = resolve(cwd, file);
  const lines = readFileSync(abs, 'utf8').split('\n');
  if (lineNo < 1 || lineNo > lines.length) {
    throw new Error(`${file} has ${lines.length} lines; you asked for ${lineNo}.`);
  }
  const line = (lines[lineNo - 1] ?? '').trim();
  const { anchor, widened } = buildAnchor(lines, lineNo);
  const blame = gitBlame(file, lineNo, cwd);

  if (anchor.length === 0) {
    return {
      verdict: 'yours',
      line,
      confidence: 0,
      blame,
      note: 'nothing here is distinctive enough to trace — try a line inside the function.',
    };
  }

  // Which edit DECIDED this line?
  //
  // git blame is the authority on WHEN a line became what it is — it names the commit that
  // last *changed* it. A later edit that rewrote the file but reproduced this line unchanged
  // did not decide anything; blame will still point at the older commit. So:
  //
  //   with blame  -> the latest matching edit AT OR BEFORE the blame date. That's the
  //                  conversation that actually made the line; anything after merely copied it.
  //   no blame    -> (uncommitted, or the file isn't in git) fall back to most-recent-wins.
  //
  // Getting this backwards points the user at the wrong conversation with full confidence,
  // which is exactly the failure this whole module exists to prevent.
  const candidates: { score: number; edit: Edit }[] = [];
  for (const e of edits) {
    if (resolve(cwd, e.file) !== abs) continue;
    const body = norm(e.body);
    const hits = anchor.filter((a) => body.includes(a)).length;
    if (hits > 0) candidates.push({ score: hits / anchor.length, edit: e });
  }

  const pick = (pool: typeof candidates) =>
    pool.reduce<(typeof candidates)[number] | undefined>(
      (acc, c) => (!acc || c.score >= acc.score ? c : acc),
      undefined,
    );

  // `edits` is oldest-first, so `>=` keeps the LATEST among equally-scoring candidates.
  const inWindow = blame ? candidates.filter((c) => c.edit.date <= blame.date) : candidates;
  let best = pick(inWindow);
  let staleBlame = false;
  if (!best && candidates.length) {
    // Every matching edit postdates the blame commit — the work is written but not yet
    // committed under that line, so blame is stale. Use the content witness and say so.
    best = pick(candidates);
    staleBlame = true;
  }

  if (!best) {
    // Nothing in the archive wrote this. Either you did — or the transcript was deleted.
    const floor = archiveFloor(edits);
    if (blame && blame.date < floor) {
      return {
        verdict: 'lost',
        line,
        confidence: 0,
        blame,
        note: `committed ${blame.date}, but the archive only reaches back to ${floor}. The conversation that explains this line was deleted by the 30-day cleanup.`,
      };
    }
    return { verdict: 'yours', line, confidence: 0, blame, note: 'no assistant edit contains this. you wrote it.' };
  }

  // Two witnesses. Do they corroborate?
  const corroborated = !staleBlame;
  const strong = best.score >= 0.6;

  const notes: string[] = [];
  if (widened) notes.push('this line alone is too generic to trace, so this describes the block around it');
  if (staleBlame)
    notes.push(
      `git still attributes this line to ${blame!.date}, before any edit that matches it — the change is likely uncommitted`,
    );
  if (!strong) notes.push(`only ${Math.round(best.score * 100)}% of the surrounding code matched — a lead, not a fact`);

  return {
    verdict: strong && corroborated && !widened ? 'matched' : 'likely',
    line,
    confidence: best.score,
    edit: best.edit,
    blame,
    note: notes.length ? notes.join('; ') : undefined,
  };
}
