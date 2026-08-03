/**
 * CATEGORIES — the behaviours the engine derived, persisted as an append-only EVENT LOG.
 *
 * A category is one kind of thing the person does ("swears when lost"). The FILE ships the top few;
 * this store keeps them all, forever, because a column is mortal but its history is evidence: a
 * retired category leaves a tombstone in the log rather than vanishing, which is what makes the
 * profile auditable — the file is a PROJECTION of this log, never the log itself.
 *
 * THREE PROPERTIES, all borrowed from moments.ts on purpose:
 *
 *   1. APPEND-ONLY JSONL. Every change is a new line — never a rewrite. `born` when a category is
 *      first named, `revised` when its wording is refined, `retired` when it stops earning its keep.
 *      A torn last line from a crash mid-append fails to parse and is skipped; nothing else is lost.
 *
 *   2. THE BIRTH DATE IS IMMUTABLE. `born.at` is the one date counts and trend are computed from
 *      (frozen-once: a category only ever labels moments processed at or after it was born). A
 *      `revised` event may change the wording, never the birth — so a re-worded column keeps its
 *      history instead of resetting to "new".
 *
 *   3. THE LIVE SET IS A REPLAY. `loadCategories` folds the log: born adds, revised re-words,
 *      retired removes. Unknown event kinds are ignored, so a newer writer never breaks an older
 *      reader.
 *
 * WRITERS emit `born` (the seed script, and the engine at cold build) and — since 2026-07-30 —
 * `retired`: a cold rebuild REPLACES every assignment, so it retires the entire outgoing
 * generation before appending its own. Without that, every versioned rebuild stacked ~30 ghost
 * categories that nothing carried (measured on the reference machine: three rebuilds, 90 born,
 * 0 retired, 89 "live"). `revised` is recognised on read; its writer arrives with steady-state
 * revision.
 *
 * NO MODEL CALLS. Everything here is code. Cost is zero.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { recordDir } from './stores.js';

/** Where ONE RECORD's columns live. Categories are discovered from one assistant's moments and
 *  describe that pair only, so the store is per record — a name minted for one pair can never
 *  collide with, retire, or masquerade as another's. Override base with STRATLESS_RECORDS_DIR. */
export const categoriesPath = (record: string): string => join(recordDir(record), 'categories.jsonl');

export type CategoryEventKind = 'born' | 'revised' | 'retired';

/** One line in the log. `at` is ISO; for `born` it is the birth date the whole column is dated from. */
export interface CategoryEvent {
  event: CategoryEventKind;
  name: string;
  description: string;
  at: string;
  /** person | project — whose layer this belongs to. Set by the naming call; everything downstream
   *  only carries it. `write.ts` drops project-scoped rows, so this field is load-bearing. */
  scope?: string;
}

/** The live projection of one column: what a stage assigns and counts against. */
export interface Category {
  name: string;
  description: string;
  /** the birth date — immutable; counts and trend derive from here */
  bornAt: string;
  scope?: string;
}

/** Fold one event into the live set. born adds, revised re-words (keeping the birth), retired drops.
 *  Unknown kinds are ignored — a newer writer must never break an older reader. */
function replay(live: Map<string, Category>, ev: CategoryEvent): void {
  switch (ev.event) {
    case 'born':
      live.set(ev.name, {
        name: ev.name,
        description: ev.description,
        bornAt: ev.at,
        ...(ev.scope ? { scope: ev.scope } : {}),
      });
      break;
    case 'revised': {
      // the wording (and scope) may move; the BIRTH DATE never does — trend is computed from it.
      const cur = live.get(ev.name);
      if (cur) live.set(ev.name, { ...cur, description: ev.description, ...(ev.scope ? { scope: ev.scope } : {}) });
      break;
    }
    case 'retired':
      live.delete(ev.name);
      break;
  }
}

/** The live category set — the log folded to what is currently in play. Missing store = no columns. */
export function loadCategories(record: string, file: string = categoriesPath(record)): Category[] {
  if (!existsSync(file)) return [];
  const live = new Map<string, Category>();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let ev: CategoryEvent;
    try {
      ev = JSON.parse(line) as CategoryEvent;
    } catch {
      continue; // torn line — skip
    }
    if (!ev || typeof ev.name !== 'string' || typeof ev.event !== 'string') continue;
    replay(live, ev);
  }
  return [...live.values()];
}

/**
 * Append `born` events for a set of categories, all stamped with one birth date. The primary writer
 * is the engine's cold build (`engine.ts`), which names the piles clustering derived from the
 * person's own moments; the dev-only seed script uses it too. A single write, so a crash tears at most the boundary. Returns how many were written.
 */
export function appendCategories(
  cats: { name: string; description: string; scope?: string }[],
  opts: { record: string; file?: string; at?: string },
): number {
  const file = opts.file ?? categoriesPath(opts.record);
  const at = opts.at ?? new Date().toISOString();
  const lines = cats.map((c) =>
    JSON.stringify({
      event: 'born',
      name: c.name,
      description: c.description,
      at,
      ...(c.scope ? { scope: c.scope } : {}),
    } as CategoryEvent),
  );
  if (!lines.length) return 0;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.join('\n') + '\n');
  return lines.length;
}

/**
 * Append `retired` tombstones. The cold build calls this for the whole outgoing generation before
 * appending its own `born` events — the log keeps every tombstone (auditability), the live set
 * folds to only the current generation. Returns how many were written.
 */
export function retireCategories(names: string[], opts: { record: string; file?: string; at?: string }): number {
  const file = opts.file ?? categoriesPath(opts.record);
  const at = opts.at ?? new Date().toISOString();
  const lines = names.map((name) => JSON.stringify({ event: 'retired', name, description: '', at } as CategoryEvent));
  if (!lines.length) return 0;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.join('\n') + '\n');
  return lines.length;
}

