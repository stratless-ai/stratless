/**
 * WORKER GROUND — the process primitives the one-worker architecture stands on.
 *
 * Phase 1 of the cold-start build ships the two primitives (C4, C5); Phase 2 builds the worker
 * itself on top of them. Nothing here talks to a model.
 *
 * THE LOCK (C4): one stratless doing real work at a time, ever. The after-session Stop hook and a
 * hand-run `update` can fire together today and race read-modify-write over the moment and
 * assignment stores — the last writer silently discards the other's work. Acquisition is by hard-LINKING a
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
import { readProgress, writeProgress } from './progress.js';

/** Where the lock lives. Override with STRATLESS_LOCK (tests). Exported so refusal messages can
 *  name the exact file a stuck user should inspect. */
export function lockFilePath(): string {
  return process.env.STRATLESS_LOCK || join(homedir(), '.stratless', 'lock');
}

/** What the lock file records — enough to decide staleness, say WHO holds it, and say what KIND
 *  of holder it is: a detached 'worker' (safe to tail, safe for `stop` to kill) or a foreground
 *  'command' (a person's own terminal — respected, never killed, never tailed). */
export interface LockHolder {
  pid: number;
  startedAt: string;
  kind: 'worker' | 'command';
}

/** Read the lock. Missing or unreadable reads as no-holder (an unreadable lock is a corpse — with
 *  link-based creation a real lock is never observable half-written). */
export function readLock(file: string = lockFilePath()): LockHolder | undefined {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<LockHolder>;
    const pid = Number(raw.pid);
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    return {
      pid,
      startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '',
      kind: raw.kind === 'worker' ? 'worker' : 'command', // unknown reads as command: respected, never killed
    };
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
export function acquireLock(file: string = lockFilePath(), kind: 'worker' | 'command' = 'command'): boolean {
  mkdirSync(dirname(file), { recursive: true });
  const record = `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), kind })}\n`;
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** When the process under this PID actually started, or undefined. `ps lstart` speaks a
 *  Date.parse-able dialect on macOS and Linux. */
function processStartMs(pid: number): number | undefined {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const t = Date.parse(out);
    return Number.isFinite(t) ? t : undefined;
  } catch {
    return undefined;
  }
}

/** The process group a PID leads, if it leads one. A detached worker is its own group leader; its
 *  borrowed claude children live in that group — the group is the honest kill target. */
function leadsOwnGroup(pid: number): boolean {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'pgid='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return Number(out) === pid;
  } catch {
    return false;
  }
}

/**
 * Is this live PID REALLY the lock's worker — not an innocent process wearing a recycled number?
 * Waiting on a maybe (lockIsStale's conservative /stratless|node/ probe) is safe; KILLING on a
 * maybe is not. So the kill path demands more: the lock says 'worker', and the process's actual
 * start time agrees with the lock's own birth stamp (a worker takes its lock within its first
 * seconds of life; a recycled PID's start time is a different day). Unverifiable reads as NO.
 */
export function verifiedWorker(holder: LockHolder): boolean {
  if (holder.kind !== 'worker' || !isAlive(holder.pid)) return false;
  const cmd = processCommand(holder.pid);
  if (!cmd || !/stratless|node/i.test(cmd)) return false;
  const born = processStartMs(holder.pid);
  const locked = Date.parse(holder.startedAt);
  if (born === undefined || !Number.isFinite(locked)) return false; // can't verify → don't kill
  return locked >= born - 120_000 && locked - born < 300_000; // lock taken within the worker's first minutes
}

/**
 * Kill a running worker (C7 — `stop` is total): SIGTERM first so it can label itself and die at a
 * checkpoint, a short grace, then SIGKILL. Whatever it leaves behind is cleaned: its lock removed,
 * its progress labeled "stopped by you" if it died too fast to say so itself. Returns whether a
 * worker was actually there to kill. Stopping never wastes paid work — the hash-keyed cache means
 * the next run re-asks at most one chunk.
 */
export async function stopWorker(graceMs = 3000): Promise<{ killed: boolean; pid?: number; unverified?: boolean }> {
  const holder = readLock();
  if (!holder || lockIsStale(holder)) return { killed: false };
  // The kill demands verified identity (C7 hardening, review 2026-07-18): a stale lock whose PID
  // was recycled by the person's dev server must never get that server killed by `stop`.
  if (!verifiedWorker(holder)) return { killed: false, pid: holder.pid, unverified: true };
  // A detached worker leads its own process GROUP, and its borrowed claude children (including
  // the SYNCHRONOUS naming/write calls that block its signal handler) live in that group — kill
  // the group, so 'stopped' means the SPENDING stopped, not just the bookkeeper.
  const group = leadsOwnGroup(holder.pid);
  const signalTarget = group ? -holder.pid : holder.pid;
  try {
    process.kill(signalTarget, 'SIGTERM');
  } catch {
    return { killed: false }; // died between the read and the signal — nothing to stop
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && isAlive(holder.pid)) await sleep(100);
  if (isAlive(holder.pid)) {
    try {
      process.kill(signalTarget, 'SIGKILL');
    } catch {
      /* it beat us to the exit */
    }
    await sleep(200);
  }
  // The dead worker's leftovers: its lock (a SIGKILL skips its cleanup)…
  if (readLock()?.pid === holder.pid) {
    try {
      unlinkSync(lockFilePath());
    } catch {
      /* already gone */
    }
  }
  // …and its narration — the state must say what happened, in the person's terms.
  const p = readProgress();
  if (!p || p.pid !== holder.pid || !['done', 'failed', 'stopped'].includes(p.phase)) {
    writeProgress({
      pid: holder.pid,
      phase: 'stopped',
      ok: false,
      startedAt: p?.pid === holder.pid ? p.startedAt : new Date().toISOString(),
      summary: ['stopped by you — everything collected so far is banked; the next run picks up where this one stopped'],
    });
  }
  return { killed: true, pid: holder.pid };
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
    // Scrub STRATLESS_FLUSH from the inherited env: the cold-start consent signal must come ONLY from
    // an explicit override here, never from whatever the ambient shell (or a borrowed claude) happens
    // to carry. Without this, an exported STRATLESS_FLUSH=1 would turn every background hook into a
    // paid build.
    const base = { ...process.env };
    delete base.STRATLESS_FLUSH;
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      env: { ...base, ...env },
    });
    child.on('error', () => {}); // async spawn failure must never become an uncaught exception
    child.unref();
    return child.pid ?? undefined;
  } catch {
    return undefined;
  }
}
