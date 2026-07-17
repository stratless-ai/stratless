/**
 * PROGRESS — the worker's voice on disk (Phase 2 of the cold-start build).
 *
 * The worker runs detached; nothing can print to a terminal it doesn't have. So it narrates to ONE
 * small file, atomically, and the surfaces read it: `update`'s live tail renders it as the
 * familiar progress lines, `status` shows a running worker's phase, and `stop` labels it honestly
 * when it kills the run. Disk is the queue and disk is the display — no IPC, no sockets.
 *
 * A progress file is only trusted while its writer is plausibly alive (its pid matches the lock's
 * holder); a leftover from a crash reads as history, not as a running worker.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFileSync } from './atomic.js';

/** Where the worker narrates. Override with STRATLESS_PROGRESS (tests). */
export const progressPath = (): string => process.env.STRATLESS_PROGRESS || join(homedir(), '.stratless', 'progress.json');

export type WorkerPhase =
  | 'starting'
  | 'judging'
  | 'mining'
  | 'auditing'
  | 'grading'
  | 'writing'
  | 'done'
  | 'stopped'
  | 'failed';

export interface Progress {
  pid: number;
  startedAt: string;
  updatedAt: string;
  phase: WorkerPhase;
  /** judging progress, when phase === 'judging' */
  done?: number;
  total?: number;
  /** terminal phases only: the closing lines, plain text — the tail styles them */
  summary?: string[];
  /** terminal phases only: did the run end well (done) or not (failed/stopped) */
  ok?: boolean;
}

/** Read the progress file. Missing or damaged reads as nothing — it is narration, never a ledger. */
export function readProgress(file: string = progressPath()): Progress | undefined {
  try {
    if (!existsSync(file)) return undefined;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Progress>;
    const pid = Number(raw.pid);
    if (!Number.isInteger(pid) || pid <= 0 || typeof raw.phase !== 'string') return undefined;
    return {
      pid,
      startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
      phase: raw.phase as WorkerPhase,
      ...(Number.isFinite(Number(raw.done)) ? { done: Number(raw.done) } : {}),
      ...(Number.isFinite(Number(raw.total)) ? { total: Number(raw.total) } : {}),
      ...(Array.isArray(raw.summary) ? { summary: raw.summary.filter((l): l is string => typeof l === 'string') } : {}),
      ...(typeof raw.ok === 'boolean' ? { ok: raw.ok } : {}),
    };
  } catch {
    return undefined;
  }
}

/** Write one narration frame. Best-effort — the work matters, the narration must never break it. */
export function writeProgress(p: Omit<Progress, 'pid' | 'updatedAt'> & { pid?: number }, file: string = progressPath()): void {
  try {
    atomicWriteFileSync(
      file,
      `${JSON.stringify({ ...p, pid: p.pid ?? process.pid, updatedAt: new Date().toISOString() })}\n`,
    );
  } catch {
    /* narration is a nicety */
  }
}
