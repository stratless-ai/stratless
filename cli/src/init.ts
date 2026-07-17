/**
 * INIT — stop the reaper.
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
import { atomicWriteFileSync } from './atomic.js';

const HOME = homedir();
const SETTINGS = join(HOME, '.claude', 'settings.json');
const PROJECTS = join(HOME, '.claude', 'projects');
export const ARCHIVE = join(HOME, '.stratless', 'archive');

const KEEP_DAYS = 3650; // ten years. long enough to mean "never".

export interface InitResult {
  before: number | 'default (30)';
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
export function refreshArmed(path: string = SETTINGS): boolean {
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
  if (!existsSync(SETTINGS)) return false;
  const read = readSettings(SETTINGS);
  if (!read.ok) return false; // an unreadable settings file has no hook we can remove
  const settings = read.settings;
  const stop: unknown = settings?.hooks?.Stop;
  if (!Array.isArray(stop)) return false;
  const kept = stop.filter((g) => !JSON.stringify(g).includes('stratless update'));
  if (kept.length === stop.length) return false;
  settings.hooks.Stop = kept;
  atomicWriteFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
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

export function init(opts: { auto?: boolean } = {}): InitResult {
  // 1. stop the reaper
  const read = readSettings(SETTINGS);
  if (!read.ok) {
    // Refuse, don't clobber: overwriting a file we couldn't read would destroy whatever the person
    // had in it. Say what's wrong and stop.
    throw new Error(
      `your ~/.claude/settings.json is not valid JSON, and stratless will not overwrite a file it cannot read.\nFix it (or move it aside), then run init again.`,
    );
  }
  const settings = read.settings;
  const before: number | 'default (30)' = settings.cleanupPeriodDays ?? 'default (30)';
  settings.cleanupPeriodDays = KEEP_DAYS;
  // The after-session auto-refresh is OPT-IN (`init --auto`). A tool that reads everything must not
  // silently arm a background job that reads your history on every session — you turn that on yourself.
  const hookInstalled = opts.auto ? installStopHook(settings) : false;
  atomicWriteFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);

  // 2. put a copy beyond its reach. flat, deduped by project + filename.
  let copied = 0;
  let skipped = 0;
  let oldest: string | undefined;

  for (const src of allTranscripts(PROJECTS)) {
    const rel = src.slice(PROJECTS.length + 1).replace(/\//g, '__');
    const dst = join(ARCHIVE, rel);
    mkdirSync(ARCHIVE, { recursive: true });
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

  return { before, after: KEEP_DAYS, copied, skipped, oldest, hookInstalled };
}
