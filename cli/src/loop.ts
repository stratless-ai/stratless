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
import { atomicWriteFileSync } from './atomic.js';
import { findAssistant } from './claude.js';
import { loadRecentExchanges, sessionCount } from './exchange.js';
import { judgeAll, cachedCount, pendingCount, allJudgments, fitAperture } from './judge.js';
import { mine, auditPatterns, gradePatterns, loadPatterns } from './miner.js';
import { dailyCheck } from './notify.js';
import { refreshArmed } from './init.js';
import { injectProfile, ensureLoaded, humanMdPath } from './sink.js';
import { readState, writeState, synthesisDue, writeRender, SYNTH_EVERY } from './state.js';
import { startRun } from './stopwatch.js';
import { killActiveSession } from './stream.js';
import {
  synthesizeProfile,
  synthesizeReport,
  synthesizeProfileFromPatterns,
  synthesizeReportFromPatterns,
  artifactShapeProblem,
  hasSignal,
  mostRecent,
  topTopics,
  type Corpus,
} from './synthesize.js';
import { acquireLock, releaseLock } from './worker.js';
import { writeProgress } from './progress.js';
import type { Judgment } from './judge.js';

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

export interface Rendered {
  text?: string;
  /** the numbers-lint refused: these numerals were invented */
  invented?: string[];
  /** the shape lint refused: what the output looked like instead of an artifact */
  malformed?: string;
}

/**
 * Build either rendering — from the mined patterns when they exist, else the flat pile read.
 * Pure of terminal concerns: both refusal lints (invented numbers, artifact shape) come back as
 * data; the CLI and the worker each say no in their own voice. No refusal ever loads.
 */
export function buildRendered(kind: 'profile' | 'report', signal: Judgment[], corpus: Corpus, bin: string): Rendered {
  const store = loadPatterns();
  let out: Rendered;
  let patternEra = false;
  if (!store.patterns.length) {
    const text = kind === 'profile' ? synthesizeProfile(signal, corpus, bin) : synthesizeReport(signal, corpus, bin);
    out = text ? { text } : {};
  } else {
    patternEra = true;
    const synth = kind === 'profile' ? synthesizeProfileFromPatterns : synthesizeReportFromPatterns;
    out = synth(store.patterns, mostRecent(signal, 25), corpus, bin);
  }
  if (out.text) {
    // THE SHAPE LINT (C9's second half, pulled forward after B1 struck production 2026-07-18:
    // a chatter reply was LOADED as HUMAN.md). The artifact must look like an artifact.
    const problem = artifactShapeProblem(out.text, { kind, patternEra });
    if (problem) return { malformed: problem };
  }
  return out;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The worker's whole life. Returns the process exit code. Assumes it IS the worker process —
 * takes the lock (losing it means another worker lives: this wake was a no-op, exit clean),
 * works the rungs, re-scans once, narrates, releases, ends.
 */
export async function runWorker(opts: { force?: boolean } = {}): Promise<number> {
  if (!acquireLock()) return 0; // a live worker exists — the doorbell already did its job
  const startedAt = new Date().toISOString();

  // Die well (C7): kill the in-flight borrowed session, label honestly, release, exit. The
  // hash-keyed cache means at most one chunk of work re-asks next wake — stopping is cheap.
  const onKill = (): void => {
    killActiveSession();
    writeProgress({
      phase: 'stopped',
      ok: false,
      startedAt,
      summary: ['stopped by you — everything already judged is banked; the next run re-reads at most one chunk'],
    });
    releaseLock();
    process.exit(0);
  };
  process.once('SIGTERM', onKill);
  process.once('SIGINT', onKill);

  const fail = (lines: string[]): number => {
    writeProgress({ phase: 'failed', ok: false, startedAt, summary: lines });
    return 1;
  };

  try {
    writeProgress({ phase: 'starting', startedAt });
    const bin = findAssistant();
    if (!bin) return fail(['stratless needs your assistant to read your history — is `claude` installed?']);

    let force = !!opts.force;
    const summary: string[] = [];

    for (let pass = 0; pass < 2; pass++) {
      const window = loadRecentExchanges(JUDGE_WINDOW);
      if (!window.length) {
        if (pass === 0) summary.push('no conversations found yet — talk to your assistant a few times, then run `stratless update`');
        break;
      }
      // The re-scan (pass 1) exists to bank exchanges that arrived WHILE working — skip it clean
      // when nothing new landed.
      if (pass === 1 && pendingCount([...window].reverse(), judgeLimit()) === 0) break;

      const sw = startRun();
      const sessions = sessionCount(window);
      const aperture = fitAperture(window);
      const tJudge = Date.now();
      const run = await judgeAll([...window].reverse(), bin, {
        limit: judgeLimit(),
        aperture,
        onProgress: (done, total) => writeProgress({ phase: 'judging', startedAt, done, total }),
      });
      sw.stage('judge', Date.now() - tJudge, run.fresh, run.turnsMs);
      if (!run.judgments.length) {
        sw.record();
        return fail(['could not read a single exchange — is `claude -p` working?']);
      }

      const state = readState();
      const gate = synthesisDue(state, cachedCount(), new Date(), { every: synthEvery() });
      const noProfile = !existsSync(humanMdPath());

      if (!force && !noProfile && !gate.due) {
        writeState({ ...state, aperture: { ...aperture, computedAt: new Date().toISOString() } });
        if (run.fresh) sw.record();
        ensureLoaded();
        if (summary.length === 0) {
          const judged = run.fresh ? `judged ${run.fresh} new` : 'nothing new to judge';
          summary.push(`profile is fresh enough (${judged} · ${gate.newSince}/${synthEvery()} toward the next build)`);
        } else if (run.fresh) {
          summary.push(`also judged ${run.fresh} new that arrived during the build`);
        }
        break;
      }

      // The expensive rungs — mine, audit, grade, write, load — behind the one gate.
      const signal = run.judgments.filter(hasSignal);
      const corpus: Corpus = {
        sessions,
        exchanges: signal.length,
        topics: topTopics(signal),
        from: window[0].ts.slice(0, 10),
        to: window[window.length - 1].ts.slice(0, 10),
      };
      const pile = allJudgments();
      writeProgress({ phase: 'mining', startedAt });
      const tMine = Date.now();
      const mined = mine(pile, bin);
      sw.stage('mine', Date.now() - tMine, mined.assigned);
      writeProgress({ phase: 'auditing', startedAt });
      const tAudit = Date.now();
      const audited = await auditPatterns(pile, bin);
      sw.stage('audit', Date.now() - tAudit, audited.calls);
      writeProgress({ phase: 'grading', startedAt });
      const tGrade = Date.now();
      const graded = await gradePatterns(pile, bin);
      sw.stage('grade', Date.now() - tGrade, graded.graded);

      writeProgress({ phase: 'writing', startedAt });
      const tSynth = Date.now();
      const built = buildRendered('profile', signal, corpus, bin);
      sw.stage('synthesis', Date.now() - tSynth, built.text ? 1 : 0);
      sw.record();
      if (built.invented?.length) {
        return fail([
          `refused: the writer invented numbers (${built.invented.join(', ')}) — nothing was written or loaded`,
          'this build is discarded; try again with `stratless update --now`',
        ]);
      }
      if (built.malformed) {
        return fail([
          `refused: the writer returned ${built.malformed} instead of a profile — nothing was written or loaded`,
          'this build is discarded; try again with `stratless update --now`',
        ]);
      }
      if (!built.text) {
        return fail(['could not build the profile — the assistant returned nothing; silence beats a guess']);
      }

      atomicWriteFileSync(join(STRATLESS_DIR, 'profile.txt'), `${built.text}\n`);
      writeRender('profile', { builtAt: new Date().toISOString(), sessions, exchanges: signal.length });
      const { humanMd, claudeMd } = injectProfile(built.text);
      writeState({
        ...readState(),
        lastSynthesisAt: new Date().toISOString(),
        judgmentsAtLastSynthesis: cachedCount(),
        aperture: { ...aperture, computedAt: new Date().toISOString() },
      });

      const why = force ? 'forced with --now' : noProfile ? 'first load' : gate.reason;
      const spend = run.fresh ? `${run.fresh} new, ${run.cached} from cache` : `all ${run.cached} from cache`;
      const more = run.deferred ? ` · ${run.deferred} left for next run` : '';
      const gradeNote = graded.graded
        ? ` · graded ${graded.graded}${graded.surprised ? ` (${graded.surprised} surprised${graded.flagged ? `, ${graded.flagged} flagged` : ''})` : ''}`
        : '';
      const mineNote = mined.mined
        ? ` · mined ${mined.assigned} → ${audited.store.patterns.length} patterns${audited.evicted ? `, ${audited.evicted} receipts evicted` : ''}${gradeNote}`
        : gradeNote;
      summary.push(`profile refreshed and loaded (${why} · ${spend}${more}${mineNote})`);
      summary.push(`wrote ${humanMd}`);
      summary.push(`pointed ${claudeMd} at it (via @import)`);
      force = false; // the re-scan pass is never forced
    }

    // The daily version line rides ONLY on --auto consent (the installed hook is the consent
    // artifact) — same rule as before, now spoken through the summary.
    const newer = await dailyCheck(installedVersion(), refreshArmed());
    if (newer) summary.push(`stratless ${newer} available: npm i -g stratless`);

    writeProgress({ phase: 'done', ok: true, startedAt, summary });
    return 0;
  } catch (err) {
    fail([`the worker hit an unexpected error: ${err instanceof Error ? err.message : String(err)}`]);
    return 1;
  } finally {
    releaseLock();
    await sleep(0); // let any last pipe events settle before the process ends
  }
}
