/**
 * ASSIGNMENTS — the store that says which behaviour each moment carries. Once the paid stage; now
 * pure storage.
 *
 * v2 spent here: it asked a borrowed model "is this category present in this moment?" for every
 * moment against every category — ~190,000 judgements, $20.40 and forty minutes on a cold build. The
 * engine (`engine.ts`) replaced that with arithmetic on this machine: `cluster.ts` groups the
 * fingerprints, one small call names the groups, and the answer lands here. THE MODEL CALL IS GONE
 * FROM THIS FILE. What remains is the store, which four modules read.
 *
 * THE STORE — `assignments.jsonl`, append-only, keyed by the moment's content hash:
 *
 *   · ONE RECORD PER MOMENT, WRITTEN ONCE. A moment already in the store is never re-placed — the
 *     frozen-once rule (a pattern born later never relabels an old moment; the store IS the
 *     enforcement). A cold build writes the whole pile once; every run after writes only what is new.
 *
 *   · AN EMPTY `kinds: []` IS A REAL RECORD. It means "looked, matched nothing", which is different
 *     from "not looked at yet". Without it a zero-yield moment would be re-examined every run.
 *
 * NO MODEL CALLS. Everything here is disk. Cost is zero.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { recordDir } from '../storage/stores.js';
import { loadMoments, type Moment } from './moments.js';

/** Where ONE RECORD's checkmarks live. An assignment pins a moment to a category, and both sides
 *  of that pin belong to one pair — the moment carries its record, the category was minted from
 *  that record's pile. Per-record files make cross-record placement unrepresentable. */
export const assignmentsPath = (record: string): string => join(recordDir(record), 'assignments.jsonl');

/** One frozen checkmark row. `at` is when it was assigned — with a category's birth date, the two
 *  timestamps are the entire frozen-once rule. */
export interface Assignment {
  key: string;
  at: string;
  kinds: string[];
}

/** Every stored assignment, in file order. Torn lines (a crash mid-append) are skipped. */
export function loadAssignments(record: string, file: string = assignmentsPath(record)): Assignment[] {
  if (!existsSync(file)) return [];
  const out: Assignment[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as Assignment);
    } catch {
      /* torn line — skip */
    }
  }
  return out;
}

/** The keys already assigned — the seen-set that stops a moment being shown (and billed) twice. */
export function assignedKeys(record: string, file: string = assignmentsPath(record)): Set<string> {
  return new Set(loadAssignments(record, file).map((a) => a.key));
}

/** The moments collected but not yet assigned — the "waiting" set the flush gate inspects, and
 *  exactly the work the engine places next run (engine.ts `grow`). */
export function pendingMoments(record: string, file: string = assignmentsPath(record)): Moment[] {
  // BOTH sides scoped to the record: its own store's seen-set, over its own slice of the pile. A
  // filter on the seen-set alone would report every other assistant's moment as forever-pending here.
  const seen = assignedKeys(record, file);
  return loadMoments().filter((m) => m.record === record && !seen.has(m.key));
}

/**
 * Write checkmarks. One write per call, so a crash tears at most a call boundary — never between two
 * records of the same call.
 *
 * `replace` TRUNCATES FIRST, and a cold build must use it. `count.join()` emits one row per
 * assignment RECORD, so a moment holding two records is counted twice and every number in the
 * profile inflates. That happens the moment a cold build appends onto a store that already has rows
 * — an upgrade from a previous engine, or any second cold build. A cold build establishes the whole
 * assignment set, so replacing is the honest semantic; growth appends.
 */
export function writeAssignments(
  records: Assignment[],
  record: string,
  file: string = assignmentsPath(record),
  mode: 'append' | 'replace' = 'append',
): void {
  if (!records.length && mode === 'append') return;
  mkdirSync(dirname(file), { recursive: true });
  const data = records.length ? records.map((r) => JSON.stringify(r)).join('\n') + '\n' : '';
  if (mode === 'replace') writeFileSync(file, data);
  else appendFileSync(file, data);
}
