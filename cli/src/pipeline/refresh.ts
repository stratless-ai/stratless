import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Brain } from '../integrations/contracts.js';
import { brainFor, brains } from '../integrations/brains/registry.js';
import { buildMoments, loadMoments } from './moments.js';
import { deliverMissing, detect, firstDrift, loadEverywhere, registry } from '../integrations/assistants/registry.js';
import { loadCategories, type Category } from './categories.js';
import { loadAssignments, pendingMoments } from './assign.js';
import { join as joinLabelled, scoreboard } from './count.js';
import { runLift } from './lift.js';
import { buildProfile, looksLikeProfile } from './write.js';
import { coldBuild, engineReady, grow, loadEngine, outgrown } from './engine.js';
import { runtimePresent } from './embedding/embed.js';
import { estimateBuild, estimateLine } from './estimate.js';
import { humanMdPath, profilePath, writeProfile } from '../storage/profile.js';
import { startRun } from '../runner/stopwatch.js';
import { clearColdBuildRequest, coldBuildRequested, flushCooldownMs, flushDue, growthConsented, latestRender, readRenders, readState, writeRender, writeState } from '../runner/state.js';
import { writeProgress } from '../runner/progress.js';

const flushMaxAgeMs = (): number => flushCooldownMs(readState().flushCadence);

export interface RefreshResult {
  summary: string[];
  code?: number;
  failure?: string[];
}

export async function refreshProfiles(opts: {
  startedAt: string;
  manual: boolean;
  brain: Brain;
  shouldStop: () => boolean;
  receipt: () => string | undefined;
}): Promise<RefreshResult> {
  const { startedAt, manual, brain, shouldStop, receipt } = opts;
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
      if (drift) return { summary, failure: drift.reason!.split('\n') };
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

      // ONE read of the pile for the whole pass — the per-record slices below (the young-trigger
      // check, the cold quote, the flush block) all cut from this. Collection already happened
      // above, so the file is stable for the rest of the run.
      const pile = loadMoments();

      // Records that finish this loop BUILT (cold or steady) flow into the flush block below.
      // `changed` is per record: one pair's new moments must not rebuild another pair's file.
      const ready: { a: (typeof here)[number]; cats: Category[]; changed: boolean; justBuilt: boolean }[] = [];
      let collectedOnly = 0;

      for (const a of here) {
        if (shouldStop()) break;
        const record = a.record.id;
        let cats = loadCategories(record);
        const mine = pile.filter((m) => m.record === record);
        // THE YOUNG TRIGGER: an under-built map whose history has doubled re-derives from the
        // whole pile (engine.ts `outgrown` — pure arithmetic, self-damping). Detection is free
        // and runs every wake; whether the rebuild may SPEND is decided at the gate below.
        const eng = loadEngine(record);
        const young = Boolean(cats.length && eng && engineReady(record) && outgrown(eng, mine));

        if (!cats.length || !engineReady(record) || young) {
          // THIS RECORD'S PAID RUN — a cold start, or a young map rebuilding. Cold-start consent
          // is machine-level and consumed once (the door's yes covers every assistant present
          // when it was given, and its quote summed them); a YOUNG rebuild may also ride the
          // STANDING growth consent — stamped by a flushing run whose copy says so — and only a
          // young rebuild may: `young` requires categories AND a ready engine, so a first build
          // can never reach the paid arm on the standing flag. The `flush` bound is the RETRY
          // bound: a rebuild whose naming call fails leaves the trigger true and the consent
          // standing, and without it the worker would re-attempt the paid call on every wake.
          // Successes are self-damping; the cadence is what damps failures. A typed `update`
          // (`consented`) still rebuilds immediately.
          const allowed = consented || (young && growthConsented() && flush);
          if (!allowed) {
            const own = mine.length;
            const est = estimateLine(estimateBuild(own));
            if (young) {
              // Outgrown but not building on THIS wake: with standing consent it is only waiting
              // for the cadence; without (a pair built before the consent copy said this out
              // loud), the next typed `update` takes it.
              summary.push(
                growthConsented()
                  ? `${label(a.displayName)}your history has outgrown its ${cats.length}-pattern map — rebuilding on the next scheduled refresh (${est})`
                  : `${label(a.displayName)}your history has outgrown its ${cats.length}-pattern map — the next \`stratless update\` rebuilds it (${est})`,
              );
              continue;
            }
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
            shouldStop: shouldStop,
          });
          sw.stage('build', Date.now() - buildStart, dr.scored);
          cats = loadCategories(record);
          if (dr.categories) {
            summary.push(
              `${label(a.displayName)}${young ? 'your history outgrew its map — rebuilt: ' : ''}found ${dr.categories} pattern${dr.categories === 1 ? '' : 's'} in ${dr.scored} moment${dr.scored === 1 ? '' : 's'} — fingerprinted on this machine, one call to name them`,
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
          const res = await grow(record, { shouldStop: shouldStop });
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

      // Growth of the category set happens through rebuild triggers: the young check above, and
      // later the mature fit-drift trigger (unbuilt — its noise band is being measured first).
      // Parking was the earlier plan and was falsified by measurement; the record is in engine.ts.

      // A stop from either path: everything scored so far is banked, the next run resumes.
      if (shouldStop()) {
        sw.record();
        const spent = receipt();
        const line = 'stopped by you — everything already scored is banked; the next run resumes from there';
        writeProgress({ phase: 'stopped', ok: false, startedAt, summary: spent ? [line, spent] : [line], ...(spent ? { spend: spent } : {}) });
        return { summary, code: 0 };
      }

      // FLUSH, PER RECORD: the scoreboard (arithmetic, free), the lift pass, then the pair's file.
      // A record that just cold-built flushes regardless of the cadence — its first file must not
      // wait a day. Everything in here reads ONE record's slice; nothing sums across two.
      if (ready.length) {
        const momentsAll = pile;
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

  return { summary };
}
