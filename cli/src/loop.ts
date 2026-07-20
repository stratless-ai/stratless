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
import { loadRecentExchanges, sessionCount } from './exchange.js';
import { judgeAll, cachedCount, allJudgments, fitAperture } from './judge.js';
import { mine, auditPatterns, gradePatterns, loadPatterns } from './miner.js';
import { dailyCheck } from './notify.js';
import { refreshArmed } from './init.js';
import { injectProfile, ensureLoaded, humanMdPath } from './sink.js';
import { readState, writeState, synthesisDue, writeRender, writeBuildCorpus, SYNTH_EVERY } from './state.js';
import { startRun } from './stopwatch.js';
import { readUsage, diffUsage, fmtTokens } from './usage.js';
import { killActiveSession } from './stream.js';
import {
  synthesizeProfile,
  synthesizeReport,
  synthesizeProfileFromPatterns,
  synthesizeReportFromPatterns,
  artifactShapeProblem,
  mostRecent,
  topProjects,
  type Corpus,
} from './synthesize.js';
import { acquireLock, releaseLock, lockFilePath } from './worker.js';
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
      for (const e of window) knownHashes.add(e.hash);
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
        const judged = run.fresh ? `judged ${run.fresh} new` : 'nothing new to judge';
        summary.push(`profile is fresh enough (${judged} · ${gate.newSince}/${synthEvery()} toward the next build)`);
      } else {
        // The expensive rungs — mine, audit, grade, write, load — behind the one gate.
        const signal = run.judgments;
        const corpus: Corpus = {
          sessions,
          exchanges: signal.length,
          projects: topProjects(signal),
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

        const builtAt = new Date().toISOString();
        atomicWriteFileSync(join(STRATLESS_DIR, 'profile.txt'), `${built.text}\n`);
        writeRender('profile', { builtAt, sessions, exchanges: signal.length });
        // Freeze this build's corpus so `profile --read` can render the human-facing note over
        // EXACTLY this evidence later (lazy, no re-read) — never a divergent window.
        writeBuildCorpus({ builtAt, corpus, signalHashes: signal.map((j) => j.hash) });
        const { humanMd, claudeMd } = injectProfile(built.text);
        writeState({
          ...readState(),
          lastSynthesisAt: builtAt,
          judgmentsAtLastSynthesis: cachedCount(),
          aperture: { ...aperture, computedAt: builtAt },
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
      }

      // THE RE-SCAN — one look back for exchanges that arrived WHILE working. Arrivals only
      // (never the deferred backlog: the announced bill is a promise, and the window drains over
      // runs by design), rung 1 only (gates wait for the next wake — no silent second mine).
      const window2 = loadRecentExchanges(JUDGE_WINDOW);
      const arrivals = window2.filter((e) => !knownHashes.has(e.hash));
      if (arrivals.length) {
        const sw2 = startRun();
        const t2 = Date.now();
        const run2 = await judgeAll([...arrivals].reverse(), bin, {
          limit: judgeLimit(),
          aperture: fitAperture(window2),
          onProgress: (done, total) => writeProgress({ phase: 'judging', startedAt, done, total }),
        });
        sw2.stage('judge', Date.now() - t2, run2.fresh, run2.turnsMs);
        if (run2.fresh) {
          sw2.record();
          summary.push(`also judged ${run2.fresh} new that arrived during the build`);
        }
      }
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
