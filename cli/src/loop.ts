/**
 * THE WORKER (Phase 2 of the cold-start build) — one process, ever; disk is the queue.
 *
 * Spec §4: there is no daemon. Wake sources (the Stop hook, `update`, later `init` and
 * `backfill`) ring a doorbell — check the lock, spawn this loop detached if no worker lives,
 * return the terminal. The loop does the work the commands used to do inline:
 *
 *   rung 1  FRESH   judge the window's unjudged exchanges (seconds, the living loop's cost)
 *   rung 3  GATES   due (or forced)? mine → audit → grade → render → reload
 *   re-scan once    exchanges that arrived while working get judged before exit
 *   release, exit   nothing runs when there is nothing to do
 *
 * (Rung 2 — the backfill cursor — arrives in Phase 4 and slots between them.)
 *
 * It narrates to progress.json (the tail and `status` read it), records the stopwatch wherever
 * money moves, and dies well: SIGTERM kills the in-flight borrowed session, labels the run
 * "stopped by you", releases the lock, and exits — everything already judged is banked (C3), so
 * stopping never wastes what was spent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFileSync, CorruptStoreError } from './atomic.js';
import { findAssistant } from './claude.js';
import { loadRecentExchanges } from './exchange.js';
import { dailyCheck } from './notify.js';
import { refreshArmed } from './init.js';
import { readState, SYNTH_EVERY } from './state.js';
import { readUsage, diffUsage, fmtTokens } from './usage.js';
import { killActiveSession } from './stream.js';
import { acquireLock, releaseLock, lockFilePath } from './worker.js';
import { writeProgress } from './progress.js';

const STRATLESS_DIR = join(homedir(), '.stratless');

/**
 * The profile is built from the most-recent WINDOW exchanges, never the whole backlog. A profile
 * converges here — the older tail is diminishing returns and, by our own recency logic, stale —
 * and bounding it keeps every run cheap and SAFE regardless of how deep a history goes.
 */
export const JUDGE_WINDOW = 200;

/** Amortize default: a good first profile without chewing the whole window in one run. */
const DEFAULT_JUDGE_LIMIT = 50;

/** Per-run cap on FRESH judge calls (cache hits are always free). STRATLESS_JUDGE_LIMIT overrides. */
export const judgeLimit = (): number => {
  const env = Number(process.env.STRATLESS_JUDGE_LIMIT);
  if (Number.isFinite(env) && env > 0) return env;
  return DEFAULT_JUDGE_LIMIT;
};

/** The synthesis gate size. STRATLESS_SYNTH_EVERY overrides. */
export const synthEvery = (): number => {
  const env = Number(process.env.STRATLESS_SYNTH_EVERY);
  if (Number.isFinite(env) && env > 0) return env;
  return SYNTH_EVERY;
};

/** The installed version, read from the package.json that ships next to dist/. */
export function installedVersion(): string {
  try {
    const pkg = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return (JSON.parse(readFileSync(pkg, 'utf8')).version as string) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * `Rendered` and `buildRendered` lived here: they chose between the flat-pile synthesis and the
 * pattern-era one, then ran the two refusal lints. Both synthesis paths are gone with the miner.
 *
 * THE LINTS MUST COME BACK in stage 4, and they are the part worth remembering rather than the
 * plumbing. The numbers-lint refuses a rendering containing a numeral that is not in the evidence.
 * The shape lint exists because a chatter reply was once LOADED as HUMAN.md in production
 * (2026-07-18) — the artifact has to look like an artifact. `write.ts` assembles the file in code
 * rather than asking a model for it, which removes the *source* of both failures; that is a reason
 * to expect the lints to stay quiet, not a reason to ship without them.
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The worker's whole life. Returns the process exit code. Assumes it IS the worker process —
 * takes the lock (losing it means another worker lives: this wake was a no-op, exit clean),
 * works the rungs, re-scans once, narrates, releases, ends.
 */
export async function runWorker(opts: { force?: boolean } = {}): Promise<number> {
  if (!acquireLock(lockFilePath(), 'worker')) return 0; // a live worker exists — the doorbell already did its job
  const startedAt = new Date().toISOString();

  // THE RECEIPT (0.3.5): the meter at birth, diffed at every ending — announced, spent, accounted.
  // Sound because the lock admits one spender at a time: nothing else can move the meter mid-run.
  const usageBefore = readUsage();
  const receipt = (): string | undefined => {
    try {
      const d = diffUsage(usageBefore, readUsage());
      if (!(d.calls > 0)) return undefined; // a run that spent nothing owes no receipt
      const tokens = d.inputTokens + d.outputTokens + d.cacheCreationTokens + d.cacheReadTokens;
      const models = Object.entries(d.byModel)
        .map(([m, t]) => `${m} ×${t.calls}`)
        .join(' · ');
      // a sub-cent spend is still a spend — "$0.00" would read as free, and free it was not
      const cost = d.costUsd > 0 && d.costUsd < 0.005 ? '< $0.01' : `≈ $${d.costUsd.toFixed(2)}`;
      return `this run: ${fmtTokens(tokens)} tokens · ${cost} at API rates${models ? ` · ${models}` : ''}`;
    } catch {
      return undefined;
    }
  };

  // Die well (C7): kill the in-flight borrowed session, label honestly, release, exit. The
  // hash-keyed cache means at most one chunk of work re-asks next wake — stopping is cheap.
  const onKill = (): void => {
    killActiveSession();
    const spent = receipt();
    writeProgress({
      phase: 'stopped',
      ok: false,
      startedAt,
      summary: [
        'stopped by you — everything already judged is banked; the next run re-reads at most one chunk',
        ...(spent ? [spent] : []),
      ],
      ...(spent ? { spend: spent } : {}),
    });
    releaseLock();
    process.exit(0);
  };
  process.once('SIGTERM', onKill);
  process.once('SIGINT', onKill);

  const fail = (lines: string[]): number => {
    const spent = receipt(); // a refused build still spent — the receipt survives the refusal
    writeProgress({
      phase: 'failed',
      ok: false,
      startedAt,
      summary: spent ? [...lines, spent] : lines,
      ...(spent ? { spend: spent } : {}),
    });
    return 1;
  };

  try {
    writeProgress({ phase: 'starting', startedAt });
    const bin = findAssistant();
    if (!bin) return fail(['stratless needs your assistant to read your history — is `claude` installed?']);

    const force = !!opts.force;
    const summary: string[] = [];
    const knownHashes = new Set<string>();

    const window = loadRecentExchanges(JUDGE_WINDOW);
    if (!window.length) {
      summary.push('no conversations found yet — talk to your assistant a few times, then run `stratless update`');
    } else {
      // STAGE 0 of the discovery pipeline. Everything that used to happen here — judge, mine, audit,
      // grade, write — has been removed rather than kept alive alongside its replacement, so that the
      // compiler names every real dependency instead of leaving us to guess the blast radius.
      //
      // The plumbing around it deliberately stays: the lock, the progress frames, the re-scan window,
      // the version check, the receipt. Those are not what was wrong, they are well tested, and
      // keeping them exercised means stages 1-4 slot into a harness that already works.
      //
      // Until stage 2 lands, this spends nothing and says so.
      summary.push(
        `read ${window.length} exchange${window.length === 1 ? '' : 's'} · the profile pipeline is being rebuilt, so nothing was judged or written`,
      );
    }

    // The daily version line rides ONLY on --auto consent (the installed hook is the consent
    // artifact) — same rule as before, now spoken through the summary.
    const newer = await dailyCheck(installedVersion(), refreshArmed());
    if (newer) summary.push(`stratless ${newer} available: npm i -g stratless`);

    const spent = receipt();
    if (spent) summary.push(spent);
    writeProgress({ phase: 'done', ok: true, startedAt, summary, ...(spent ? { spend: spent } : {}) });
    return 0;
  } catch (err) {
    if (err instanceof CorruptStoreError) {
      // C2's refusal keeps its remedy even when the corruption is found INSIDE the worker.
      fail([
        `refused: ${err.file} is damaged — and re-reading your whole history over it would re-bill you`,
        `nothing was read or spent past it; move it aside, then rerun: mv ${err.file} ${err.file}.damaged`,
      ]);
      return 1;
    }
    fail([`the worker hit an unexpected error: ${err instanceof Error ? err.message : String(err)}`]);
    return 1;
  } finally {
    releaseLock();
    await sleep(0); // let any last pipe events settle before the process ends
  }
}
