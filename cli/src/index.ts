#!/usr/bin/env node
/**
 * stratless — build your AI a model of who you are, so it stops making you feel stupid.
 *
 *   stratless init      keep your history (add --auto for the after-session refresh)
 *   stratless profile   see the model of you (--read: your prose copy · LOOKS; update LOADS)
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
import { judgeAll, cacheHealth, fitAperture, allJudgments, pendingCount, type Judgment } from './judge.js';
import { topProjects, type Corpus } from './synthesize.js';
import { loadPatterns, displayOrder, matchReceiptPrefix, MIN_RECEIPTS, type PatternStore } from './miner.js';
import { removeProfile, humanMdPath, claudeMdPath } from './sink.js';
import { readRenders, writeRender, writeBuildCorpus, readBuildCorpus, type RenderMeta } from './state.js';
import { readUsage } from './usage.js';
import { atomicWriteFileSync, CorruptStoreError } from './atomic.js';
import { acquireLock, releaseLock, readLock, lockFilePath, lockIsStale, stopWorker, spawnDetached, resolveBinPath } from './worker.js';
import { startRun, type Stopwatch } from './stopwatch.js';
import { runWorker, buildRendered, installedVersion, JUDGE_WINDOW, judgeLimit } from './loop.js';
import { readProgress, type Progress } from './progress.js';
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
  const built = buildRendered(kind, signal, corpus, bin);
  if (built.invented?.length) {
    console.error(`\n  ${C.bad('Refused: the writer invented numbers.')} ${C.dim(`(${built.invented.join(', ')})`)}`);
    console.error(`  ${C.dim('Nothing was written or loaded — this build is discarded. Try again with `' + hint('stratless update --now') + '`.')}\n`);
    sw?.record(); // the stages already paid for are measured truth — a refused build must not erase them (C8)
    process.exit(1);
  }
  if (built.malformed) {
    console.error(`\n  ${C.bad(`Refused: the writer returned ${built.malformed} instead of a ${kind}.`)}`);
    console.error(`  ${C.dim('Nothing was written or loaded — this build is discarded. Try again with `' + hint('stratless update --now') + '`.')}\n`);
    sw?.record();
    process.exit(1);
  }
  return built.text;
}

/** The one honest footer both paths of a look share. */
function lookFooter(kind: 'profile' | 'report'): void {
  if (kind === 'profile') {
    console.log(
      profileLoaded()
        ? `  ${C.dim(`loaded: ${humanMdPath()} · refresh it with \`${hint('stratless update')}\``)}`
        : `  ${C.it('not loaded yet')} ${C.dim('· load it into your assistant:')} ${C.b(hint('stratless update'))}`,
    );
    console.log(`  ${C.dim(`read it as prose: \`${hint('stratless profile --read')}\``)}\n`);
  } else {
    // The evidence loop closes: every read points at the receipts behind it (clig: next command).
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
 * `profile` prints the LAST BUILT structured rendering instantly, at zero spend, under a header that
 * carries the build's own date and numbers (from the sidecar — never recomputed at print). Only
 * `update` — and a first-ever look, or an explicit `--now` — spends. `profile` looks, `update` loads.
 *
 * `profile --read` is the human-facing prose companion (the folded-in `report`): the same evidence,
 * a different audience. It is LAZY — the main function (the structured profile that loads into
 * HUMAN.md) earns the synthesis; the read renders only when someone wants it, over the profile's
 * FROZEN corpus, so it can never describe a different window than the loaded profile. (Sun's
 * principle: don't spend on a secondary render until it proves useful.)
 */
async function profiler(rest: string[] = []): Promise<void> {
  if (rest.includes('--read')) return profileRead();

  const cachedFile = join(STRATLESS, 'profile.txt');
  const meta = readRenders().profile;

  // The look: a cached rendering + its build facts. No model, no meter movement. `profile` never
  // rebuilds; that is `update`'s job (it also loads). A first-ever look with nothing cached builds once.
  if (meta && existsSync(cachedFile)) {
    const text = readFileSync(cachedFile, 'utf8').trimEnd();
    console.log(
      `\n  ${C.b("WHO YOU'RE WORKING WITH")}   ${C.dim(`(stratless · built ${meta.builtAt.slice(0, 10)} · ${meta.sessions} sessions · ${meta.exchanges} exchanges)`)}\n`,
    );
    console.log(text.split('\n').map((l) => `  ${l}`).join('\n'));
    console.log(`\n  ${C.dim('free — this is the last build')}`);
    lookFooter('profile');
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
    const signal = run.judgments;
    const corpus: Corpus = {
      sessions,
      exchanges: signal.length,
      projects: topProjects(signal),
      from: window[0].ts.slice(0, 10),
      to: window[window.length - 1].ts.slice(0, 10),
    };

    const tSynth = Date.now();
    const text = buildRenderedText('profile', signal, corpus, bin, sw);
    sw.stage('synthesis', Date.now() - tSynth, text ? 1 : 0);

    if (!text) {
      console.error(`\n  ${C.bad('Could not build your profile.')} ${C.dim('The assistant returned nothing — silence beats a guess.')}\n`);
      sw.record(); // the judge stage's rates survive the refusal (C8)
      process.exit(1);
    }

    const builtAt = new Date().toISOString();
    atomicWriteFileSync(cachedFile, `${text}\n`);
    writeRender('profile', { builtAt, sessions, exchanges: signal.length });
    // Freeze this build's corpus so a later `profile --read` renders the note over EXACTLY this
    // evidence (lazy, no re-read) — never a divergent window.
    writeBuildCorpus({ builtAt, corpus, signalHashes: signal.map((j) => j.hash) });
    sw.record();

    console.log(`\n  ${C.b("WHO YOU'RE WORKING WITH")}   ${C.dim(`(stratless · ${sessions} sessions · ${signal.length} exchanges)`)}\n`);
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
    lookFooter('profile');
  } finally {
    releaseLock();
  }
}

/**
 * `profile --read` — the human-facing prose, rendered LAZILY over the profile's FROZEN corpus.
 *
 * Fresh (a cached read stamped to the current profile build) → a pure look, free. Otherwise render
 * ONCE from the frozen corpus: reload the exact signal judgments from the cache BY HASH (never a
 * re-judge, never a fresh window), synthesize, stamp the render to the profile's build, cache, print.
 * This is the "stop doing what `update` does": it never reads or judges a new exchange, and can
 * never describe a different corpus than the loaded profile.
 */
async function profileRead(): Promise<void> {
  const renders = readRenders();
  const profileMeta = renders.profile;
  const build = readBuildCorpus();
  const reportFile = join(STRATLESS, 'report.txt');

  if (!profileMeta) {
    console.log(`\n  ${C.it('No profile to read yet.')}`);
    console.log(`  ${C.dim(`Build one first: \`${hint('stratless update')}\`, then \`${hint('stratless profile --read')}\`.`)}\n`);
    return;
  }
  if (!build) {
    // Transition: a profile built before this feature has no frozen corpus. One rebuild enables the
    // read — we never render over a fresh window, because that is exactly the divergence we removed.
    console.log(`\n  ${C.it('Your profile predates the readable copy.')}`);
    console.log(`  ${C.dim(`Rebuild once to enable it: \`${hint('stratless update --now')}\` (your next session refresh does too), then \`${hint('stratless profile --read')}\`.`)}\n`);
    return;
  }
  if (build.builtAt !== profileMeta.builtAt) {
    // The frozen corpus must belong to the LOADED profile. If they drifted — a best-effort
    // writeBuildCorpus that failed, a crash between the two writes, a downgrade — rendering build.json
    // would describe a DIFFERENT window than the loaded profile while stamping it as current: the
    // exact divergence this fold removes. Refuse, don't lie; a rebuild re-syncs both.
    console.log(`\n  ${C.it('Your readable copy is out of sync with the loaded profile.')}`);
    console.log(`  ${C.dim(`Rebuild to re-sync: \`${hint('stratless update --now')}\`, then \`${hint('stratless profile --read')}\`.`)}\n`);
    return;
  }

  // FRESH: report.txt stamped to the CURRENT profile build → pure look, no spend.
  const reportMeta = renders.report;
  if (reportMeta && reportMeta.builtAt === profileMeta.builtAt && existsSync(reportFile)) {
    printRead(readFileSync(reportFile, 'utf8').trimEnd(), profileMeta, true);
    return;
  }

  // STALE or absent report → render once over the frozen corpus. No new reading.
  // Reconstruct the frozen signal from the cache by hash, and require it to reload IN FULL: a partial
  // survivor set (a PIPELINE_V drain, a hand-edited cache) would be synthesized while the header and
  // stored counts still assert the full frozen corpus. Refuse, don't lie.
  const wanted = new Set(build.signalHashes);
  const signal = allJudgments().filter((j) => wanted.has(j.hash));
  if (signal.length < wanted.size) {
    console.log(`\n  ${C.it('The evidence behind your last build is no longer fully in the cache.')}`);
    console.log(`  ${C.dim(`Rebuild it: \`${hint('stratless update --now')}\`.`)}\n`);
    return;
  }

  const bin = findAssistant();
  if (!bin) {
    console.error(`\n  ${C.bad('stratless needs your assistant to write your read.')} ${C.dim('It borrows your `claude` — install Claude Code, then retry.')}\n`);
    process.exit(1);
  }

  if (!claimLockOrSay()) return; // C4: one spender at a time
  try {
    const sw = startRun();
    process.stderr.write(`\n  ${CE.dim('writing your read from the last build (one borrowed synthesis, no re-reading)…')}\n`);
    const tSynth = Date.now();
    const text = buildRenderedText('report', signal, build.corpus, bin, sw);
    sw.stage('synthesis', Date.now() - tSynth, text ? 1 : 0);
    if (!text) {
      console.error(`\n  ${C.bad('Could not write your read.')} ${C.dim('The assistant returned nothing — silence beats a guess.')}\n`);
      sw.record();
      process.exit(1);
    }
    atomicWriteFileSync(reportFile, `${text}\n`);
    // Stamp the read to the profile build it was rendered from — the single staleness key.
    writeRender('report', { builtAt: profileMeta.builtAt, sessions: build.corpus.sessions, exchanges: build.corpus.exchanges });
    sw.record();
    printRead(text, profileMeta, false);
  } finally {
    releaseLock();
  }
}

/** Print the human-facing read under its header + footer. `fresh` picks the honest one-line note. */
function printRead(text: string, meta: RenderMeta, fresh: boolean): void {
  console.log(
    `\n  ${C.b('YOUR PATTERN — what stratless sees')}   ${C.dim(`(stratless · built ${meta.builtAt.slice(0, 10)} · ${meta.sessions} sessions · ${meta.exchanges} exchanges)`)}\n`,
  );
  console.log(text.split('\n').map((l) => `  ${l}`).join('\n'));
  console.log(`\n  ${C.dim(fresh ? 'free — from your last build' : 'written from your last build · no new reading')}`);
  lookFooter('report');
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
const TERMINAL_PHASES = new Set(['done', 'failed', 'stopped']);

/** Render a finished worker's closing frame — first line in the outcome's color, the rest dim. */
function renderFinal(p: Progress): void {
  process.stderr.write(`\r${' '.repeat(60)}\r`);
  const lines = p.summary?.length ? p.summary : [p.phase];
  const style = p.ok ? C.ok : p.phase === 'stopped' ? C.it : C.bad;
  console.log(`\n  ${style(lines[0])}`);
  for (const l of lines.slice(1)) console.log(`  ${C.dim(l)}`);
  console.log('');
}

/**
 * THE TAIL — the terminal as a window onto the worker, never the engine. Polls progress.json and
 * renders the familiar lines; Ctrl-C closes the window and prints the kill ladder (the work
 * continues; `stop` is one line away). Returns the exit code the outcome deserves.
 */
async function tailWorker(spawnedAtMs: number, prevStamp: string): Promise<number> {
  const startMs = Date.now();
  process.once('SIGINT', () => {
    process.stderr.write(`\r${' '.repeat(60)}\r`);
    console.log(`\n  ${C.it('detached — the refresh continues in the background')}`);
    console.log(`  ${C.dim(`watch it:        ${hint('stratless status')}`)}`);
    console.log(`  ${C.dim(`stop everything: ${hint('stratless stop')}`)}\n`);
    process.exit(0);
  });
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  let sawAlive = false;
  let deadSince = 0;
  for (;;) {
    const holder = readLock();
    const alive = !!(holder && !lockIsStale(holder));
    if (alive) {
      sawAlive = true;
      deadSince = 0;
    }
    const p = readProgress();
    if (alive && p && p.pid === holder!.pid && !TERMINAL_PHASES.has(p.phase)) {
      const line = p.phase === 'judging' && p.total ? `judging ${p.done ?? 0}/${p.total} new…` : `${p.phase}…`;
      process.stderr.write(`\r  ${CE.dim(line)}${' '.repeat(Math.max(0, 40 - line.length))}`);
    }
    if (!alive) {
      // Trust a terminal frame only when it is strictly NEWER than the narration that existed
      // before this run began — a leftover 'done' from a previous run is history, not our outcome.
      const trusted = p && TERMINAL_PHASES.has(p.phase) && p.updatedAt > prevStamp && (sawAlive || spawnedAtMs > 0);
      if (trusted) {
        renderFinal(p!);
        // 'stopped' is the person getting exactly what they asked for — never an error exit
        return p!.ok || p!.phase === 'stopped' ? 0 : 1;
      }
      const startupGrace = !sawAlive && spawnedAtMs > 0 && Date.now() - startMs < 5000;
      if (!startupGrace) {
        deadSince ||= Date.now();
        if (Date.now() - deadSince > 1500) {
          process.stderr.write(`\r${' '.repeat(60)}\r`);
          console.error(`\n  ${C.bad('the background refresh ended without reporting.')} ${C.dim(`check \`${hint('stratless status')}\``)}\n`);
          return 1;
        }
      }
    }
    if (Date.now() - startMs > 3_600_000) {
      // The one-hour valve: something is unusually slow — leave the worker to it, honestly.
      process.stderr.write(`\r${' '.repeat(60)}\r`);
      console.log(`\n  ${C.it('still running — detaching the display')} ${C.dim(`· watch: ${hint('stratless status')} · stop: ${hint('stratless stop')}`)}\n`);
      return 0;
    }
    await sleep(200);
  }
}

/**
 * UPDATE — the doorbell (Phase 2). The work lives in THE WORKER (loop.ts), one detached process
 * that survives this terminal; `update` wakes it and — in a real terminal — watches it. The hook
 * and pipes get one line and their prompt back. Ctrl-C mid-watch detaches the display, never the
 * work; the kill ladder is printed at that exact moment of intent.
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

  const holder = readLock();
  const alive = !!(holder && !lockIsStale(holder));
  // A foreground command (profile/report --now in another terminal) holds the same lock but
  // narrates nothing — tailing it would render a LEFTOVER frame as this run's outcome. Respect it.
  if (alive && holder!.kind !== 'worker') {
    console.log(`\n  ${C.it('another stratless command is running')} ${C.dim(`(pid ${holder!.pid}) — nothing was spent; try again when it finishes.`)}\n`);
    return;
  }
  // The previous run's last narration frame: only frames NEWER than this belong to our run (a
  // stale 'done' from yesterday must never be rendered as today's outcome).
  const prevStamp = readProgress()?.updatedAt ?? '';
  let spawnedAtMs = 0;
  if (alive) {
    const watching = process.stderr.isTTY ? ' — watching it' : '';
    console.log(`\n  ${C.dim(`a refresh is already running (pid ${holder!.pid})${watching}`)}`);
    if (force) {
      console.log(`  ${C.dim(`note: it may not be a forced rebuild; if you still want one, run \`${hint('stratless update --now')}\` after it finishes`)}`);
    }
  } else {
    // The bill is announced BEFORE the worker spends a token — same disclosure, new mouth.
    preSpend(pendingCount([...window].reverse(), judgeLimit()));
    const env: Record<string, string> = {};
    const abs = resolveBinPath(bin) ?? (bin.includes('/') ? bin : undefined);
    if (abs) env.STRATLESS_CLAUDE_BIN = abs; // C5: the claude path, captured while the PATH is real
    spawnedAtMs = Date.now();
    const entry = fileURLToPath(import.meta.url);
    const pid = spawnDetached(process.execPath, [entry, '__worker', ...(force ? ['--now'] : [])], env);
    if (!pid) {
      console.error(`\n  ${C.bad('could not start the background refresh.')}\n`);
      process.exit(1);
    }
  }

  if (!process.stderr.isTTY) {
    // the hook's path: ring, say where to look, give the prompt back
    console.log(`  refresh running in the background · watch: ${hint('stratless status')}`);
    return;
  }
  const code = await tailWorker(spawnedAtMs, prevStamp);
  if (code) process.exit(code);
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
async function stop(): Promise<void> {
  // C7 first: a RUNNING worker dies before anything else — the off switch means the spending
  // halts now, not after the current build finishes.
  const worker = await stopWorker();
  const hookRemoved = stopRefresh();
  const unloaded = removeProfile();
  if (!worker.killed && !hookRemoved && !unloaded) {
    console.log(`\n  ${C.dim('nothing to stop — no running refresh, no refresh hook, no loaded profile.')}\n`);
    return;
  }
  console.log(`\n  ${C.ok('stratless is off.')}`);
  if (worker.killed) {
    console.log(`  ${C.dim(`· background refresh stopped (pid ${worker.pid})`)}`);
    console.log(`  ${C.dim('  everything already judged is banked — restarting re-reads at most one chunk')}`);
  }
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
    const installed = installedVersion();
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
  // Phase 2: a live worker is visible here — the tail's Ctrl-C message points people HERE.
  {
    const holder = readLock();
    const wp = readProgress();
    if (holder && !lockIsStale(holder)) {
      const ph = wp && wp.pid === holder.pid
        ? (wp.phase === 'judging' && wp.total ? `judging ${wp.done ?? 0}/${wp.total}` : wp.phase)
        : 'working';
      console.log(`    running now             ${C.ok('yes')}  ${C.dim(`${ph} · pid ${holder.pid} · stop: ${hint('stratless stop')}`)}`);
    } else {
      if (wp && wp.phase === 'stopped') {
        console.log(`    last run                ${C.it('stopped by you')}`);
      } else if (wp && wp.phase === 'failed') {
        console.log(`    last run                ${C.warn('failed')}  ${C.dim(wp.summary?.[0] ?? '')}`);
      }
      // The receipt of the most recent run (0.3.5) — the hook's silent spends stay readable.
      if (wp?.spend) console.log(`    last run spend          ${C.dim(wp.spend.replace('this run: ', ''))}`);
    }
  }
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


// ── STRICT ARGS (0.3.5, from the dogfood backlog): an unknown flag is a silent lie about what
// the user asked for — `update --npw` once ran as a PLAIN update while its author believed he had
// forced a rebuild. Unknown flags and stray arguments exit loudly, with a did-you-mean.
const COMMAND_ARGS: Record<string, { flags: string[]; positionals: number }> = {
  init: { flags: ['--auto'], positionals: 0 },
  profile: { flags: ['--read'], positionals: 0 },
  update: { flags: ['--now'], positionals: 0 },
  patterns: { flags: ['--all'], positionals: 0 },
  receipt: { flags: ['--all'], positionals: 1 },
  status: { flags: ['--check'], positionals: 0 },
  stats: { flags: [], positionals: 0 },
  stop: { flags: [], positionals: 0 },
  __worker: { flags: ['--now'], positionals: 0 },
};

/** Tiny edit distance — enough for a did-you-mean on short flags, no dependency. */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** The validation error for a command's args, or undefined when they parse clean. */
function argProblem(cmd: string, rest: string[]): string | undefined {
  const spec = COMMAND_ARGS[cmd];
  if (!spec) return undefined;
  let positionals = 0;
  for (const a of rest) {
    if (a.startsWith('-')) {
      if (!spec.flags.includes(a)) {
        const guess = spec.flags.find((f) => editDistance(a, f) <= 2);
        return `unknown flag for ${cmd}: ${a}${guess ? `  (did you mean ${guess}?)` : ''}`;
      }
    } else if (++positionals > spec.positionals) {
      return `unexpected argument for ${cmd}: ${a}`;
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const cwd = process.cwd();

  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    console.log(`stratless ${installedVersion()}`);
    return;
  }

  // `profile --now` retired: profile only looks now. Nudge to the command that rebuilds AND loads
  // (before strict-args rejects the unknown flag with a less helpful message).
  if (cmd === 'profile' && args.includes('--now')) {
    console.log(`\n  ${C.it('profile only looks; it does not rebuild.')}`);
    console.log(`  ${C.dim(`to rebuild your profile and load it: ${C.b(hint('stratless update --now'))}`)}\n`);
    return;
  }

  // Strict args before anything runs: a typo must never silently become a different request.
  if (cmd && COMMAND_ARGS[cmd]) {
    const problem = argProblem(cmd, args.slice(1));
    if (problem) {
      console.error(`\n  ${C.bad(problem)}`);
      console.error(`  ${C.dim(`see \`${hint('stratless help')}\` for what ${cmd} takes`)}\n`);
      process.exit(1);
    }
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

  // `report` folded into `profile --read` (the human-facing prose is now a subfunction, lazy). Keep
  // the muscle memory kind: redirect instead of an unknown-command error.
  if (cmd === 'report') {
    console.log(`\n  ${C.it('report folded into profile.')}`);
    console.log(`  ${C.dim(`read your pattern as prose: ${C.b(hint('stratless profile --read'))}`)}\n`);
    return;
  }

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(`
  ${C.b('stratless')} — build your AI a model of who you are

    ${C.dim('get started:')}  ${C.b('npx stratless init')}

    ${C.b('stratless init')}       ${C.dim('keep your history safe (add --auto for background refresh)')}
    ${C.b('stratless profile')}    ${C.dim('see the model of you — free, instant (--read: as prose)')}
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
    if (cmd === '__worker') {
      // hidden: the doorbells spawn this — the worker process's whole life is runWorker()
      process.exitCode = await runWorker({ force: args.includes('--now') });
      return;
    }
    if (cmd === 'stats') return stats(cwd);
    if (cmd === 'status') return await status(args.slice(1));
    if (cmd === 'profile') return await profiler(args.slice(1));
    if (cmd === 'update') return await update(args.slice(1));
    if (cmd === 'patterns') return patternsCmd(args.slice(1));
    if (cmd === 'receipt') return receiptCmd(args.slice(1));
    if (cmd === 'stop') return await stop();
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

  // A mistyped COMMAND gets the same courtesy as a mistyped flag (0.3.5): name the nearest one,
  // never just reject. The user-facing verbs, in help order.
  const KNOWN = ['init', 'profile', 'update', 'patterns', 'receipt', 'stop', 'status', 'stats', 'help'];
  const guess = cmd ? KNOWN.map((k) => [k, editDistance(cmd, k)] as const).filter(([, d]) => d <= 3).sort((a, b) => a[1] - b[1])[0]?.[0] : undefined;
  console.error(`\n  ${C.bad(`unknown command: ${cmd}`)}${guess ? C.dim(`  (did you mean ${guess}?)`) : ''}`);
  console.error(`  ${C.dim(`see \`${hint('stratless help')}\` for the full list`)}\n`);
  process.exit(1);
}

void main();
