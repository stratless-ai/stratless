/**
 * CODEX CLI — the second adapter and the proof the seam is tool-neutral.
 *
 * Also tier `both`, with one measured caveat: Codex writes the same event when a person rejects an
 * approval and when they stop a running command. A Codex decline therefore means "the person
 * stopped this tool call", slightly broader than Claude Code's and comparable within this pair,
 * never across assistants.
 */
import { existsSync } from 'node:fs';
import type { Adapter } from '../../contracts.js';
import { driftCheck, readSessions, roots, turnsOfFile } from './record.js';
import { arm, disarm, groupsAfterOurs, protect, state } from './rhythm.js';
import { loadInto, loaded, unload } from './load.js';

export const codex: Adapter = {
  id: 'codex',
  displayName: 'Codex',
  record: {
    id: 'codex', displayName: 'Codex', tier: 'both',
    detect: () => roots().some((root) => existsSync(root)),
    roots,
    sessions: (found?: string[]) => readSessions(found ?? roots()),
    turnsOf: (path: string, seen?: Set<string>) => turnsOfFile(path, seen),
    health: (found?: string[]) => driftCheck(found ?? roots()),
    // Codex writes no session titles; surfaces that use them must honestly say less.
  },
  rhythm: {
    // Codex gates hooks behind its own trust review. arm() writes the hook but only the person's
    // approval makes it live; protect() is a copy against manual deletion, not a reaper stop.
    arm,
    state,
    disarm: () => {
      // Codex keys trust by hook position. Removing ours shifts every group added after it, so
      // measure the impact before the file changes and tell the person what Codex will ask next.
      const shifted = groupsAfterOurs();
      const removed = disarm();
      return {
        removed,
        warnings: removed && shifted
          ? [`Codex will ask you to re-approve ${shifted} SessionEnd hook${shifted === 1 ? '' : 's'} added after stratless because removing ours changed ${shifted === 1 ? 'its' : 'their'} position.`]
          : [],
      };
    },
    protect,
  },
  // A copy, because Codex expands no import syntax. Every successful build rewrites it so the
  // profile cannot silently age behind the artifact.
  load: { load: loadInto, loaded, unload },
};
