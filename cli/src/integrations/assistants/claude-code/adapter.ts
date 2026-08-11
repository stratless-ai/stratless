/**
 * CLAUDE CODE — the reference adapter, assembled from its Record, Rhythm, and Load legs.
 *
 * Tier `both`: its transcripts carry what the assistant did and what the person refused, which lets
 * the pair profile speak about declines and offers that were met rather than words alone.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Adapter, ArmState } from '../../contracts.js';
import { archiveRoot } from '../../../storage/paths.js';
import { driftCheck, readSessions, readTitles, roots, turnsOfFile } from './record.js';
import { archiveTranscripts, refreshArmed, stopRefresh, writeSettings } from './rhythm.js';
import { claudeMdPath, loadInto, removeProfile } from './load.js';

const hasFlatTranscript = (dir: string): boolean => {
  try {
    return readdirSync(dir, { withFileTypes: true }).some((entry) => entry.isFile() && entry.name.endsWith('.jsonl'));
  } catch {
    return false;
  }
};

const loaded = (): boolean => {
  try {
    return existsSync(claudeMdPath()) && readFileSync(claudeMdPath(), 'utf8').includes('<!-- stratless:start -->');
  } catch {
    return false;
  }
};

export const claudeCode: Adapter = {
  id: 'claude-code',
  displayName: 'Claude Code',
  record: {
    id: 'claude-code', displayName: 'Claude Code', tier: 'both',
    // History is the honest detection signal, not whether the binary remains installed. The shared
    // archive root alone is insufficient: a Codex-only archive creates it too, which once made us
    // falsely detect Claude Code and write ~/.claude/settings.json on a machine that never had it.
    // Only Claude's live project directory or one of its own flat archived transcripts counts.
    detect: () => existsSync(join(homedir(), '.claude', 'projects')) || hasFlatTranscript(archiveRoot()),
    roots,
    sessions: (found?: string[]) => readSessions(found ?? roots()),
    turnsOf: (path: string, seen?: Set<string>) => turnsOfFile(path, seen),
    health: (found?: string[]) => driftCheck(found ?? roots()),
    titles: readTitles,
  },
  rhythm: {
    // Claude Code has no hook trust gate: a Stop hook written into settings.json is live next
    // session, so this adapter never reports `awaiting-approval`.
    arm: (): ArmState => { writeSettings(); return refreshArmed() ? 'armed' : 'off'; },
    state: (): ArmState => (refreshArmed() ? 'armed' : 'off'),
    disarm: () => ({ removed: stopRefresh(), warnings: [] }),
    protect: () => {
      // The reaper setting and hook land in one settings write; only protect pays for the archive
      // walk. Keeping those jobs separate avoids walking every transcript twice during init.
      const { before, after } = writeSettings();
      const { copied, skipped } = archiveTranscripts();
      return { copied, skipped, reaper: { before, after } };
    },
  },
  load: {
    // A pointer: Claude Code follows the import, so later profile rebuilds need not rewrite this
    // file. Only our marked block is ever touched.
    load: () => (loadInto().claudeMd ? claudeMdPath() : undefined),
    loaded,
    unload: removeProfile,
  },
  // The pack leg: Claude Code discovers <name>/SKILL.md dirs here, live, no approval step.
  skillsDir: () => join(homedir(), '.claude', 'skills'),
};
