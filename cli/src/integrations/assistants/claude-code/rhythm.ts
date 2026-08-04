/**
 * THE CLAUDE CODE RHYTHM — stop the reaper, and keep the record coming.
 *
 * The RHYTHM leg is the one that runs on the tool's own clock rather than on ours: it arms the
 * after-session trigger, and it protects the transcripts from the tool's own housekeeping. Every
 * assistant needs its own, because every assistant expires and notifies differently — Codex's lives
 * in the Codex rhythm adapter. What follows is Claude Code's, and its first job is a deletion timer.
 *
 * Claude Code deletes transcripts after 30 days. Per FILE, not per project — so an archive
 * silently rots from the back even in a repo you use every day. On the machine this was built
 * on, everything before 9 June 2026 was ALREADY GONE: months of decisions, the reasoning behind
 * code still running in production, deleted on a timer nobody knew about.
 *
 * The industry treats the conversation as exhaust. It is not exhaust. It is the only record of
 * WHY your product is the way it is — and it is being thrown away, on millions of machines,
 * right now.
 *
 * This does two things and neither of them is clever:
 *   1. sets `cleanupPeriodDays` so the reaper stops
 *   2. copies every transcript into ~/.stratless/archive — outside its reach, forever
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFileSync } from '../../../storage/atomic.js';
import { archiveRoot } from '../../../storage/paths.js';

/**
 * Resolved at CALL time, never frozen at import.
 *
 * These were module-level constants, which meant a test could only point them somewhere else by
 * forking a subprocess — the same trap `roots()` was in. A function costs nothing and makes an
 * in-process fixture HOME work.
 */
export const settingsPath = (): string => join(homedir(), '.claude', 'settings.json');
export const projectsDir = (): string => join(homedir(), '.claude', 'projects');
/** Our own vault, and Claude Code's slice of it: the ROOT, flat. A second Record's slice is a
 *  subdirectory, which is why the reader refuses to descend one — see `record.ts`. */
const KEEP_DAYS = 3650; // ten years. long enough to mean "never".

export interface InitResult {
  /** the reaper setting as it was, rendered for display ('30', 'default (30)') */
  before: string;
  after: number;
  copied: number;
  skipped: number;
  oldest?: string;
  /** did this run add the silent after-session refresh hook (vs it already being present)? */
  hookInstalled: boolean;
}

/**
 * Install the silent after-session refresh: a Claude Code Stop hook that runs `stratless update` in
 * the background (prints nothing; rebuilds and reloads the profile). Idempotent — never adds a
 * duplicate. Returns true only when it actually added the hook.
 */
export function installStopHook(settings: any): boolean {
  const command = 'stratless update >/dev/null 2>&1 &';
  settings.hooks ??= {};
  settings.hooks.Stop ??= [];
  if (JSON.stringify(settings.hooks.Stop).includes('stratless update')) return false;
  settings.hooks.Stop.push({ hooks: [{ type: 'command', command }] });
  return true;
}

/**
 * Read + parse a settings.json. A hand-edited file with a trailing comma must never become an
 * uncaught stack trace (the worst first impression a trust-first tool can make) — and it must never
 * be silently overwritten either. Callers decide: `init` refuses, `stopRefresh` treats it as off.
 */
export function readSettings(path: string): { ok: boolean; settings: any } {
  if (!existsSync(path)) return { ok: true, settings: {} };
  try {
    return { ok: true, settings: JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { ok: false, settings: undefined };
  }
}

/** Is the after-session refresh armed? The installed hook IS the consent artifact — the daily
 *  version check (notify.ts) gates on this, and `status` reports it. */
export function refreshArmed(path: string = settingsPath()): boolean {
  const read = readSettings(path);
  if (!read.ok || !read.settings) return false;
  return JSON.stringify(read.settings.hooks?.Stop ?? []).includes('stratless update');
}

/**
 * Turn the after-session refresh OFF — remove our Stop hook. Leaves the reaper, the archive, and the
 * profile untouched: the off switch stops the *automatic* updates, nothing else. Returns whether a
 * hook was actually there to remove.
 */
export function stopRefresh(): boolean {
  if (!existsSync(settingsPath())) return false;
  const read = readSettings(settingsPath());
  if (!read.ok) return false; // an unreadable settings file has no hook we can remove
  const settings = read.settings;
  const stop: unknown = settings?.hooks?.Stop;
  if (!Array.isArray(stop)) return false;
  const kept = stop.filter((g) => !JSON.stringify(g).includes('stratless update'));
  if (kept.length === stop.length) return false;
  settings.hooks.Stop = kept;
  atomicWriteFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
  return true;
}

/** Every transcript, at any depth (subagent transcripts live in nested folders). */
function allTranscripts(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allTranscripts(p, out);
    else if (name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

/**
 * THE SETTINGS HALF — stop the reaper and arm the hook, in one write.
 *
 * Split out of `init` so the two adapter legs can each do their own job: `protect()` needs the
 * reaper stopped, `arm()` needs the hook, and both used to mean running the whole ceremony
 * including a full archive walk. Still ONE settings write, because they land in one file.
 *
 * INSTALL = ALIVE. Arming the after-session refresh IS the install — the door (index.ts) states the
 * deal and takes one consent before this runs. A separate opt-in switch would guard nothing: the
 * hook only ever does FREE work (collect + mirror + steady-state flush) and can NEVER trigger the
 * paid build, which is TTY-gated in the worker (loop.ts). `stratless stop` is the single, total
 * off-switch — that is the one ceremony.
 */
export function writeSettings(): { before: string; after: string; hookInstalled: boolean } {
  const read = readSettings(settingsPath());
  if (!read.ok) {
    // Refuse, don't clobber: overwriting a file we couldn't read would destroy whatever the person
    // had in it. Say what's wrong and stop.
    throw new Error(
      `your ~/.claude/settings.json is not valid JSON, and stratless will not overwrite a file it cannot read.\nFix it (or move it aside), then run init again.`,
    );
  }
  const settings = read.settings;
  const before = String(settings.cleanupPeriodDays ?? 'default (30)');
  settings.cleanupPeriodDays = KEEP_DAYS;
  const hookInstalled = installStopHook(settings);
  atomicWriteFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
  return { before, after: `${KEEP_DAYS} days`, hookInstalled };
}

/** THE COPY HALF — put every transcript beyond the reaper's reach. Flat, deduped by project +
 *  filename, into this Record's own slice of the vault. */
export function archiveTranscripts(): { copied: number; skipped: number; oldest?: string } {
  let copied = 0;
  let skipped = 0;
  let oldest: string | undefined;

  const dest = archiveRoot(); // Claude's slice IS the vault root — flat, for the reason record.ts states
  for (const src of allTranscripts(projectsDir())) {
    const rel = src.slice(projectsDir().length + 1).replace(/\//g, '__');
    const dst = join(dest, rel);
    mkdirSync(dest, { recursive: true });
    // Only copy if new or grown — transcripts are append-only, so size is a sound check
    // and it makes `init` cheap to re-run on a cron or by hand.
    if (existsSync(dst) && statSync(dst).size >= statSync(src).size) {
      skipped++;
      continue;
    }
    copyFileSync(src, dst);
    copied++;
    const m = statSync(src).mtime.toISOString().slice(0, 10);
    if (!oldest || m < oldest) oldest = m;
  }
  return { copied, skipped, oldest };
}

export function init(): InitResult {
  const { before, hookInstalled } = writeSettings();
  const { copied, skipped, oldest } = archiveTranscripts();
  return { before, after: KEEP_DAYS, copied, skipped, oldest, hookInstalled };
}
