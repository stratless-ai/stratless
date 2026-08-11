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
import { sep } from 'node:path';

import type { Adapter, DriftReport, RecordAdapter, Session, Turn } from '../contracts.js';
import { claudeCode } from './claude-code/adapter.js';
import { codex } from './codex/adapter.js';

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

export interface DisarmedAdapter {
  adapter: Adapter;
  warnings: string[];
}

/** Disarm every compiled-in assistant and return what was removed, including any tool-specific
 *  consequences the person needs to hear. */
export function disarmEverywhere(): DisarmedAdapter[] {
  const removed: DisarmedAdapter[] = [];
  for (const adapter of registry) {
    const result = adapter.rhythm.disarm();
    if (result.removed) removed.push({ adapter, warnings: result.warnings });
  }
  return removed;
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
  // LONGEST MATCH WINS, and that is not a refinement — first-match is wrong here. Our vault nests:
  // Claude Code's slice IS the vault root (flat, by history) and every later Record gets a
  // subdirectory inside it. So an archived Codex rollout sits under BOTH `~/.stratless/archive` and
  // `~/.stratless/archive/codex`, and asking the registry in order hands it to Claude Code — which
  // then parses a rollout as Claude JSONL, silently, because a rollout is also valid JSONL. The more
  // specific root is the one that actually owns the file.
  let best: { record: RecordAdapter; len: number } | undefined;
  for (const a of registry) {
    for (const r of a.record.roots()) {
      const under = path === r || path.startsWith(r.endsWith(sep) ? r : r + sep);
      if (under && (!best || r.length > best.len)) best = { record: a.record, len: r.length };
    }
  }
  return best?.record ?? registry[0].record;
}

/** Take the profile back out of every assistant. The profile went internal (2026-08-10): nothing
 *  loads it anymore, and this is the off-ramp that clears the pointer from older installs — run by
 *  every refresh and by `stop`, until every machine has crossed. */
export function unloadEverywhere(): Adapter[] {
  return registry.filter((a) => a.load.unload());
}
