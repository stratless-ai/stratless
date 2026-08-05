/**
 * THE WORKER — one process, ever; disk is the queue.
 *
 * There is no daemon. Wake sources (the Stop hook, `update`) ring a doorbell — check the lock,
 * spawn this loop detached if no worker lives, and return the terminal at once. The loop then does
 * the work that would otherwise hang the terminal, or the after-session hook:
 *
 *   build   read what's new into the pile (moments.jsonl) — free, code only
 *   place   fingerprint the new moments and attach them to the frozen pile centres — free, on this
 *           machine. On a FIRST run this is instead the cold build: cluster, then ONE call to name.
 *   count   add up the columns — lift, the scoreboard — free, arithmetic
 *   write   assemble the profile and load it
 *   release, exit   nothing runs when there is nothing new
 *
 * A machine with no consent yet builds the pile, says so, and spends nothing.
 *
 * It narrates to progress.json (the tail and `status` read it) and records the stopwatch wherever
 * money moves. RESUMABILITY IS THE STORE'S JOB, NOT THE LOOP'S — and v3 made it simpler: a cold
 * build writes its three stores TOGETHER at the end, so an interrupted build leaves them untouched
 * and the next run starts clean rather than reading a half-built model as whole. On stop it labels
 * the run "stopped by you",
 * releases the lock, and exits — a graceful signal is processed between stages, since the in-flight
 * naming call is synchronous (the stop-latency caveat, flagged for the worker pass).
 */
import { brains, pickBrain } from '../integrations/brains/registry.js';
import { anyArmed } from '../integrations/assistants/registry.js';
import { installedVersion } from '../storage/profile.js';
import { dailyCheck } from './notify.js';
import { readUsage, diffUsage, fmtTokens } from './usage.js';
import { acquireLock, releaseLock, lockFilePath } from './worker.js';
import { writeProgress } from './progress.js';
import { refreshProfiles } from '../pipeline/refresh.js';

/**
 * The profile is built from the most-recent WINDOW exchanges, never the whole backlog. A profile
 * converges here — the older tail is diminishing returns and, by our own recency logic, stale —
 * and bounding it keeps every run cheap and SAFE regardless of how deep a history goes.
 */
export const JUDGE_WINDOW = 200;

/**
 * THE TWO REFUSAL BOUNDARIES. `numerals.ts` rejects numeric characters in model-authored profile
 * wording before it reaches either voice cache; every quantitative receipt is assembled by code.
 * `write.ts` then applies the shape lint because a chatter reply was once LOADED as HUMAN.md in
 * production (2026-07-18) — the artifact still has to look like an artifact. Assembly removes most
 * of both failure classes; the boundaries are what make the remaining promise enforceable.
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The worker's whole life. Returns the process exit code. Assumes it IS the worker process —
 * takes the lock (losing it means another worker lives: this wake was a no-op, exit clean),
 * builds the pile, places the new moments, counts, narrates, releases, ends.
 */
export async function runWorker(): Promise<number> {
  if (!acquireLock(lockFilePath(), 'worker')) return 0; // a live worker exists — the doorbell already did its job
  const startedAt = new Date().toISOString();
  // A hand-run `stratless update` (a real terminal) sets this via the doorbell: it flushes now, over
  // every automatic gate. A background hook run does not, and respects the gates.
  const manual = process.env.STRATLESS_FLUSH === '1';

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

  // Stop is cooperative (C7): a signal flips this flag; the engine checks it between stages
  // (fingerprint, cluster, name) and unwinds gracefully — the caller labels the run and the `finally`
  // releases the lock. stopWorker signals the whole process GROUP, so the in-flight borrowed call
  // is terminated too and the loop reaches its next checkpoint at once; the SIGKILL after the grace
  // window is the backstop. No immediate exit here — that is what let the old design skip the label.
  let stopRequested = false;
  const onStop = (): void => {
    stopRequested = true;
  };
  process.once('SIGTERM', onStop);
  process.once('SIGINT', onStop);

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
    // WHICH MODEL WILL DO THE THINKING — not which assistant's history we read. Those are
    // different questions with different answers, and the commonest machine answers them
    // differently: one tool's transcripts, another tool's model.
    const brain = pickBrain();
    if (!brain) {
      return fail([
        `stratless borrows a model you already have to name what it found — install ${brains.map((b) => b.displayName).join(' or ')}, then run \`stratless update\``,
      ]);
    }

    const refreshed = await refreshProfiles({ startedAt, manual, brain, shouldStop: () => stopRequested, receipt });
    if (refreshed.failure) return fail(refreshed.failure);
    if (refreshed.code !== undefined) return refreshed.code;
    const summary = refreshed.summary;
    // The daily version line rides ONLY on the installed hook (the consent artifact) — same rule as
    // before, now spoken through the summary.
    const newer = await dailyCheck(installedVersion(), anyArmed());
    if (newer) summary.push(`stratless ${newer} available: npm i -g stratless`);

    const spent = receipt();
    if (spent) summary.push(spent);
    writeProgress({ phase: 'done', ok: true, startedAt, summary, ...(spent ? { spend: spent } : {}) });
    return 0;
  } catch (err) {
    fail([`the worker hit an unexpected error: ${err instanceof Error ? err.message : String(err)}`]);
    return 1;
  } finally {
    releaseLock();
    await sleep(0); // let any last pipe events settle before the process ends
  }
}
