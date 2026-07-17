/**
 * WORKER GROUND — the process primitives the one-worker architecture stands on.
 *
 * Phase 1 of the cold-start build ships the two primitives (C4, C5); Phase 2 builds the worker
 * itself on top of them. Nothing here talks to a model.
 *
 * THE LOCK (C4): one stratless doing real work at a time, ever. The after-session Stop hook and a
 * hand-run `update` can fire together today and race read-modify-write over judgments.json — the
 * last writer silently discards the other's paid-for judgments. Acquisition is by hard-LINKING a
 * fully-written temp file into place: link(2) fails with EEXIST if the lock exists, and — unlike
 * an O_EXCL create-then-write — the lock can never be observed half-written, so no contender can
 * mistake a just-born lock for a corpse. A dead holder's lock is stolen; a live one is respected.
 * Stealing verifies the PID actually belongs to a plausible stratless process before touching it —
 * PIDs get reused, and killing an innocent lock on the strength of a recycled number would put two
 * workers on the same cache.
 *
 * THE DETACHED SPAWN (C5): start a process that survives its parent — the terminal closing, the
 * hook returning — with the absolute path to the borrowed `claude` captured at spawn time (hook
 * environments carry thin PATHs; resolving at spawn is the only moment we know the real one).
 *
 * Windows is explicitly out of scope this release (spec §7): locks, `ps`, and detached processes
 * all differ there — unsupported beats accidentally broken.
 */
import { linkSync, readFileSync, renameSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Where the lock lives. Override with STRATLESS_LOCK (tests). Exported so refusal messages can
 *  name the exact file a stuck user should inspect. */
export function lockFilePath(): string {
  return process.env.STRATLESS_LOCK || join(homedir(), '.stratless', 'lock');
}

/** What the lock file records — enough to decide staleness and to say WHO holds it. */
export interface LockHolder {
  pid: number;
  startedAt: string;
}

/** Read the lock. Missing or unreadable reads as no-holder (an unreadable lock is a corpse — with
 *  link-based creation a real lock is never observable half-written). */
export function readLock(file: string = lockFilePath()): LockHolder | undefined {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<LockHolder>;
    const pid = Number(raw.pid);
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    return { pid, startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '' };
  } catch {
    return undefined;
  }
}

/** Is any process alive under this PID? kill(pid, 0) probes without touching; EPERM means alive. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The command line a PID is running, or undefined if it can't be read. Exported for tests. */
export function processCommand(pid: number): string | undefined {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Is a holder stale? Dead PID → stale. Alive PID whose command line looks nothing like a
 * stratless-ish process (no `stratless`, no `node`) → PID reuse → stale. Alive and plausibly ours
 * → NOT stale, even if it isn't really stratless: stealing a live process's lock risks two
 * workers on one cache, and the conservative miss only costs waiting for that process to exit.
 * The command probe failing on a live PID reads as not-stale for the same reason.
 */
export function lockIsStale(holder: LockHolder): boolean {
  if (!isAlive(holder.pid)) return true;
  const cmd = processCommand(holder.pid);
  if (cmd === undefined) return false; // alive but unreadable — respect it
  return !/stratless|node/i.test(cmd);
}

/** Create the lock atomically WITH its content: link a fully-written temp into place. link(2) is
 *  the whole mutual exclusion — EEXIST means someone holds it. Returns whether we won. */
function tryCreate(file: string, record: string): boolean {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, record);
    linkSync(tmp, file);
    return true;
  } catch {
    return false;
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Take the lock, or say no. The steal path handles leftovers from crashes: rename the suspect
 * lock to a tomb only one process can win, then VERIFY what was actually moved. If the tomb turns
 * out to hold a live, valid lock — a fresh acquisition that landed between our read and our
 * rename — it is put back and we report held. Because creation is link-based (never observable
 * half-written), an unreadable lock really is a corpse, not a neighbor mid-write.
 */
export function acquireLock(file: string = lockFilePath()): boolean {
  mkdirSync(dirname(file), { recursive: true });
  const record = `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (tryCreate(file, record)) return true;
    const holder = readLock(file);
    if (holder && !lockIsStale(holder)) return false; // genuinely held
    // Stale (or a corpse) — steal via rename so only one contender can win the removal.
    const tomb = `${file}.stale-${process.pid}-${attempt}`;
    try {
      renameSync(file, tomb);
    } catch {
      continue; // someone else already removed or stole it — retry creation
    }
    const moved = readLock(tomb);
    try {
      unlinkSync(tomb);
    } catch {
      /* tomb cleanup is best-effort */
    }
    // Whatever we moved, if it reads as a LIVE valid lock it wasn't the corpse we aimed at —
    // we raced a fresh acquisition. Put it back and report held. (Guarded on `moved` alone, not
    // the earlier read: the earlier read may have been the corpse while the rename caught a
    // newborn.)
    if (moved && !lockIsStale(moved) && moved.pid !== process.pid) {
      tryCreate(file, `${JSON.stringify(moved)}\n`); // atomic put-back; if a third contender beat us, its lock stands
      return false;
    }
    // The corpse is gone — loop and try to create.
  }
  return false;
}

/** Release the lock — only if this process holds it. Never throws. */
export function releaseLock(file: string = lockFilePath()): void {
  try {
    if (readLock(file)?.pid === process.pid) unlinkSync(file);
  } catch {
    /* already gone */
  }
}

/**
 * Resolve a binary to its absolute path via `which`, or undefined. Captured at SPAWN time and
 * handed to the worker as STRATLESS_CLAUDE_BIN — the one moment the spawning environment's PATH
 * is known to be the person's real one.
 */
export function resolveBinPath(bin: string): string | undefined {
  try {
    const out = execFileSync('which', [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Spawn a process that outlives this one (C5): detached, no shared stdio, unref'd so this process
 * can exit freely. Returns the child's PID, or undefined if the spawn failed. Spawn failures
 * (ENOENT etc.) arrive as an ASYNC 'error' event, not a synchronous throw — unhandled, that event
 * would crash the whole process, so it is swallowed here; a failed spawn also carries no pid,
 * which is what the return value reports. Liveness beyond that is the lock's job, not this one's.
 */
export function spawnDetached(command: string, args: string[], env?: Record<string, string>): number | undefined {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ...env },
    });
    child.on('error', () => {}); // async spawn failure must never become an uncaught exception
    child.unref();
    return child.pid ?? undefined;
  } catch {
    return undefined;
  }
}
