/**
 * THE REGISTRY — which assistants stratless knows how to read, and which of them are on this machine.
 *
 * Adapters are COMPILED IN, not installed. Adding one is a new file and one line here, in a pull
 * request someone reviews; it is never a package a stranger publishes. That is a trust decision
 * before it is an architectural one: this tool reads a person's entire conversation history, so the
 * set of code allowed to touch that history stays small enough to audit in an afternoon, and stays
 * ours. The zero-runtime-dependency rule and this rule are the same rule.
 *
 * `detect()` is what makes it feel like a plugin anyway — nobody configures anything. An assistant
 * whose history is on the disk is read; one that is not present costs nothing and says nothing.
 *
 * The engine talks to this module, never to a tool's reader. That is the whole point of the seam:
 * `moments`, `asks`, `exchange` and `mirror` ask for sessions and get `Turn`s, with no idea which
 * vault they came out of.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';

import type { Adapter, ArmState, DriftReport, LoadAdapter, RecordAdapter, Session, Turn } from './seam.js';
import { archiveRoot, driftCheck, readSessions, readTitles, roots as claudeRoots, turnsOfFile } from './record-claude-code.js';
import {
  driftCheck as codexDrift,
  readSessions as codexSessions,
  roots as codexRoots,
  turnsOfFile as codexTurnsOf,
} from './record-codex.js';
import { archiveTranscripts, refreshArmed, stopRefresh, writeSettings } from './rhythm-claude-code.js';
import { claudeMdPath, loadInto as claudeLoad, removeProfile } from './load-claude-code.js';
import { loadInto as codexLoad, loaded as codexLoaded, unload as codexUnload } from './load-codex.js';
import { arm as codexArm, disarm as codexDisarm, protect as codexProtect, state as codexState } from './rhythm-codex.js';
import { existsSync as fileExists, readFileSync } from 'node:fs';

/**
 * CLAUDE CODE — the reference adapter, and the one every other is measured against.
 *
 * Tier `both`: its transcripts carry what the assistant did AND what the person refused, which is
 * what lets the profile speak about declines and about offers that were met rather than only about
 * words. A tool recording less is not worse to support; it just constrains what may be claimed.
 */
const claudeCode: Adapter = {
  id: 'claude-code',
  displayName: 'Claude Code',
  record: {
    id: 'claude-code',
    displayName: 'Claude Code',
    tier: 'both',
    // The history existing is the honest test. The BINARY being installed is a different question
    // (that one is about borrowing the model), and answering it here would make a person who
    // uninstalled the app invisible to their own archive.
    //
    // But NOT "any of my roots exists": one of them is the shared vault, and a Codex-only machine
    // creates that the moment Codex archives anything — which made Claude Code detect as present on
    // a machine that has never had it, and `init` then wrote a settings.json for it. The vault only
    // counts when it holds one of THIS Record's own flat transcripts.
    detect: () => existsSync(join(homedir(), '.claude', 'projects')) || hasFlatTranscript(archiveRoot()),
    roots: claudeRoots,
    sessions: (r?: string[]) => readSessions(r ?? claudeRoots()),
    turnsOf: (path: string, seen?: Set<string>) => turnsOfFile(path, seen),
    health: (r?: string[]) => driftCheck(r ?? claudeRoots()),
    titles: readTitles,
  },
  rhythm: {
    // Claude Code has no trust gate on hooks: a Stop hook written into settings.json is live for the
    // next session. So this never returns 'awaiting-approval' — the state exists for tools that ask
    // the person first, and a machine with only Claude Code behaves exactly as it always has.
    arm: (): ArmState => {
      writeSettings();
      return refreshArmed() ? 'armed' : 'off';
    },
    state: (): ArmState => (refreshArmed() ? 'armed' : 'off'),
    disarm: stopRefresh,
    // The reaper stop and the hook land in ONE settings write, so both legs call it; only `protect`
    // pays for the archive walk. Calling the whole `init` ceremony from each would walk every
    // transcript twice.
    protect: () => {
      const { before, after } = writeSettings();
      const { copied, skipped } = archiveTranscripts();
      return { copied, skipped, reaper: { before, after } };
    },
  },
  // A POINTER: the block holds one `@import` line, so a rebuilt profile is picked up without this
  // file being touched again. `load` upserts unconditionally, which is the behaviour that shipped;
  // the deliberate no-add case is `reaimIfLoaded`, used only when the artifact itself moves.
  load: {
    load: () => (claudeLoad().claudeMd ? claudeMdPath() : undefined),
    loaded: () => blockPresent(claudeMdPath()),
    unload: removeProfile,
  },
};

/**
 * CODEX CLI — the second Record, and the proof the seam was drawn in the right place.
 *
 * Also tier `both`: its rollouts carry the assistant's calls and attributable refusals. One caveat
 * travels with that word — Codex writes the same event when a person rejects an approval and when
 * they stop a command already running, so a Codex decline means "the person stopped this tool call",
 * slightly broader than Claude's. Comparable within a tool, not across them (see `record-codex.ts`).
 *
 * Its RHYTHM is not built yet, so it declares itself unarmed rather than pretending: a machine with
 * only Codex collects nothing automatically until the hook lands. `protect` is absent because Codex
 * has no reaper — its history does not expire and there is nothing to rescue.
 */
const codex: Adapter = {
  id: 'codex',
  displayName: 'Codex',
  record: {
    id: 'codex',
    displayName: 'Codex',
    tier: 'both',
    detect: () => codexRoots().some((r) => existsSync(r)),
    roots: codexRoots,
    sessions: (r?: string[]) => codexSessions(r ?? codexRoots()),
    turnsOf: (path: string, seen?: Set<string>) => codexTurnsOf(path, seen),
    health: (r?: string[]) => codexDrift(r ?? codexRoots()),
    // no `titles`: Codex writes no session titles, so the surfaces that read them simply say less
  },
  rhythm: {
    // Codex gates hooks behind its OWN trust review, so arming writes the file and the person's yes
    // is what makes it live — `arm()` returning 'awaiting-approval' is the normal, correct outcome
    // here, not a failure.
    arm: codexArm,
    state: codexState,
    disarm: codexDisarm,
    // A copy against a manual `codex delete`, not a rescue from a timer: Codex has no reaper, so
    // `reaperStopped` stays absent and nothing may claim one was stopped.
    protect: codexProtect,
  },
  // A COPY, because Codex expands no import syntax — so this MUST be rewritten on every build or
  // the person reads yesterday's profile with no sign anything is wrong. `agentsMdPath` resolves
  // the shadow rule (an `AGENTS.override.md` replaces `AGENTS.md` outright).
  load: {
    load: () => codexLoad(),
    loaded: () => codexLoaded(),
    unload: () => codexUnload(),
  },
};

/** Every assistant stratless can read. Order is stable and meaningful: the first present Record is
 *  the one a single-source surface reads. */
export const registry: readonly Adapter[] = [claudeCode, codex];

/** The ones actually on this machine. */
export function detect(): Adapter[] {
  return registry.filter((a) => a.record.detect());
}

/** The Records worth reading. Falls back to the whole registry when nothing detects, so a machine
 *  mid-install reads as empty rather than throwing — the callers already handle "no turns". */
export function records(): RecordAdapter[] {
  const present = detect();
  return (present.length ? present : []).map((a) => a.record);
}

/**
 * EVERY DETECTED ASSISTANT'S SESSIONS, newest first within each.
 *
 * Per-Record rather than one merged walk on purpose: a session must be parsed by the reader that
 * understands its format, and pairing must never cross a conversation. Two tools' histories join in
 * the pile downstream, keyed by content — not here.
 */
export function* allSessions(): Generator<Session> {
  for (const r of records()) yield* r.sessions();
}

/** Every detected assistant's turns, as one flat stream. */
export function* allTurns(): Generator<Turn> {
  for (const s of allSessions()) for (const t of s.turns) yield t;
}

/** The first Record that cannot read its own history any more, or undefined while all is well.
 *  One tool's format moving must halt only that tool — the others keep profiling. */
export function firstDrift(): DriftReport | undefined {
  for (const r of records()) {
    const report = r.health();
    if (!report.ok) return report;
  }
  return undefined;
}

/**
 * Is the after-session refresh LIVE anywhere? Consent to refresh is consent to refresh, whichever
 * assistant's hook is carrying it.
 *
 * Strictly `'armed'` — a hook the person has not yet approved in their own tool is not consent, and
 * counting it would let a file WE wrote stand in for a yes THEY never gave.
 */
export function anyArmed(): boolean {
  return registry.some((a) => a.rhythm.state() === 'armed');
}

/**
 * WHICH RECORD OWNS THIS PATH — the one whose roots contain it.
 *
 * The engine sometimes has a directory rather than a tool: the archive walk, `mirror` pointed at a
 * live log, a test handed a fixture. Asking which Record claims the path keeps that from becoming a
 * hardcoded assistant name in the middle of the engine, and routes correctly the moment a second
 * Record registers.
 *
 * A path NOBODY claims falls back to the first registered Record — which today means a fixture
 * directory is parsed as Claude Code JSONL. That is exactly what every fixture writes, and stating
 * it here is better than the alternative of guessing a format from a file's contents.
 */
export function recordFor(path: string): RecordAdapter {
  for (const a of registry) {
    if (a.record.roots().some((r) => path === r || path.startsWith(r.endsWith(sep) ? r : r + sep))) return a.record;
  }
  return registry[0].record;
}

/** Our managed block, present in a file we did not write. The marker is shared by every Return
 *  implementation, so this reads any of their targets. */
function blockPresent(target: string): boolean {
  try {
    return fileExists(target) && readFileSync(target, 'utf8').includes('<!-- stratless:start -->');
  } catch {
    return false;
  }
}

/**
 * DELIVER THE PROFILE TO EVERY ASSISTANT ON THIS MACHINE.
 *
 * Called after every build, not only at install: one of the two delivery shapes is a COPY, and a
 * copy that is written once is a profile that silently ages. Returns the files written, which the
 * caller may name to the person — the count is how many assistants the profile actually reaches.
 */
export function loadEverywhere(): string[] {
  const written: string[] = [];
  for (const a of detect()) {
    const file = a.load.load();
    if (file) written.push(file);
  }
  return written;
}

/** Take the profile back out of every assistant. The off switch has to be as complete as the on
 *  switch, or `stop` leaves a copy behind in a tool nobody thought to check. */
export function unloadEverywhere(): Adapter[] {
  return registry.filter((a) => a.load.unload());
}

/** Which assistants are currently being handed this person's profile. */
export function loadedInto(): Adapter[] {
  return registry.filter((a) => a.load.loaded());
}

/** Does the vault ROOT hold a transcript of its own — as opposed to merely existing because some
 *  other Record made a slice inside it? Top level only: a subdirectory is somebody else's. */
function hasFlatTranscript(dir: string): boolean {
  try {
    return readdirSync(dir, { withFileTypes: true }).some((e) => e.isFile() && e.name.endsWith('.jsonl'));
  } catch {
    return false;
  }
}
