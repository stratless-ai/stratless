/**
 * NOTIFY — the update-notifier, consent-bundled (cli-polish-spec §5).
 *
 * The posture is not tunable: NOTHING AMBIENT WITHOUT EXPLICIT CONSENT. Two doors only:
 * 1. `status --check` — user-initiated, on-screen, works for everyone. Plain `status` stays
 *    fully offline.
 * 2. armed users only: arming the after-session refresh (install = alive, or re-armed by `init`) is
 *    explicit consent to background activity, and a cached once-daily version check rides on that SAME
 *    consent, during the background update. A stopped/unarmed machine never gets ambient anything —
 *    the daily path checks the consent artifact (the installed hook) before any network code runs.
 *
 * Mechanics: node 18 global fetch, 1s timeout, best-effort — a failed check is silence, never a
 * blocked or failed command. Result + timestamp cached in ~/.stratless/notify.json. The fetcher
 * is injectable so tests can PROVE no network happens on the unarmed path.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFileSync } from '../storage/atomic.js';

/** Where the check cache lives. Override with STRATLESS_NOTIFY (tests). */
const notifyPath = (): string => process.env.STRATLESS_NOTIFY || join(homedir(), '.stratless', 'notify.json');

export interface NotifyCache {
  checkedAt?: string;
  latest?: string;
}

export function readNotify(file: string = notifyPath()): NotifyCache {
  try {
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<NotifyCache>;
    const out: NotifyCache = {};
    if (typeof raw.checkedAt === 'string') out.checkedAt = raw.checkedAt;
    if (typeof raw.latest === 'string') out.latest = raw.latest;
    return out;
  } catch {
    return {};
  }
}

export function writeNotify(cache: NotifyCache, file: string = notifyPath()): void {
  try {
    atomicWriteFileSync(file, `${JSON.stringify(cache)}\n`);
  } catch {
    /* best-effort — a lost cache costs one extra check tomorrow */
  }
}

/** Is the cached check stale? Pure — the once-daily rule, testable without a network. */
export function shouldCheck(cache: NotifyCache, now: Date, ttlHours = 24): boolean {
  if (!cache.checkedAt) return true;
  const age = now.getTime() - new Date(cache.checkedAt).getTime();
  return !Number.isFinite(age) || age >= ttlHours * 3_600_000;
}

/** Is `latest` genuinely newer than `installed`? Numeric dotted compare; unknowns are never newer. */
export function newerThan(latest: string | undefined, installed: string): boolean {
  if (!latest) return false;
  const a = latest.split('.').map(Number);
  const b = installed.split('.').map(Number);
  if (a.some((x) => !Number.isFinite(x)) || b.some((x) => !Number.isFinite(x))) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** One registry lookup: the latest published version, or undefined. Never throws, never blocks
 *  past the timeout. Fetcher injectable for tests. */
export async function fetchLatest(timeoutMs = 1000, fetcher: Fetcher = globalThis.fetch): Promise<string | undefined> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetcher('https://registry.npmjs.org/stratless/latest', { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return undefined;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The consent-gated daily check. Returns the newer version string when one exists; undefined
 * otherwise. When `armed` is false (the hook is not installed), this returns IMMEDIATELY — the
 * fetcher is unreachable, provably (see the test that passes a throwing fetcher).
 */
export async function dailyCheck(
  installed: string,
  armed: boolean,
  opts: { now?: Date; fetcher?: Fetcher; file?: string } = {},
): Promise<string | undefined> {
  if (!armed) return undefined; // the consent boundary — nothing ambient without it
  const file = opts.file;
  const now = opts.now ?? new Date();
  const cache = readNotify(file);
  if (shouldCheck(cache, now)) {
    const latest = await fetchLatest(1000, opts.fetcher);
    writeNotify({ checkedAt: now.toISOString(), latest: latest ?? cache.latest }, file);
    return newerThan(latest, installed) ? latest : undefined;
  }
  return newerThan(cache.latest, installed) ? cache.latest : undefined;
}
