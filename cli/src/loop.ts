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
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFileSync, CorruptStoreError } from './atomic.js';
import { findAssistant } from './claude.js';
import { buildMoments, loadMoments } from './moments.js';
import { loadCategories } from './categories.js';
import { loadAssignments, pendingMoments } from './assign.js';
import { join as joinLabelled, scoreboard } from './count.js';
import { buildProfile, looksLikeProfile } from './write.js';
import { coldBuild, engineReady, grow } from './engine.js';
import { estimateBuild, estimateLine } from './estimate.js';
import { injectProfile, humanMdPath } from './sink.js';
import { startRun } from './stopwatch.js';
import { dailyCheck } from './notify.js';
import { refreshArmed } from './init.js';
import { readState, writeState, writeRender, SYNTH_EVERY, flushDue, flushCooldownMs, coldBuildRequested, clearColdBuildRequest } from './state.js';
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

/** The effective auto-rebuild cooldown: the env override wins, else the person's stored cadence
 *  (`update --daily|--weekly`), else daily. */
const flushMaxAgeMs = (): number => flushCooldownMs(readState().flushCadence);

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
    killActiveSession(); // no-op for the synchronous assign call; meaningful for any active stream
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
    const bin = findAssistant();
    if (!bin) return fail(['stratless needs your assistant to read your history — is `claude` installed?']);

    const summary: string[] = [];

    // THE ENGINE, in a harness (lock, progress frames, receipt, version check) that predates it and
    // stays put. Build the pile (free) · place the new moments against the frozen centres (free) ·
    // add up the columns (free) · write the profile. With no frozen model yet, the cold build shapes,
    // fingerprints and clusters on this machine, then spends ONE call naming what it found.
    const sw = startRun();
    const built = buildMoments();

    if (!built.total) {
      summary.push('no conversations found yet — talk to your assistant a few times, then run `stratless update`');
    } else {
      let cats = loadCategories();
      let changed = false; // categories or assignments changed this run → force the profile rebuild
      let flush = true; // cold start always flushes; steady state decides (flushDue) — the per-turn-rebuild fix

      // COLD when there is no profile yet OR no frozen model to grow against. That second clause is
      // THE UPGRADE PATH and it is not optional: a machine that ran a previous engine has categories
      // but no engine.json, and branching on categories alone would send it down the steady path
      // forever — nothing to join against, nothing placed, silently never updating again.
      if (!cats.length || !engineReady()) {
        // COLD START — the one paid run: shape, fingerprint, cluster, then ONE call to name. It only
        // ever runs on CONSENT: `manual` (STRATLESS_FLUSH, set by a hand-typed update or the door's
        // yes for THIS worker) OR a DURABLE consent flag (coldBuildRequested), so a lock race that
        // hands the build to a different worker still honors the yes. A background hook has neither,
        // so it collects the pile (free, above) and stops HERE — nothing billed. Both signals are set
        // only by an explicit yes: "no surprise spend" is structural.
        const consented = manual || coldBuildRequested();
        if (!consented) {
          flush = false; // nothing scored, no profile yet — skip the scoreboard/rebuild block below
          const est = estimateLine(estimateBuild(loadMoments().length));
          summary.push(
            `collected ${built.total} moment${built.total === 1 ? '' : 's'} · full build not run yet — run \`stratless update\` to build your profile (${est})`,
          );
        } else {
          // COLD START: the engine shapes, fingerprints, clusters, names, and freezes. Everything up
          // to the naming call is arithmetic on this machine — the whole build is one small call.
          // The consent is now being taken up: consume the durable flag so it is honored exactly once.
          clearColdBuildRequest();
          const buildStart = Date.now();
          const bin = findAssistant();
          const dr = bin
            ? await coldBuild(bin, {
                onProgress: (l: string) => writeProgress({ phase: 'starting', startedAt, summary: [l] }),
                shouldStop: () => stopRequested,
              })
            : { categories: 0, scored: 0, piles: 0 };
          sw.stage('build', Date.now() - buildStart, dr.scored);
          cats = loadCategories();
          if (dr.categories) {
            changed = true;
            summary.push(
              `found ${dr.categories} pattern${dr.categories === 1 ? '' : 's'} in ${dr.scored} moment${dr.scored === 1 ? '' : 's'} — fingerprinted on this machine, one call to name them`,
            );
          } else if (dr.noModel) {
            // A wrong reason is worse than none: without this the person is told there is not enough
            // behaviour to profile, when in fact the model never arrived.
            summary.push('the local model is not available yet — run `stratless init` to fetch it, then `stratless update`');
          } else if (!bin) {
            summary.push('no assistant found to name the patterns — install Claude Code, then run `stratless update`');
          } else {
            summary.push('not enough recurring behaviour to build a profile yet — keep working, then run `stratless update`');
          }
        }
      } else {
        // STEADY STATE: collect always (free, above); only tag + rebuild — phone the assistant — when
        // a flush is due: you ran `update` by hand, or it has been past the cooldown (default once a
        // day). Every other nudge just leaves the new moments collected and spends nothing.
        const waiting = pendingMoments();
        flush = flushDue(waiting, readState().lastFlushAt, Date.now(), manual, { maxAgeMs: flushMaxAgeMs() }).flush;

        if (!flush) {
          summary.push(
            waiting.length
              ? `collected ${waiting.length} new moment${waiting.length === 1 ? '' : 's'} — nothing to flush yet`
              : 'nothing new since the last flush',
          );
        } else {
          // STEADY STATE: new moments come to the FROZEN pile centres. No clustering, no naming, no
          // model call — this path is free. Piles keep their names and birth dates, which is what
          // makes "rising" and "fading" mean anything: you are watching the same crowd over time,
          // not comparing this month's piles against last month's different ones.
          const growStart = Date.now();
          const res = await grow({ shouldStop: () => stopRequested });
          sw.stage('grow', Date.now() - growStart, res.scored);
          if (res.scored) {
            changed = true;
            summary.push(
              `placed ${res.scored} new moment${res.scored === 1 ? '' : 's'} against ${cats.length} patterns — free, on this machine`,
            );
          } else if (manual) {
            summary.push('already current — nothing new to place');
          }

          // NOT YET: a moment near NOTHING should be parked, and parked moments that later resemble
          // each other should be born as a new pile and named. Until that lands, a genuinely new
          // behaviour is absorbed into the nearest existing pile and cannot surface. This is where
          // re-discovery used to sit, and it is the next build.
        }
      }

      // A stop from either path: everything scored so far is banked, the next run resumes.
      if (stopRequested) {
        sw.record();
        const spent = receipt();
        const line = 'stopped by you — everything already scored is banked; the next run resumes from there';
        writeProgress({ phase: 'stopped', ok: false, startedAt, summary: spent ? [line, spent] : [line], ...(spent ? { spend: spent } : {}) });
        return 0; // the finally releases the lock
      }

      // SHARED (flush only): the scoreboard (arithmetic, free), then the profile file (stage 4). A
      // non-flush nudge skips all of this — the number moves on a flush, which we accepted. Rebuild
      // the file when the category set or the pile changed, or when no profile exists yet. Stamp the
      // flush time so the ceiling measures from here.
      if (flush) {
        // The scoreboard (the WIDER distress rate — moments the categories flag as correcting, ~13/100)
        // is RECORDED here but NEVER shown to the user. The one user-facing friction number is the
        // mirror's course-corrections rate (`mirror` + the init door, ~2.5/100 — literal Escape presses).
        // Showing both would put two near-identical "corrections per 100" figures on screen, 5x apart —
        // the exact confusion the mirror's KPI was split out to avoid. Kept in state for the record.
        const board = scoreboard(joinLabelled(loadMoments(), loadAssignments()), cats);
        writeState({ ...readState(), scoreboard: { rate: board.rate, at: new Date().toISOString() }, lastFlushAt: new Date().toISOString() });

        if (changed || !existsSync(humanMdPath())) {
          const writeStart = Date.now();
          const profile = buildProfile();
          sw.stage('write', Date.now() - writeStart, profile ? 1 : 0);
          if (profile && looksLikeProfile(profile.text)) {
            const builtAt = new Date().toISOString(); // one stamp for BOTH the HUMAN.md header and the sidecar — they must agree
            injectProfile(profile.text, undefined, undefined, builtAt); // writes ~/.claude/HUMAN.md AND points CLAUDE.md at it — the load
            writeRender('profile', { builtAt, sessions: profile.meta.sessions, exchanges: profile.meta.moments, categories: loadCategories().length });
            summary.push(
              `profile written and loaded · ${profile.meta.frame} to offer + ${profile.meta.judge} to catch + ${profile.meta.register} register${profile.meta.shorthand ? ` + ${profile.meta.shorthand} shorthand handles` : ''}`,
            );
          } else {
            summary.push('profile not rebuilt — not enough clear evidence yet');
          }
        }
      }
    }
    sw.record();

    // The daily version line rides ONLY on the installed hook (the consent artifact) — same rule as
    // before, now spoken through the summary.
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
