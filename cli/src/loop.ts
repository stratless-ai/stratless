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
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { brainFor, brains, pickBrain } from './brains.js';
import { buildMoments, loadMoments } from './moments.js';
import { detect, firstDrift, registry } from './adapters.js';
import { loadCategories, type Category } from './categories.js';
import { loadAssignments, pendingMoments } from './assign.js';
import { join as joinLabelled, scoreboard } from './count.js';
import { runLift } from './lift.js';
import { buildProfile, looksLikeProfile } from './write.js';
import { coldBuild, engineReady, grow } from './engine.js';
import { runtimePresent } from './embed.js';
import { estimateBuild, estimateLine } from './estimate.js';
import { humanMdPath, installedVersion, profilePath, writeProfile } from './profile.js';
import { deliverMissing, loadEverywhere } from './adapters.js';
import { startRun } from './stopwatch.js';
import { dailyCheck } from './notify.js';
import { refreshArmed } from './rhythm-claude-code.js';
import { readState, writeState, writeRender, readRenders, latestRender, flushDue, flushCooldownMs, coldBuildRequested, clearColdBuildRequest } from './state.js';
import { readUsage, diffUsage, fmtTokens } from './usage.js';
import { acquireLock, releaseLock, lockFilePath } from './worker.js';
import { writeProgress } from './progress.js';

/**
 * The profile is built from the most-recent WINDOW exchanges, never the whole backlog. A profile
 * converges here — the older tail is diminishing returns and, by our own recency logic, stale —
 * and bounding it keeps every run cheap and SAFE regardless of how deep a history goes.
 */
export const JUDGE_WINDOW = 200;

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
 *  (`update --daily|--weekly`), else weekly. */
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

    const summary: string[] = [];

    // THE ENGINE, in a harness (lock, progress frames, receipt, version check) that predates it and
    // stays put. Build the pile (free) · place the new moments against the frozen centres (free) ·
    // add up the columns (free) · write the profile. With no frozen model yet, the cold build shapes,
    // fingerprints and clusters on this machine, then spends ONE call naming what it found.
    const sw = startRun();
    const built = buildMoments();

    if (!built.total) {
      // Zero moments is usually a fresh start — but if the person's own transcripts are substantial
      // and the reader still got nothing, the log format moved under us. Refuse loudly rather than
      // quietly reporting "no conversations" over a profile we cannot honestly build. (v3 canary.)
      const drift = firstDrift();
      if (drift) return fail(drift.reason!.split('\n'));
      summary.push('no conversations found yet — talk to your assistant a few times, then run `stratless update`');
    } else {
      // ── PER RECORD, START TO FINISH (the doctrine, 2026-08-03) ─────────────────────────────
      //
      // One pass of this pipeline per assistant on the machine: that record's categories, that
      // record's frozen engine, that record's counts, that record's file. Nothing below ever holds
      // two records' moments in one array — the stores make cross-record writes unrepresentable,
      // and this loop is what keeps the READS honest too.
      //
      // This is also where the old machine-global cold-vs-steady branch died. It asked "has this
      // MACHINE built?", so a second assistant installed after the first build could never reach
      // its own cold path — the steady branch swallowed it forever. Asking per record makes a new
      // assistant exactly what it is: a new pair, starting cold.
      const here = detect();
      const consented = manual || coldBuildRequested();
      let consumedConsent = false;
      const label = (name: string): string => (here.length > 1 ? `${name}: ` : '');

      // THE FLUSH DECISION stays machine-level — cadence is about how often this machine spends
      // attention, not a property of any one pair — but the waiting count feeding it is the union
      // of each record's own pending set, since "pending" is per store now.
      const waiting = here.flatMap((a) => pendingMoments(a.record.id));
      const flush = flushDue(waiting, readState().lastFlushAt, Date.now(), manual, { maxAgeMs: flushMaxAgeMs() }).flush;

      // Records that finish this loop BUILT (cold or steady) flow into the flush block below.
      // `changed` is per record: one pair's new moments must not rebuild another pair's file.
      const ready: { a: (typeof here)[number]; cats: Category[]; changed: boolean; justBuilt: boolean }[] = [];
      let collectedOnly = 0;

      for (const a of here) {
        if (stopRequested) break;
        const record = a.record.id;
        let cats = loadCategories(record);

        if (!cats.length || !engineReady(record)) {
          // THIS RECORD'S COLD START — the one paid run, per pair. Consent is machine-level (the
          // door's yes covers every assistant present when it was given, and its quote summed
          // them); the flag is consumed once, by the first build that takes it up.
          if (!consented) {
            const own = loadMoments().filter((m) => m.record === record).length;
            const est = estimateLine(estimateBuild(own));
            // A machine upgraded from the merged era has EMPTY per-record stores and a legacy
            // engine.json — that person HAS a profile and must hear "the engine changed", never
            // "full build not run yet": a wrong reason is worse than none.
            const upgraded = existsSync(join(homedir(), '.stratless', 'engine.json'));
            summary.push(
              cats.length || upgraded
                ? runtimePresent()
                  ? `${label(a.displayName)}the engine changed — your patterns need one rebuild to stay honest: run \`stratless update\` (${est})`
                  : `${label(a.displayName)}the engine changed — run \`stratless init\` to fetch the new runtime, then \`stratless update\` rebuilds your patterns (${est})`
                : `${label(a.displayName)}collected ${own} moment${own === 1 ? '' : 's'} · full build not run yet — run \`stratless update\` to build your profile (${est})`,
            );
            continue; // unbuilt and unconsented: nothing further for this record, others proceed
          }
          if (!consumedConsent) {
            clearColdBuildRequest();
            consumedConsent = true;
          }
          const buildStart = Date.now();
          const dr = await coldBuild(record, {
            onProgress: (l: string) => writeProgress({ phase: 'starting', startedAt, summary: [`${label(a.displayName)}${l}`] }),
            shouldStop: () => stopRequested,
          });
          sw.stage('build', Date.now() - buildStart, dr.scored);
          cats = loadCategories(record);
          if (dr.categories) {
            summary.push(
              `${label(a.displayName)}found ${dr.categories} pattern${dr.categories === 1 ? '' : 's'} in ${dr.scored} moment${dr.scored === 1 ? '' : 's'} — fingerprinted on this machine, one call to name them`,
            );
            ready.push({ a, cats, changed: true, justBuilt: true });
          } else if (dr.unnamed) {
            summary.push(
              `${label(a.displayName)}found ${dr.piles} pattern${dr.piles === 1 ? '' : 's'}, but ${(brainFor(record) ?? brain).displayName} did not name them — nothing was lost, run \`stratless update\` to try again`,
            );
          } else if (dr.noModel) {
            summary.push('the local engine is not on this machine yet — run `stratless init` to fetch it, then `stratless update`');
          } else {
            summary.push(`${label(a.displayName)}not enough recurring behaviour to build a profile yet — keep working, then run \`stratless update\``);
          }
        } else if (flush) {
          // STEADY: this record's new moments meet its own frozen centres. Free.
          const growStart = Date.now();
          const res = await grow(record, { shouldStop: () => stopRequested });
          sw.stage('grow', Date.now() - growStart, res.scored);
          if (res.scored) {
            summary.push(
              `${label(a.displayName)}placed ${res.scored} new moment${res.scored === 1 ? '' : 's'} against ${cats.length} patterns — free, on this machine`,
            );
          }
          ready.push({ a, cats, changed: res.scored > 0, justBuilt: false });
        } else {
          collectedOnly += pendingMoments(record).length;
        }
      }

      if (!flush && collectedOnly >= 0 && ready.length === 0 && here.some((a) => loadCategories(a.record.id).length)) {
        summary.push(
          collectedOnly
            ? `collected ${collectedOnly} new moment${collectedOnly === 1 ? '' : 's'} — nothing to flush yet`
            : 'nothing new since the last flush',
        );
      } else if (flush && ready.length && ready.every((r) => !r.changed && !r.justBuilt) && manual) {
        summary.push('already current — nothing new to place');
      }

      // NOT YET: a moment near NOTHING should be parked, and parked moments that later resemble
      // each other should be born as a new pile and named. Until that lands, a genuinely new
      // behaviour is absorbed into the nearest existing pile and cannot surface. Per record now.

      // A stop from either path: everything scored so far is banked, the next run resumes.
      if (stopRequested) {
        sw.record();
        const spent = receipt();
        const line = 'stopped by you — everything already scored is banked; the next run resumes from there';
        writeProgress({ phase: 'stopped', ok: false, startedAt, summary: spent ? [line, spent] : [line], ...(spent ? { spend: spent } : {}) });
        return 0; // the finally releases the lock
      }

      // FLUSH, PER RECORD: the scoreboard (arithmetic, free), the lift pass, then the pair's file.
      // A record that just cold-built flushes regardless of the cadence — its first file must not
      // wait a day. Everything in here reads ONE record's slice; nothing sums across two.
      if (ready.length) {
        const momentsAll = loadMoments();
        const scoreboards = { ...(readState().scoreboards ?? {}) };
        for (const { a, cats, changed, justBuilt } of ready) {
          if (!flush && !justBuilt) continue;
          const record = a.record.id;
          const labelled = joinLabelled(momentsAll.filter((m) => m.record === record), loadAssignments(record));
          // The wider distress rate, recorded per pair and never shown (the mirror's number is the
          // user-facing one). Measured inside one relationship — a rate averaged over two would
          // describe neither.
          const board = scoreboard(labelled, cats);
          scoreboards[record] = { rate: board.rate, at: new Date().toISOString() };

          // THE LIFT PASS, on this record's own evidence: its labelled slice, its categories, its
          // engine for re-homing, its roots for the ask walk. LIFT grades ONE AI by doctrine, and
          // now by construction.
          const liftStart = Date.now();
          const lr = runLift(labelled, cats, Date.now(), {
            record,
            isPrimary: a.id === registry[0].id,
            roots: a.record.roots(),
          });
          sw.stage('lift', Date.now() - liftStart, lr.minted + lr.retired);
          if (lr.minted) summary.push(`${label(a.displayName)}${lr.minted} patch${lr.minted === 1 ? '' : 'es'} minted — the counts decided; the model only worded it`);
          if (lr.retired) summary.push(`${label(a.displayName)}${lr.retired} patch${lr.retired === 1 ? '' : 'es'} retired — the tune thinned`);

          if (changed || lr.changed || !existsSync(profilePath(record))) {
            const writeStart = Date.now();
            const profile = buildProfile(record);
            sw.stage('write', Date.now() - writeStart, profile ? 1 : 0);
            if (profile && looksLikeProfile(profile.text)) {
              const builtAt = new Date().toISOString(); // one stamp for BOTH the file header and the sidecar — they must agree
              writeProfile(profile.text, profilePath(record), builtAt);
              // STAMP THE VOICE, per pair. A change of brain is a change of wording with no other
              // visible cause; the record of what actually ran makes it answerable.
              // The stamp records the voice THIS PAIR's build ran with — brainFor, not the global
              // pick: it is the line that caught the unwired rule, and it must keep telling the truth.
              const wrote = brainFor(record);
              const before = latestRender(readRenders(), record)?.brain;
              writeRender(record, {
                builtAt,
                sessions: profile.meta.sessions,
                exchanges: profile.meta.moments,
                categories: cats.length,
                ...(wrote ? { brain: wrote.id } : {}),
              });
              if (wrote && before && before !== wrote.id) {
                const was = brains.find((b) => b.id === before)?.displayName ?? before;
                summary.push(`${label(a.displayName)}your profile is now worded by ${wrote.displayName}, not ${was}`);
              }
              summary.push(
                `${label(a.displayName)}profile written and loaded · ${profile.meta.frame} to offer + ${profile.meta.judge} to catch + ${profile.meta.register} register${profile.meta.rules ? ` + ${profile.meta.rules} to move` : ''}${profile.meta.shorthand ? ` + ${profile.meta.shorthand} shorthand handles` : ''}`,
              );
            } else {
              summary.push(`${label(a.displayName)}profile not rebuilt — not enough clear evidence yet`);
            }
          }
        }
        if (flush) {
          writeState({ ...readState(), scoreboards, lastFlushAt: new Date().toISOString() });
        } else {
          writeState({ ...readState(), scoreboards });
        }
        // Get each assistant to read its own pair's file — on every build, because one of the
        // delivery shapes is a copy and a copy written once is a profile that quietly ages.
        loadEverywhere();
      }
    }

    // DELIVERY IS NOT A SIDE EFFECT OF REBUILDING.
    //
    // The write path above hands the profile to every assistant on every build, which is what keeps
    // a COPY from silently ageing. It cannot help an assistant that has no copy AT ALL, because
    // reaching that branch requires a rebuild, and a machine whose profile is already current never
    // runs one. Two ordinary situations land exactly there: a person adds a second assistant to a
    // working install (the profile is current, so nothing rebuilds, so the new tool stays empty),
    // and `stop` — which unloads from every tool and then points at `update`, whose own contract has
    // always promised that a gated skip still loads.
    //
    // So ask the only question delivery actually turns on: does each assistant on this machine HAVE
    // the profile? Outside every gate above, because none of them are about that — not whether a
    // flush is due, not whether the pile moved. Cheap when there is nothing to do: one file read per
    // detected tool, and no write unless somebody is missing it.
    if (detect().some((a) => existsSync(profilePath(a.record.id))) || existsSync(humanMdPath())) {
      // Name who it reached, and only who it actually reached — a delivery nobody is told about is
      // the same invisibility that let this sit unnoticed behind a status line reading "yes".
      const arrived = deliverMissing();
      if (arrived.length) {
        summary.push(`profile loaded into ${arrived.map((a) => a.displayName).join(' and ')} — it was not there yet`);
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
    fail([`the worker hit an unexpected error: ${err instanceof Error ? err.message : String(err)}`]);
    return 1;
  } finally {
    releaseLock();
    await sleep(0); // let any last pipe events settle before the process ends
  }
}
