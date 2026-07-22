/**
 * CATEGORIES — the columns of the discovery spreadsheet, persisted as an append-only EVENT LOG.
 *
 * A category is one kind of thing the person does ("swears when lost"). The FILE ships the top few;
 * this store keeps them all, forever, because a column is mortal but its history is evidence: a
 * retired category leaves a tombstone in the log rather than vanishing, which is what makes the
 * profile auditable (see the discovery design, "THE FILE IS A PROJECTION").
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
 * WRITERS only ever emit `born` today (the seed script, and discovery at cold start). `revised` and
 * `retired` are recognised on read so the format is settled ahead of any writer — but nothing emits
 * them yet: cold start ships only the survivors, so a pruned category is never written, never a
 * tombstone. A writer arrives when steady-state revision does.
 *
 * NO MODEL CALLS. Everything here is code. Cost is zero.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Where the columns live. Override with STRATLESS_CATEGORIES (tests). */
const storePath = (): string =>
  process.env.STRATLESS_CATEGORIES || join(homedir(), '.stratless', 'categories.jsonl');

export type CategoryEventKind = 'born' | 'revised' | 'retired';

/** One line in the log. `at` is ISO; for `born` it is the birth date the whole column is dated from. */
export interface CategoryEvent {
  event: CategoryEventKind;
  name: string;
  description: string;
  at: string;
  /** person | project — whose layer this belongs to. Set at discovery; stage 2 only carries it. */
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
export function loadCategories(file: string = storePath()): Category[] {
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
 * is discover (stage 3), which mints categories from the person's own pile; the dev-only seed script
 * uses it too. A single write, so a crash tears at most the boundary. Returns how many were written.
 */
export function appendCategories(
  cats: { name: string; description: string; scope?: string }[],
  opts: { file?: string; at?: string } = {},
): number {
  const file = opts.file ?? storePath();
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

