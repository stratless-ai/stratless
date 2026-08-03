/**
 * VOICED — the write-side voice cache: voice once, re-stamp forever.
 *
 * A profile row is two substances fused: the WORDS (the model's — the instruction line, the
 * section routing, the decode signal, the register quote-gate) and the NUMBERS (arithmetic —
 * counts, trends, met/slip, ordering, budget). Before this store, the words were re-asked of the
 * model on every rebuild: ~$0.08 and ~15s per flush for zero new information, and the known
 * write-side wobble — an unchanged category could flip sections, reword its line, or silently
 * drop its decode entry between two builds on near-identical data. Now the words FREEZE the
 * first time they are written (the patch discipline, applied to ADAPT rows) and every later
 * rebuild is pure assembly: the numbers stay alive, the words do not move, and a steady-state
 * daily update costs nothing.
 *
 * IDENTITY IS name + bornAt, never name alone. Names collide across generations (the model
 * reliably re-mints the same kebab name for the same recurring pile), and the category log folds
 * last-writer-wins — a name-keyed cache would serve one pile's voice for a different pile's
 * evidence. `bornAt` is the generation stamp (a cold rebuild retires the whole generation and
 * births its successor on one timestamp), so a reborn name is a NEW column and gets a fresh
 * voice, once, at the rebuild where the naming call already pays. Voices deliberately do NOT
 * survive cold rebuilds.
 *
 * WHAT COUNTS AS A MISS (voicingPlan):
 *   · no cached row for (name, bornAt) — never voiced, or a new generation;
 *   · a register row whose cached quote text is no longer among the current candidates — the
 *     gate lost its proof, so that ONE row re-voices (the quote is a proof token, never printed;
 *     it is cached as TEXT because candidate lists shift whenever one assignment lands, so a
 *     stored index would point at the wrong quote).
 * A cached `none` is NOT a miss: the router's rejection is a real answer, cached like any other —
 * otherwise every rejected category re-bills forever. A category the model simply failed to
 * answer is never cached and retries next flush (the lift discipline).
 *
 * NO MODEL CALLS HERE. This store only remembers what one was paid for.
 */
import { join } from 'node:path';
import { recordDir } from './stores.js';
import { readFileSync } from 'node:fs';

import { atomicWriteFileSync } from './atomic.js';

/** Per record: a voice is the wording of ONE pair's category, so the cache lives on that pair's
 *  shelf. This also ends two hazards the shared file had — two records minting the same kebab name
 *  colliding on one row, and one record's prune deleting the other's paid-for voices. */
export const voicedPath = (record: string): string => join(recordDir(record), 'voiced.json');

/** Kept as a local union (write.ts imports this module, so importing its Section back would
 *  close a cycle). 'none' is the router's real answer: this behaviour fits no section. */
export type VoicedSection = 'frame' | 'judge' | 'register' | 'none';

export interface VoicedRow {
  name: string;
  /** the generation stamp — identity is (name, bornAt); see the header */
  bornAt: string;
  section: VoicedSection;
  /** the row's printed instruction — voiced once, never re-rolled ('' for none) */
  line: string;
  /** the decode-key signal ('' when the model offered none) */
  signal: string;
  /** the register gate's proof token, as TEXT ('' for frame/judge/none) */
  quote: string;
  voicedAt: string;
}

interface VoicedStore {
  rows: VoicedRow[];
}

/** Defensive read — corrupt input degrades to empty, never throws (the renders.json discipline).
 *  A lost cache costs one re-voicing, never a lie. */
export function readVoiced(record: string, file: string = voicedPath(record)): VoicedStore {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { rows?: unknown };
    if (!Array.isArray(raw.rows)) return { rows: [] };
    const rows: VoicedRow[] = [];
    for (const r of raw.rows) {
      if (typeof r !== 'object' || r === null) continue;
      const o = r as Record<string, unknown>;
      if (typeof o.name !== 'string' || typeof o.bornAt !== 'string') continue;
      if (o.section !== 'frame' && o.section !== 'judge' && o.section !== 'register' && o.section !== 'none') continue;
      if (typeof o.line !== 'string' || typeof o.signal !== 'string' || typeof o.quote !== 'string') continue;
      rows.push({
        name: o.name,
        bornAt: o.bornAt,
        section: o.section,
        line: o.line,
        signal: o.signal,
        quote: o.quote,
        voicedAt: typeof o.voicedAt === 'string' ? o.voicedAt : '',
      });
    }
    return { rows };
  } catch {
    return { rows: [] };
  }
}

export function writeVoiced(store: VoicedStore, record: string, file: string = voicedPath(record)): void {
  atomicWriteFileSync(file, JSON.stringify(store, null, 1));
}

const keyOf = (name: string, bornAt: string): string => `${name}\u0000${bornAt}`;

/** What buildProfile hands in per category, and what the plan reads of it. */
export interface VoiceWork {
  name: string;
  /** the category's generation stamp */
  bornAt: string;
  /** current quote candidates (reply texts) — the register proof is re-validated against these */
  candidateReplies: string[];
}

export interface VoicingPlan {
  /** cache hits, ready for assembly — keyed by category name */
  reuse: Map<string, VoicedRow>;
  /** categories that must be voiced this build (no row, or the register proof was lost) */
  missing: string[];
}

/**
 * The split decision, pure: which categories assemble from the cache and which must be paid for.
 * See the header for the miss rules. Rows from dead generations are simply never matched — the
 * prune below removes them from disk.
 */
export function voicingPlan(work: VoiceWork[], store: VoicedStore): VoicingPlan {
  const byKey = new Map(store.rows.map((r) => [keyOf(r.name, r.bornAt), r]));
  const reuse = new Map<string, VoicedRow>();
  const missing: string[] = [];
  for (const w of work) {
    const row = byKey.get(keyOf(w.name, w.bornAt));
    if (!row) {
      missing.push(w.name);
      continue;
    }
    if (row.section === 'register' && !w.candidateReplies.includes(row.quote)) {
      missing.push(w.name); // the gate lost its proof — this one row re-voices
      continue;
    }
    reuse.set(w.name, row);
  }
  return { reuse, missing };
}

/** Persist newly voiced rows and prune to the live generation set — the cache self-cleans when a
 *  cold rebuild retires a generation. Writes only when something moved. */
export function rememberVoiced(
  newRows: VoicedRow[],
  liveKeys: { name: string; bornAt: string }[],
  record: string,
  file: string = voicedPath(record),
): void {
  const store = readVoiced(record, file);
  const live = new Set(liveKeys.map((k) => keyOf(k.name, k.bornAt)));
  const kept = store.rows.filter((r) => live.has(keyOf(r.name, r.bornAt)));
  const have = new Set(kept.map((r) => keyOf(r.name, r.bornAt)));
  const added = newRows.filter((r) => live.has(keyOf(r.name, r.bornAt)) && !have.has(keyOf(r.name, r.bornAt)));
  if (!added.length && kept.length === store.rows.length) return; // nothing moved
  writeVoiced({ rows: [...kept, ...added] }, record, file);
}
