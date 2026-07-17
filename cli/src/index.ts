#!/usr/bin/env node
/**
 * stratless — build your AI a model of who you are, so it stops making you feel stupid.
 *
 *   stratless init      keep your history (add --auto for the after-session refresh)
 *   stratless profile   see the model of you (profile LOOKS; update LOADS)
 *   stratless report    the same picture, written for you to read
 *   stratless update    judge what's new; rebuild + load the profile when due (--now: always)
 *   stratless stop      turn it off — stop refreshing and unload the profile
 *   stratless status    stratless's own state: on or off, and what it has cost
 *   stratless stats     your assistant's activity in a project, in raw counts
 *
 * Runs on your machine. Reads your own history. Nothing leaves.
 */
import { loadEdits, claudeProjectDir, type Edit } from './transcript.js';
import { findAssistant, onPath } from './claude.js';
import { init as doInit, ARCHIVE, stopRefresh, refreshArmed, type InitResult } from './init.js';
import { dailyCheck, fetchLatest, newerThan } from './notify.js';
import { health } from './canary.js';
import { loadRecentExchanges, sessionCount, findExchange } from './exchange.js';
import { judgeAll, cachedCount, cacheHealth, fitAperture, allJudgments, pendingCount, type Judgment } from './judge.js';
import {
  synthesizeProfile,
  synthesizeReport,
  synthesizeProfileFromPatterns,
  synthesizeReportFromPatterns,
  topTopics,
  hasSignal,
  mostRecent,
  type Corpus,
} from './synthesize.js';
import { mine, auditPatterns, gradePatterns, loadPatterns, displayOrder, matchReceiptPrefix, MIN_RECEIPTS, type PatternStore } from './miner.js';
import { injectProfile, removeProfile, ensureLoaded, humanMdPath, claudeMdPath } from './sink.js';
import { readState, writeState, synthesisDue, readRenders, writeRender, SYNTH_EVERY } from './state.js';
import { readUsage } from './usage.js';
import { atomicWriteFileSync, CorruptStoreError } from './atomic.js';
import { acquireLock, releaseLock, readLock, lockFilePath } from './worker.js';
import { startRun, type Stopwatch } from './stopwatch.js';
import { makePalette } from './palette.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Two palettes, one per stream — results style by stdout's TTY, progress by stderr's (clig).
const C = makePalette(process.stdout);
const CE = makePalette(process.stderr);

/**
 * Ran via `npx stratless …`? Then the bare `stratless` is NOT on the person's PATH, and every hint
 * we print as `stratless foo` would come back `command not found` — the single most common way a
 * first run dies. Detect it and make every printed next-step copy-pasteable as-is.
 */
const viaNpx = (): boolean => (process.argv[1] ?? '').includes('_npx') || process.env.npm_command === 'exec';

/** A command hint that actually runs in the shell the person has. */
const hint = (cmd: string): string => (viaNpx() ? `npx ${cmd}` : cmd);

/**
 * If we can't read the log, SAY SO. Never fall through to a confident lie.
 *
 * stratless reads a format it does not own, and Claude Code will change it. `health()` catches
 * exactly that — write-tool calls visible in the log whose input we can no longer read — and refuses
 * instead of guessing. A tool that refuses is trustworthy; one that quietly starts lying is finished.
 */
function guard(cwd: string, edits: Edit[]): boolean {
  const h = health(cwd, edits);
  if (h.ok) return true;
  console.error(`\n  ${C.bad("stratless cannot read your assistant's history.")}\n`);
  console.error(`  ${h.reason?.split('\n').join('\n  ')}\n`);
  return false;
}

function stats(cwd: string): void {
  const edits = loadEdits(cwd);
  if (!guard(cwd, edits)) return;
  if (!edits.length) {
    console.log(`\n  No history found for this project.\n  ${C.dim(`Looked in: ${claudeProjectDir(cwd)}`)}\n`);
    return;
  }
  const lines = edits.reduce((n, e) => n + e.body.split('\n').length, 0);
  const files = new Set(edits.map((e) => e.file)).size;
  const days = new Set(edits.map((e) => e.date));
  const sessions = new Set(edits.map((e) => e.session)).size;
  const first = edits[0].date;

  console.log(`\n  ${C.b('Your assistant, in this project')}\n`);
  console.log(`    lines it wrote            ${C.b(lines.toLocaleString())}`);
  console.log(`    edits it made             ${C.b(edits.length.toLocaleString())}`);
  console.log(`    files it touched          ${C.b(String(files))}`);
  console.log(`    sessions                  ${C.b(String(sessions))}`);
  console.log(`    days                      ${C.b(String(days.size))}`);
  console.log(`\n    ${C.dim(`archive reaches back to ${first} — anything older was deleted by the 30-day cleanup.`)}\n`);
}

const STRATLESS = join(homedir(), '.stratless');

/**
 * The profile is built from the most-recent WINDOW exchanges, never the whole backlog. A profile
 * converges here — the older tail is diminishing returns and, by our own recency logic, stale — and
 * bounding it keeps every run cheap and SAFE regardless of how deep a history goes. (An unbounded pass
 * once judged 3,873 exchanges back-to-back and took a laptop down.)
 */
const JUDGE_WINDOW = 200;

/** Amortize default: a good first profile without chewing the whole window in one run. */
const DEFAULT_JUDGE_LIMIT = 50;

/**
 * Per-run cap on FRESH judge calls (cache hits are always free). STRATLESS_JUDGE_LIMIT overrides it;
 * otherwise a sane default keeps every run — and the after-session hook — cheap, and the window drains
 * over runs.
 */
const judgeLimit = (): number => {
  const env = Number(process.env.STRATLESS_JUDGE_LIMIT);
  if (Number.isFinite(env) && env > 0) return env;
  return DEFAULT_JUDGE_LIMIT;
};

/**
 * The synthesis gate: rebuild the profile only after this many fresh judgments accumulate (or on the
 * backstop / `--now` — see update()). STRATLESS_SYNTH_EVERY overrides it.
 */
const synthEvery = (): number => {
  const env = Number(process.env.STRATLESS_SYNTH_EVERY);
  if (Number.isFinite(env) && env > 0) return env;
  return SYNTH_EVERY;
};

/**
 * Is the profile actually loaded? HUMAN.md exists AND CLAUDE.md carries our redirect block. The one
 * honest definition, shared by `status` and `profile`'s footer.
 */
function profileLoaded(): boolean {
  try {
    return (
      existsSync(humanMdPath()) &&
      existsSync(claudeMdPath()) &&
      readFileSync(claudeMdPath(), 'utf8').includes('<!-- stratless:start -->')
    );
  } catch {
    return false; // treat unreadable as not-loaded
  }
}

/**
 * Build either rendering — from the mined patterns when they exist (the writer as spokesperson,
 * reasoning FROM audited claims; 0.3.1: `report` joins the pattern era and gets the trajectory),
 * falling back to the flat pile read before the first mine. The numbers-lint is enforced here for
 * BOTH audiences: a rendering with an invented numeral is REFUSED, not delivered — a wrong
 * frequency is a lie wearing precision, and silence beats it.
 */
function buildRenderedText(
  kind: 'profile' | 'report',
  signal: Judgment[],
  corpus: Corpus,
  bin: string,
  sw?: Stopwatch,
): string | undefined {
  const store = loadPatterns();
  if (!store.patterns.length) {
    // pre-miner fallback — the 0.2.x flat read
    return kind === 'profile' ? synthesizeProfile(signal, corpus, bin) : synthesizeReport(signal, corpus, bin);
  }
  const synth = kind === 'profile' ? synthesizeProfileFromPatterns : synthesizeReportFromPatterns;
  // C10 (Phase 0's B2): the newest 25 BY TIMESTAMP — this was `signal.slice(-25)`, the oldest 25
  // of a newest-first list, labelled "MOST RECENT" since 0.3.1. mostRecent() sorts; a test pins it.
  const built = synth(store.patterns, mostRecent(signal, 25), corpus, bin);
  if (built.invented?.length) {
    console.error(`\n  ${C.bad('Refused: the writer invented numbers.')} ${C.dim(`(${built.invented.join(', ')})`)}`);
    console.error(`  ${C.dim('Nothing was written or loaded — this build is discarded. Try again with `' + hint('stratless update --now') + '`.')}\n`);
    sw?.record(); // the stages already paid for are measured truth — a refused build must not erase them (C8)
    process.exit(1);
  }
  return built.text;
}

/** The one honest footer both paths of a look share. */
function lookFooter(kind: 'profile' | 'report'): void {
  if (kind === 'profile') {
    console.log(
      profileLoaded()
        ? `  ${C.dim(`loaded: ${humanMdPath()} · refresh it with \`${hint('stratless update')}\``)}\n`
        : `  ${C.it('not loaded yet')} ${C.dim('· load it into your assistant:')} ${C.b(hint('stratless update'))}\n`,
    );
  } else {
    // The evidence loop closes: every report points at the receipts behind it (clig: next command).
    console.log(`  ${C.dim(`the evidence behind this: ${hint('stratless patterns')}`)}\n`);
  }
}

/**
 * THE LOCK AT THE DOOR (C4): every spending command holds the one lock while it works — the
 * after-session hook and a hand-run `update` firing together used to race read-modify-write over
 * judgments.json, the last writer silently discarding the other's paid-for judgments. A second
 * runner says so and leaves; the hook case simply catches up on the next session.
 */
function claimLockOrSay(): boolean {
  if (acquireLock()) {
    // Release on ANY exit — including the refusal paths that call process.exit(1), which skip
    // `finally` blocks. releaseLock only unlinks its own pid, so double-release is a no-op.
    process.once('exit', () => releaseLock());
    return true;
  }
  const holder = readLock();
  console.log(
    `\n  ${C.it('another stratless run is active')}${holder ? C.dim(` (pid ${holder.pid})`) : ''} ${C.dim('— nothing was spent; try again when it finishes.')}`,
  );
  // The honest remedy for a wedged lock (a recycled PID can hold it hostage) — named, not hidden.
  console.log(`  ${C.dim(`stuck, with no stratless actually running? remove the lock: rm ${lockFilePath()}`)}\n`);
  return false;
}

/** The pre-spend disclosure — the person hears the bill BEFORE the first fresh call, never after.
 *  Only when fresh > 0; dim; stderr (it's messaging, not output). */
function preSpend(pending: number): void {
  if (pending <= 0) return;
  process.stderr.write(
    `\n  ${CE.dim(`about to read ${pending} new exchange${pending === 1 ? '' : 's'} on your own claude (each read once, cached forever)`)}\n  ${CE.dim(`the meter: ${hint('stratless status')}`)}\n`,
  );
}

/**
 * The profiler — LOOKING IS FREE (the polish release, Sun's design decision).
 *
 * `profile` and `report` print the LAST BUILT rendering instantly, at zero spend, under a header
 * that carries the build's own date and numbers (from the sidecar — never recomputed at print).
 * Only `update` — and a first-ever look, or an explicit `--now` — spends. One word keeps one
 * meaning across the CLI: `--now` = spend now, skip nothing. `profile` looks, `update` loads:
 * unchanged.
 */
async function profiler(kind: 'profile' | 'report', rest: string[] = []): Promise<void> {
  const force = rest.includes('--now');
  const cachedFile = join(STRATLESS, `${kind}.txt`);
  const meta = readRenders()[kind];

  // The free path: a cached rendering + its build facts. No model, no meter movement.
  if (!force && meta && existsSync(cachedFile)) {
    const text = readFileSync(cachedFile, 'utf8').trimEnd();
    const header = kind === 'profile' ? "WHO YOU'RE WORKING WITH" : 'YOUR PATTERN — what stratless sees';
    console.log(
      `\n  ${C.b(header)}   ${C.dim(`(stratless · built ${meta.builtAt.slice(0, 10)} · ${meta.sessions} sessions · ${meta.exchanges} exchanges)`)}\n`,
    );
    console.log(text.split('\n').map((l) => `  ${l}`).join('\n'));
    console.log(`\n  ${C.dim(`free — this is the last build · rebuild with \`${hint(`stratless ${kind} --now`)}\``)}`);
    lookFooter(kind);
    return;
  }

  // The build path: first-ever look, or --now. This spends — the pre-spend line says so first.
  const bin = findAssistant();
  if (!bin) {
    console.error(`\n  ${C.bad('stratless needs your assistant to read your history.')}`);
    console.error(`  ${C.dim('It borrows the `claude` you already have — no API key, nothing new to install.')}`);
    console.error(`  ${C.dim('Install Claude Code, then run this again.')}\n`);
    process.exit(1);
  }

  const window = loadRecentExchanges(JUDGE_WINDOW);
  if (!window.length) {
    console.log(`\n  No conversations found yet.`);
    console.log(`  ${C.dim(`Talk to Claude Code a few times, run \`${hint('stratless init')}\`, then try this again.`)}\n`);
    return;
  }

  if (!claimLockOrSay()) return; // C4: one spender at a time
  try {
    const sw = startRun(); // C8: the stopwatch runs wherever money runs
    const sessions = sessionCount(window);
    // The aperture: the judge's view sizes, fitted to THIS user's window (p90 × 1.2, clamped) —
    // computed in code, costs nothing, never part of the cache identity.
    const aperture = fitAperture(window);
    preSpend(pendingCount([...window].reverse(), judgeLimit()));
    process.stderr.write(`\n  ${CE.dim(`reading ${window.length.toLocaleString()} recent exchanges across ${sessions} sessions…`)}\n`);
    const tJudge = Date.now();
    const run = await judgeAll([...window].reverse(), bin, {
      limit: judgeLimit(),
      aperture,
      onProgress: (done, total) => process.stderr.write(`\r  ${CE.dim(`judging ${done}/${total} new…`)}   `),
    });
    sw.stage('judge', Date.now() - tJudge, run.fresh, run.turnsMs);
    process.stderr.write(`\r${' '.repeat(44)}\r`);

    if (!run.judgments.length) {
      console.error(`\n  ${C.bad('Could not read a single exchange.')} ${C.dim('Is `claude -p` working? Try:  claude -p hello')}\n`);
      sw.record(); // whatever was measured before the refusal is still measured truth (C8)
      process.exit(1);
    }

    // Only judgments that carry signal reach the writer — a `none` line is, by definition, nothing
    // to reason from. The corpus counts what the writer actually sees, so the numbers stay honest.
    const signal = run.judgments.filter(hasSignal);
    const corpus: Corpus = {
      sessions,
      exchanges: signal.length,
      topics: topTopics(signal),
      from: window[0].ts.slice(0, 10),
      to: window[window.length - 1].ts.slice(0, 10),
    };

    const tSynth = Date.now();
    const text = buildRenderedText(kind, signal, corpus, bin, sw);
    sw.stage('synthesis', Date.now() - tSynth, text ? 1 : 0);

    if (!text) {
      console.error(`\n  ${C.bad(`Could not build your ${kind}.`)} ${C.dim('The assistant returned nothing — silence beats a guess.')}\n`);
      sw.record(); // the judge stage's rates survive the refusal (C8)
      process.exit(1);
    }

    atomicWriteFileSync(cachedFile, `${text}\n`);
    writeRender(kind, { builtAt: new Date().toISOString(), sessions, exchanges: signal.length });
    sw.record();

    const header = kind === 'profile' ? "WHO YOU'RE WORKING WITH" : 'YOUR PATTERN — what stratless sees';
    console.log(`\n  ${C.b(header)}   ${C.dim(`(stratless · ${sessions} sessions · ${signal.length} exchanges)`)}\n`);
    console.log(
      text
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n'),
    );
    const spend = run.fresh
      ? `${run.fresh} new read${run.fresh === 1 ? '' : 's'}, ${run.cached} from cache`
      : `all ${run.cached} from cache`;
    const more = run.deferred ? C.dim(` · ${run.deferred} left for next run`) : '';
    console.log(`\n  ${C.dim(`${spend} · saved to ${cachedFile}`)}${more}`);
    lookFooter(kind);
  } finally {
    releaseLock();
  }
}

/**
 * UPDATE — the after-session refresh: read what's new, and rebuild + LOAD the profile when it's DUE.
 *
 * This is what the silent Stop hook runs, so it must be cheap by default. Judging a session's new
 * exchanges costs cents; the SYNTHESIS is the expensive read (~32 judge calls' worth — measured,
 * 2026-07-16), so it is gated: sessions accumulate judgments, the profile consumes them in batches.
 * Due = enough new evidence (synthEvery) · a stale profile with anything new at all (the backstop)
 * · no profile on disk yet · the cache was reset · or `--now`. A gated skip still guarantees an
 * existing profile is loaded (covers `update` after `stop`) — the skip is invisible, only the cost
 * is missing.
 */
async function update(rest: string[]): Promise<void> {
  const force = rest.includes('--now');
  const bin = findAssistant();
  if (!bin) {
    console.error(`\n  ${C.bad('stratless needs your assistant to read your history.')}`);
    console.error(`  ${C.dim('It borrows the `claude` you already have. Install Claude Code, then try again.')}\n`);
    process.exit(1);
  }

  const window = loadRecentExchanges(JUDGE_WINDOW);
  if (!window.length) {
    console.log(`\n  No conversations found yet.\n  ${C.dim(`Talk to Claude Code a few times, run \`${hint('stratless init')}\`, then try this.`)}\n`);
    return;
  }

  if (!claimLockOrSay()) return; // C4: the hook and a hand-run update no longer race the cache
  try {
    const sw = startRun(); // C8: the stopwatch runs wherever money runs
    const sessions = sessionCount(window);
    // The aperture: the judge's view sizes, fitted to THIS user's window (p90 × 1.2, clamped) —
    // computed in code, costs nothing, never part of the cache identity.
    const aperture = fitAperture(window);
    preSpend(pendingCount([...window].reverse(), judgeLimit()));
    process.stderr.write(`\n  ${CE.dim(`reading ${window.length.toLocaleString()} recent exchanges across ${sessions} sessions…`)}\n`);
    const tJudge = Date.now();
    const run = await judgeAll([...window].reverse(), bin, {
      limit: judgeLimit(),
      aperture,
      onProgress: (done, total) => process.stderr.write(`\r  ${CE.dim(`judging ${done}/${total} new…`)}   `),
    });
    sw.stage('judge', Date.now() - tJudge, run.fresh, run.turnsMs);
    process.stderr.write(`\r${' '.repeat(44)}\r`);

    if (!run.judgments.length) {
      console.error(`\n  ${C.bad('Could not read a single exchange.')} ${C.dim('Is `claude -p` working?')}\n`);
      sw.record(); // whatever was measured before the refusal is still measured truth (C8)
      process.exit(1);
    }

    // THE GATE — decide before spending the expensive read. cachedCount() runs after judging, so this
    // session's fresh judgments count toward the gate. `--now`, a missing HUMAN.md, or a due verdict
    // (K reached / backstop / cache reset / first build) all open it; otherwise the cheap path.
    const state = readState();
    const gate = synthesisDue(state, cachedCount(), new Date(), { every: synthEvery() });
    const noProfile = !existsSync(humanMdPath());
    // The daily version line rides ONLY on --auto consent (the installed hook is the consent
    // artifact) — a plain-init user's update makes zero registry calls, provably (notify tests).
    const versionLine = async (): Promise<void> => {
      const newer = await dailyCheck(version(), refreshArmed());
      if (newer) console.log(`  ${C.dim(`stratless ${newer} available: npm i -g stratless`)}`);
    };

    if (!force && !noProfile && !gate.due) {
      // Record the fitted aperture even on the cheap path — state.json is where it's visible.
      writeState({ ...state, aperture: { ...aperture, computedAt: new Date().toISOString() } });
      if (run.fresh) sw.record(); // the cheap path still measured fresh judging — keep the rate data
      const ensured = ensureLoaded();
      const judged = run.fresh ? `judged ${run.fresh} new` : 'nothing new to judge';
      console.log(`\n  ${C.ok('profile is fresh enough')}  ${C.dim(`(${judged} · ${gate.newSince}/${synthEvery()} toward the next build)`)}`);
      if (ensured) console.log(`  ${C.dim(`loaded: ${humanMdPath()}`)}`);
      console.log(`  ${C.dim(`rebuild now with \`${hint('stratless update --now')}\``)}`);
      await versionLine();
      console.log('');
      return;
    }

    // Same signal filter as `profile` — `none` lines never reach the writer (see profiler()).
    const signal = run.judgments.filter(hasSignal);
    const corpus: Corpus = {
      sessions,
      exchanges: signal.length,
      topics: topTopics(signal),
      from: window[0].ts.slice(0, 10),
      to: window[window.length - 1].ts.slice(0, 10),
    };

    // THE MINER + THE AUDITOR — behind the same gate as the synthesis, so the expensive passes all
    // ride one cadence. The analyst assigns the un-mined judgments (whole pile, batched); a separate
    // mind then checks every fresh receipt against its statement before the writer may lean on it.
    const pile = allJudgments();
    process.stderr.write(`  ${CE.dim('mining patterns…')}   `);
    const tMine = Date.now();
    const mined = mine(pile, bin);
    sw.stage('mine', Date.now() - tMine, mined.assigned);
    const tAudit = Date.now();
    const audited = await auditPatterns(pile, bin);
    sw.stage('audit', Date.now() - tAudit, audited.calls);
    // THE GRADER (0.3.2) — every admitted pattern is a dated prediction; the window's new evidence
    // grades it: confirmed / silent / surprised. Runs after mine (receipts current) and audit
    // (padding evicted), so it grades clean claims against fresh reality.
    const tGrade = Date.now();
    const graded = await gradePatterns(pile, bin);
    sw.stage('grade', Date.now() - tGrade, graded.graded);
    process.stderr.write(`\r${' '.repeat(24)}\r`);

    const tSynth = Date.now();
    const text = buildRenderedText('profile', signal, corpus, bin, sw);
    sw.stage('synthesis', Date.now() - tSynth, text ? 1 : 0);
    if (!text) {
      console.error(`\n  ${C.bad('Could not build your profile.')} ${C.dim('The assistant returned nothing — silence beats a guess.')}\n`);
      sw.record(); // the judge/mine/audit/grade walls survive the refusal (C8)
      process.exit(1);
    }

    atomicWriteFileSync(join(STRATLESS, 'profile.txt'), `${text}\n`);
    writeRender('profile', { builtAt: new Date().toISOString(), sessions, exchanges: signal.length });
    const { humanMd, claudeMd } = injectProfile(text);
    // Spread the CURRENT state so bookkeeping the build didn't touch (the stopwatch ring) survives.
    writeState({
      ...readState(),
      lastSynthesisAt: new Date().toISOString(),
      judgmentsAtLastSynthesis: cachedCount(),
      aperture: { ...aperture, computedAt: new Date().toISOString() },
    });
    sw.record();

    const why = force ? 'forced with --now' : noProfile ? 'first load' : gate.reason;
    const spend = run.fresh ? `${run.fresh} new, ${run.cached} from cache` : `all ${run.cached} from cache`;
    const more = run.deferred ? ` · ${run.deferred} left for next run` : '';
    const gradeNote = graded.graded
      ? ` · graded ${graded.graded}${graded.surprised ? ` (${graded.surprised} surprised${graded.flagged ? `, ${graded.flagged} flagged` : ''})` : ''}`
      : '';
    const mineNote = mined.mined
      ? ` · mined ${mined.assigned} → ${audited.store.patterns.length} patterns${audited.evicted ? `, ${audited.evicted} receipts evicted` : ''}${gradeNote}`
      : gradeNote;
    console.log(`\n  ${C.ok('profile refreshed and loaded')}  ${C.dim(`(${why} · ${spend}${more}${mineNote})`)}`);
    console.log(`  ${C.dim(`wrote ${humanMd}`)}`);
    console.log(`  ${C.dim(`pointed ${claudeMd} at it (via @import)`)}`);
    await versionLine();
    console.log('');
  } finally {
    releaseLock();
  }
}

/**
 * PATTERNS — the falsifiability made visible. Every claim the profile may lean on, with its count,
 * window, trend, stability, audit tally, and the receipts underneath: no reply behind it, no claim
 * (Law 2). Reads patterns.json locally; spends nothing.
 */
function patternsCmd(rest: string[]): void {
  const all = rest.includes('--all');
  const store = loadPatterns();
  if (!store.patterns.length && !store.candidates.length) {
    console.log(`\n  No patterns yet — the miner builds them at each profile rebuild.`);
    console.log(`  ${C.dim(`Run \`${hint('stratless update --now')}\` to mine your first pass.`)}\n`);
    return;
  }

  const KIND_LABEL: Record<string, string> = {
    know: 'WHAT THEY KNOW',
    think: 'HOW THEY THINK',
    work: 'HOW THEY WORK',
    direction: 'DIRECTION',
    'failure-signals': 'FAILURE SIGNALS',
    triggers: 'TRIGGERS',
    unsorted: 'UNSORTED — fits no kind yet (this pile is where the next law hides)',
  };

  console.log(
    `\n  ${C.b('your patterns')}   ${C.dim(
      `(${store.patterns.length} admitted · ${store.candidates.length} candidates · last mined ${store.minedAt?.slice(0, 10) ?? 'never'})`,
    )}`,
  );
  const ordered = displayOrder(store);
  let idx = 0;
  for (const kind of Object.keys(KIND_LABEL)) {
    const ps = ordered.filter((p) => p.kind === kind);
    if (!ps.length) continue;
    console.log(`\n  ${C.b(KIND_LABEL[kind])}`);
    for (const p of ps) {
      idx++;
      const audit = p.audit ? ` · audited ${p.audit.kept}/${p.audit.kept + p.audit.evicted}` : ' · unaudited';
      console.log(`    ${C.ok(`${idx}.`)} ${p.statement}`);
      console.log(`       ${C.dim(`${p.count}x · ${p.window.from} → ${p.window.to} · ${p.trend} · ${p.stability} · ${p.confidence}${audit}`)}`);
      console.log(`       ${C.dim(`prove it: ${hint(`stratless receipt ${idx}`)}`)}`);
    }
  }
  if (store.candidates.length) {
    if (all) {
      console.log(`\n  ${C.b('CANDIDATES')} ${C.dim(`(fewer than ${MIN_RECEIPTS} receipts — an anecdote is not a category; never shown to the writer)`)}`);
      for (const p of store.candidates) console.log(`    ${C.dim(`◦ ${p.statement} (${p.count}x · ${p.kind})`)}`);
    } else {
      console.log(`\n  ${C.dim(`+ ${store.candidates.length} candidate${store.candidates.length === 1 ? '' : 's'} below the evidence bar · see them with --all`)}`);
    }
  }
  console.log(`\n  ${C.dim('Every line traces to real exchanges through its receipts. No receipt, no claim.')}\n`);
}

/** One field of a dereferenced exchange, display-capped like the judge's own aperture. */
const receiptField = (s: string): string => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= 500 ? flat : `${flat.slice(0, 300)} … ${flat.slice(-180)}`;
};

/** Print one receipt as a readable exchange — or the honest-failure lesson when the transcript
 *  predates the archive and was reaped (this is exactly what init protects against). */
function printReceipt(hash: string, byHash: Map<string, Judgment>): void {
  const j = byHash.get(hash);
  if (!j) {
    console.log(`  ${C.dim(`── ${hash} — no judgment on record (evicted or from another era)`)}\n`);
    return;
  }
  console.log(`  ${C.dim(`── ${j.ts.slice(0, 10)} · session ${j.session.slice(0, 8)} ─────────────`)}`);
  const ex = findExchange(j.session, hash);
  if (!ex) {
    console.log(`  ${C.warn('The judgment survives; the raw transcript behind it was deleted by Claude Code\'s')}`);
    console.log(`  ${C.warn('30-day cleanup before your archive existed. This is what init protects against.')}`);
    console.log(`  ${C.dim(`what the judge recorded: ${j.line}`)}\n`);
    return;
  }
  console.log(`  ${C.you('YOU ASKED')}     ${receiptField(ex.prompt)}`);
  console.log(`  ${C.it('IT SAID')}       ${receiptField(ex.said)}`);
  console.log(`  ${C.you('YOU REACTED')}   ${receiptField(ex.reaction)}\n`);
}

/**
 * RECEIPT — dereference a claim back to the raw exchanges behind it. The falsifiability loop
 * closes here: patterns → pick a number → the actual moments, readable. Free; zero model calls.
 */
function receiptCmd(rest: string[]): void {
  const showAll = rest.includes('--all');
  const arg = rest.find((a) => !a.startsWith('--'));
  const store = loadPatterns();
  const ordered = displayOrder(store);

  if (!ordered.length) {
    console.log(`\n  No patterns yet — nothing to prove. Build them: ${C.b(hint('stratless update --now'))}\n`);
    return;
  }
  if (!arg) {
    // clig: a bare run teaches with a REAL number from the user's own store, never scolds.
    console.log(`\n  which claim? try: ${C.b(hint('stratless receipt 1'))}   ${C.dim(`(list them: ${hint('stratless patterns')})`)}\n`);
    return;
  }

  const byHash = new Map(allJudgments().map((j) => [j.hash, j]));
  const n = Number(arg);

  if (Number.isInteger(n) && n >= 1) {
    if (n > ordered.length) {
      console.log(`\n  Only ${ordered.length} claim${ordered.length === 1 ? '' : 's'} on file — list them: ${C.b(hint('stratless patterns'))}\n`);
      return;
    }
    const p = ordered[n - 1];
    const shown = showAll ? p.receipts : p.receipts.slice(0, 3);
    console.log(`\n  ${C.b(p.statement)}`);
    console.log(`  ${C.dim(`${p.receipts.length} receipt${p.receipts.length === 1 ? '' : 's'} · showing ${shown.length}${showAll || shown.length === p.receipts.length ? '' : ' (--all for every one)'}`)}\n`);
    for (const h of shown) printReceipt(h, byHash);
    return;
  }

  // Hash-prefix mode (git-style) — for power users and bug reports.
  const matches = matchReceiptPrefix(store, arg);
  if (!matches.length) {
    console.log(`\n  No receipt starts with "${arg}". ${C.dim(`Claim numbers work too: ${hint('stratless receipt 1')}`)}\n`);
    return;
  }
  if (matches.length > 1) {
    console.log(`\n  "${arg}" matches ${matches.length} receipts:`);
    for (const m of matches) console.log(`    ${m.hash}  ${C.dim(`(claim ${m.claims.join(', ')})`)}`);
    console.log('');
    return;
  }
  const m = matches[0];
  console.log(`\n  ${C.dim(`receipt ${m.hash} · cited by claim ${m.claims.join(', ')}`)}\n`);
  printReceipt(m.hash, byHash);
}

/**
 * STOP — the off switch. Removes the after-session refresh hook AND unloads the profile from CLAUDE.md;
 * the HUMAN.md file is left in place (your data). Being able to shut it up completely is half of why a
 * tool that reads everything earns trust.
 */
function stop(): void {
  const hookRemoved = stopRefresh();
  const unloaded = removeProfile();
  if (!hookRemoved && !unloaded) {
    console.log(`\n  ${C.dim('nothing to stop — no refresh hook, no loaded profile.')}\n`);
    return;
  }
  console.log(`\n  ${C.ok('stratless is off.')}`);
  if (hookRemoved) console.log(`  ${C.dim('· after-session refresh removed')}`);
  if (unloaded) console.log(`  ${C.dim('· profile unloaded from your CLAUDE.md')}`);
  console.log(`  ${C.dim('Your ~/.claude/HUMAN.md is left as-is — delete it yourself if you want it gone.')}`);
  console.log(`  ${C.dim(`Run \`${hint('stratless update')}\` to load it again, \`${hint('stratless init --auto')}\` for background refresh.`)}\n`);
}

/**
 * STATUS — stratless's own state, and what it has cost. Distinct from `stats` (which counts your
 * ASSISTANT's activity in a project): this answers "is stratless on, is my profile loaded, and how
 * much of my own plan has it spent?" Every line is read locally and for free — it spends nothing.
 */
async function status(rest: string[] = []): Promise<void> {
  // `--check` is the everyone-door for version news: user-initiated, on-screen, announced.
  // Plain `status` stays fully offline — the trust posture is not tunable.
  if (rest.includes('--check')) {
    console.log(`\n  ${C.dim('checking npm for a newer version…')}`);
    const latest = await fetchLatest();
    const installed = version();
    if (!latest) console.log(`  ${C.warn('could not reach the registry')} ${C.dim('(offline? try again later)')}\n`);
    else if (newerThan(latest, installed))
      console.log(`  installed ${C.b(installed)} · latest ${C.b(latest)} — update: ${C.b('npm i -g stratless')}\n`);
    else console.log(`  ${C.ok('up to date')} ${C.dim(`(installed ${installed} = latest)`)}\n`);
    return;
  }

  // 1. Is the after-session refresh installed? (the Stop hook we write into settings.json)
  const refresh = refreshArmed();

  // 2. Is the profile actually loaded? One definition, shared with `profile`'s footer.
  const human = humanMdPath();
  const humanExists = existsSync(human);
  const loaded = profileLoaded();

  // 3. When was it last refreshed? HUMAN.md's mtime is the honest answer.
  let last = 'never';
  try {
    if (humanExists) last = statSync(human).mtime.toISOString().slice(0, 10);
  } catch {
    /* leave as "never" */
  }

  // C2: `status` is the truth surface — a damaged cache is LABELLED, never shown as a confident 0.
  const cache = cacheHealth();
  const u = readUsage();
  // Tokens are the honest unit — a subscription spends quota, not dollars — and the cache tokens
  // (the ~17–24k harness overhead every borrowed call carries) ARE the consumption, so they count.
  // The dollar figure is the API-equivalent, labelled as exactly that.
  const tokens = u.inputTokens + u.outputTokens + u.cacheCreationTokens + u.cacheReadTokens;
  const fmtTok = (t: number): string =>
    t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1000 ? `${Math.round(t / 1000)}k` : String(t);
  const spend = `${fmtTok(tokens)} tokens across ${u.calls.toLocaleString()} read${u.calls === 1 ? '' : 's'}`;
  const api = `≈ $${u.costUsd.toFixed(2)} at API rates, on your own claude`;
  const FEATURE_LABEL: Record<string, string> = { judge: 'judging', synthesis: 'profile builds', miner: 'mining', audit: 'audits', grade: 'grading' };
  const byFeature = Object.entries(u.byFeature)
    .map(([f, t]) => `${FEATURE_LABEL[f] ?? f} $${t.costUsd.toFixed(2)} (${t.calls.toLocaleString()})`)
    .join(' · ');

  console.log(`\n  ${C.b('stratless status')}\n`);
  console.log(`    after-session refresh   ${refresh ? C.ok('on') : C.dim('off')}`);
  console.log(`    profile loaded          ${loaded ? C.ok('yes') : C.dim('no')}${humanExists ? `  ${C.dim(human)}` : ''}`);
  if (cache.ok) {
    console.log(`    exchanges judged        ${C.b(cache.count.toLocaleString())}`);
  } else {
    console.log(`    exchanges judged        ${C.warn('unreadable — the judgment cache is damaged')}`);
    console.log(`                            ${C.dim(`move it aside to rebuild: mv ${cache.file} ${cache.file}.damaged`)}`);
  }
  let store: PatternStore | undefined;
  try {
    store = loadPatterns();
  } catch {
    console.log(`    patterns mined          ${C.warn('unreadable — the pattern store is damaged')}`);
  }
  if (store && (store.patterns.length || store.candidates.length)) {
    console.log(
      `    patterns mined          ${C.b(String(store.patterns.length))}${store.candidates.length ? C.dim(`  (+${store.candidates.length} candidates)`) : ''}`,
    );
  }
  console.log(`    last refresh            ${C.dim(last)}`);
  console.log(`    spent so far            ${C.b(spend)}  ${C.dim(api)}`);
  if (byFeature) console.log(`                            ${C.dim(byFeature)}`);
  // C11: the meter's own blind spots, shown the moment they exist — silent accounting is the bug.
  const gaps: string[] = [];
  if (u.unmeteredCalls) gaps.push(`${u.unmeteredCalls} call${u.unmeteredCalls === 1 ? '' : 's'} unmetered (no receipt — true cost unknown)`);
  if (u.pinEscapedCalls) gaps.push(`${u.pinEscapedCalls} ran on your default model (pin dropped)`);
  if (gaps.length) console.log(`    fallback calls          ${C.warn(gaps.join(' · '))}`);
  if (!refresh) console.log(`\n  ${C.dim(`Run \`${hint('stratless init --auto')}\` to turn the after-session refresh on.`)}`);
  console.log('');
}

/** The installed version, read from the package.json that ships next to dist/. */
function version(): string {
  try {
    const pkg = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return (JSON.parse(readFileSync(pkg, 'utf8')).version as string) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const cwd = process.cwd();

  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    console.log(`stratless ${version()}`);
    return;
  }

  if (cmd === 'init') {
    const auto = args.includes('--auto');
    let r: InitResult;
    try {
      r = doInit({ auto });
    } catch (err) {
      // Refuse, don't clobber — say what's wrong (a malformed settings.json) and stop cleanly.
      console.error(`\n  ${C.bad('stratless could not update your settings.')}`);
      console.error(`  ${C.dim(String(err instanceof Error ? err.message : err).split('\n').join('\n  '))}\n`);
      process.exit(1);
    }
    console.log(`\n  ${C.ok('stratless is keeping your history.')}\n`);
    console.log(`    reaper           ${C.dim(String(r.before))} → ${C.b(`${r.after} days`)}`);
    console.log(`    archived         ${C.b(String(r.copied))} transcripts${r.skipped ? C.dim(` (${r.skipped} already current)`) : ''}`);
    console.log(`    kept at          ${C.dim(ARCHIVE)}`);
    console.log(`    after-session    ${auto ? C.b('auto-refresh ON') : C.dim('auto-refresh off')}`);
    console.log(`\n  ${C.dim('Claude Code deletes transcripts after 30 days — per file, even in a project you')}`);
    console.log(`  ${C.dim('use daily. Anything already gone is gone. Everything from here is kept.')}\n`);
    console.log(
      `  ${C.dim(
        auto
          ? `Auto-refresh rebuilds your profile in the background after each session. It also checks npm once a day so you hear about fixes. Turn it all off with: ${hint('stratless stop')}`
          : `Auto-refresh is off. Turn on background updates any time with: ${hint('stratless init --auto')}`,
      )}\n`,
    );
    if (auto && !onPath('stratless')) {
      // The hook we just installed runs the bare `stratless` — from an npx-only install it will
      // fail silently on every session. Never arm a background job without saying it can't run yet.
      console.log(`  ${C.warn('heads up:')} ${C.dim('the background refresh runs `stratless update`, but `stratless` is not on')}`);
      console.log(`  ${C.dim('your PATH yet. Install it properly or the refresh will silently do nothing:')} ${C.b('npm install -g stratless')}\n`);
    }
    console.log(`  ${C.dim('Next:')} ${hint('stratless profile')}\n`);
    return;
  }

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(`
  ${C.b('stratless')} — build your AI a model of who you are

    ${C.dim('get started:')}  ${C.b('npx stratless init')}

    ${C.b('stratless init')}       ${C.dim('keep your history safe (add --auto for background refresh)')}
    ${C.b('stratless profile')}    ${C.dim('see the model of you — free, instant (--now: rebuild)')}
    ${C.b('stratless report')}     ${C.dim('the same picture, written for you to read — free (--now: rebuild)')}
    ${C.b('stratless update')}     ${C.dim('judge what is new; mine + rebuild + load the profile when due (--now: always)')}
    ${C.b('stratless patterns')}   ${C.dim('every claim with its receipts: counts, trends, evidence (--all: candidates too)')}
    ${C.b('stratless receipt')}    ${C.dim('prove a claim: the raw exchanges behind it (receipt 3, or a hash prefix)')}
    ${C.b('stratless stop')}       ${C.dim('turn it off — stop refreshing and unload the profile')}
    ${C.b('stratless status')}     ${C.dim("stratless's own state and what it has cost (--check: newer version?)")}
    ${C.b('stratless stats')}      ${C.dim("your assistant's activity in a project: raw counts, free")}

  ${C.dim('Runs on your machine. Reads your own history. Nothing leaves.')}
  ${C.dim('docs: https://stratless.com/docs')}
`);
    return;
  }

  // C2's command-layer half: a damaged spend-cache surfaces as ONE clear refusal, wherever it was
  // hit. Reading corruption as "empty" would re-bill the person's whole history without a word.
  try {
    if (cmd === 'stats') return stats(cwd);
    if (cmd === 'status') return await status(args.slice(1));
    if (cmd === 'profile') return await profiler('profile', args.slice(1));
    if (cmd === 'report') return await profiler('report', args.slice(1));
    if (cmd === 'update') return await update(args.slice(1));
    if (cmd === 'patterns') return patternsCmd(args.slice(1));
    if (cmd === 'receipt') return receiptCmd(args.slice(1));
    if (cmd === 'stop') return stop();
  } catch (err) {
    if (err instanceof CorruptStoreError) {
      console.error(`\n  ${C.bad('stratless cannot read its own cache — and will not re-bill you over it.')}`);
      console.error(`  ${C.dim(`${err.file} is damaged. Everything in it was paid for on your claude; reading it`)}`);
      console.error(`  ${C.dim('as empty would silently re-spend your whole history. Move it aside, then rerun:')}`);
      console.error(`\n    mv ${err.file} ${err.file}.damaged\n`);
      process.exit(1);
    }
    throw err;
  }

  console.error(`  unknown command: ${cmd}`);
  process.exit(1);
}

void main();
