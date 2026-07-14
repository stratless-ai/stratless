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
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

export function init(): InitResult {
  // 1. stop the reaper
  const settings = existsSync(SETTINGS) ? JSON.parse(readFileSync(SETTINGS, 'utf8')) : {};
  const before: number | 'default (30)' = settings.cleanupPeriodDays ?? 'default (30)';
  settings.cleanupPeriodDays = KEEP_DAYS;
  mkdirSync(join(HOME, '.claude'), { recursive: true });
  writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);

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

  return { before, after: KEEP_DAYS, copied, skipped, oldest };
}
