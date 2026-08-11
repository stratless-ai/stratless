import { unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import type { Adapter, ArmState } from '../../integrations/contracts.js';
import { brains, pickBrain } from '../../integrations/brains/registry.js';
import { detect as detectAdapters } from '../../integrations/assistants/registry.js';
import { loadRecentExchanges } from '../../pipeline/exchange.js';
import { assignmentsPath } from '../../pipeline/assign.js';
import { categoriesPath, loadCategories } from '../../pipeline/categories.js';
import { enginePath } from '../../pipeline/engine.js';
import { estimateBuild, estimateLine } from '../../pipeline/estimate.js';
import { liftPath } from '../../pipeline/lift.js';
import { loadMoments } from '../../pipeline/moments.js';
import { voicedPath } from '../../pipeline/voiced.js';
import { JUDGE_WINDOW } from '../../runner/loop.js';
import { coldBuildRequested, readState, recordGrowthConsent, requestColdBuild, setFlushCadence, type FlushCadence } from '../../runner/state.js';
import { readLock, lockIsStale, spawnDetached, resolveBinPath } from '../../runner/worker.js';
import { readProgress, type Progress } from '../../runner/progress.js';
import { isYes } from '../args.js';
import { C, CE, hint, SPINNER_FRAMES } from '../ui.js';

/**
 * UPDATE — the after-session refresh: read what's new, and rebuild the evidence when it's DUE.
 *
 * This is what the silent Stop hook runs, so it must be cheap by default. Collecting new moments is
 * free and happens every run; the flush (tag + count + rebuild) waits out the cadence cooldown
 * (flushDue), and a hand-typed `update` beats the cooldown. The evidence is internal — the sitting
 * reads it, nothing loads it — and each refresh also clears any older install's loaded pointer.
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
  // A braille spinner so a long borrowed call — which freezes the worker's narration for minutes while
  // it waits on `claude -p` — still reads as ALIVE, not hung. The tail is a separate process from the
  // worker, so its loop keeps ticking through the freeze; the cursor rotates even when the line can't.
  let frame = 0;
  for (;;) {
    const holder = readLock();
    const alive = !!(holder && !lockIsStale(holder));
    if (alive) {
      sawAlive = true;
      deadSince = 0;
    }
    const p = readProgress();
    if (alive && p && p.pid === holder!.pid && !TERMINAL_PHASES.has(p.phase)) {
      // Prefer the worker's latest live line — the engine narrates ("fingerprinting 1280/5697",
      // "naming 30 patterns") here; fall back to the phase when there is no line yet.
      const latest = p.summary?.length ? p.summary[p.summary.length - 1] : undefined;
      const line = latest ?? p.phase;
      // The rotating cursor carries the "in progress" signal now, so the trailing "…" is gone. TTY only —
      // a pipe (the hook worker, CI) gets the plain line, never a stream of cursor frames.
      const spin = process.stderr.isTTY ? `${CE.ok(SPINNER_FRAMES[frame])} ` : '';
      frame = (frame + 1) % SPINNER_FRAMES.length;
      // clear the row fully first — a shorter line must not leave stale characters behind
      process.stderr.write(`\r${' '.repeat(72)}\r  ${spin}${CE.dim(line)}`);
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
    await sleep(100); // ~10 fps — smooth cursor rotation, and a snappier read of the worker's state
  }
}

/**
 * One yes/no at the door — the only prompt in the product's life. Default is NO: a bare Enter, a pipe,
 * or anything that is not an explicit yes leaves the paid build unspent. The caller only reaches this
 * on a real TTY, so the readline is safe.
 */
export async function confirmBuild(promptText: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return isYes(await rl.question(promptText));
  } finally {
    rl.close();
  }
}

/**
 * WHAT TO SAY ABOUT THE AFTER-SESSION REFRESH.
 *
 * Three outcomes, because "we wrote the hook" and "the hook will run" are different claims. Codex
 * treats a newly written hook as untrusted and SILENTLY skips it until the person approves it in its
 * own review screen — so printing `refresh on` there would be the one lie this product cannot
 * afford: telling somebody their profile keeps itself current when nothing is going to run.
 */
export function armedLine(adapter: Adapter, state: ArmState): string {
  if (state === 'armed') return `${C.b('refresh on')}  ${C.dim(`· off any time: ${hint('stratless stop')}`)}`;
  if (state === 'awaiting-approval') {
    return `${C.warn('needs your approval')}  ${C.dim(`· ${adapter.displayName} will ask next time you open it`)}`;
  }
  return C.dim('not armed');
}

/**
 * Spawn the one detached worker. `flush` sets the consent signal for THIS worker's env (the fast
 * path); durable consent lives in state (requestColdBuild) so a lock race can never drop it.
 *
 * TWO THINGS ABOUT THE BRAIN CROSS THIS BOUNDARY, and one of them is newer than it looks. The path
 * has always been pinned here because the worker inherits a hook's thin PATH and would otherwise
 * fail to find a binary that is plainly installed. But a path cannot carry a PROTOCOL: with more
 * than one brain compiled in, a worker handed one vendor's binary and driving it with another's
 * flags gets silence rather than an error. So the CHOICE goes too.
 */
function spawnWorker(flush: boolean): number | undefined {
  // PIN PATHS, NOT THE CHOICE. The worker picks a brain PER RECORD now (`brainFor` — Codex profile,
  // Codex brain), so forcing one id here would override the rule for every pair in the run. What
  // the worker genuinely cannot re-derive is WHERE the binaries are — its inherited PATH is the
  // hook's thin one — so both are captured here, while the PATH is real. An explicit
  // STRATLESS_BRAIN in the person's own shell still inherits through as the override it reads as.
  const env: Record<string, string> = {};
  const claudeBin = resolveBinPath('claude');
  if (claudeBin) env.STRATLESS_CLAUDE_BIN = claudeBin;
  const codexBin = resolveBinPath('codex');
  if (codexBin) env.STRATLESS_CODEX_BIN = codexBin;
  if (flush) env.STRATLESS_FLUSH = '1';
  return spawnDetached(process.execPath, [fileURLToPath(new URL('../../index.js', import.meta.url)), '__worker'], env);
}

/**
 * THE COLD-REBUILD CLEAR — one pair's derived state, and nothing else. The archive and the moment
 * pile stay (they are the input a rebuild reads), and `fit.jsonl` stays: the wobble ledger's
 * history is the mature trigger's future margin, and a rebuild legitimately re-freezes its
 * baseline without erasing what was measured before it. An absent file is already cleared.
 */
export function clearDerivedFor(record: string): void {
  for (const p of [categoriesPath(record), assignmentsPath(record), voicedPath(record), liftPath(record), enginePath(record)]) {
    try {
      unlinkSync(p);
    } catch {
      /* absent is cleared */
    }
  }
}

/** Is a real worker (not a foreground command) holding the lock right now? */
function workerAlive(): boolean {
  const h = readLock();
  return !!(h && !lockIsStale(h) && h.kind === 'worker');
}

/**
 * UPDATE — the doorbell (Phase 2). The work lives in THE WORKER (loop.ts), one detached process
 * that survives this terminal; `update` wakes it and — in a real terminal — watches it. The hook
 * and pipes get one line and their prompt back. Ctrl-C mid-watch detaches the display, never the
 * work; the kill ladder is printed at that exact moment of intent.
 *
 * `consented` forces the flush (the cold-start build) regardless of the stderr-TTY heuristic: the
 * door already took an explicit yes, and a redirected stderr must not swallow that consent.
 */
export async function update(_rest: string[], opts: { consented?: boolean } = {}): Promise<void> {
  // `update --daily|--weekly` records how often the worker may auto-rebuild on its own (this run
  // rebuilds now regardless). Absent leaves the current setting; default is weekly.
  const cadence: FlushCadence | undefined = _rest.includes('--weekly') ? 'weekly' : _rest.includes('--daily') ? 'daily' : undefined;
  if (cadence) {
    setFlushCadence(cadence);
    console.log(`\n  ${C.dim(`auto-rebuild set to ${C.b(cadence)} — \`${hint('stratless update')}\` still rebuilds now, anytime`)}`);
  }

  // Any brain will do, and the message must say so: naming only Claude Code told a Codex user to
  // `--rebuild` off a terminal refuses BEFORE any other gate: the refusal is a guard with no
  // dependencies, and a machine with no brain installed must still hear it rather than the
  // brain error — a stranger's clean clone (CI) is exactly that machine.
  if (_rest.includes('--rebuild') && (!process.stdin.isTTY || !process.stderr.isTTY)) {
    console.log(`\n  ${C.dim('run --rebuild in a terminal — it clears your built map on a typed yes, never an implied one.')}\n`);
    return;
  }

  // install a second assistant in order to be understood by the one they already run.
  const brain = pickBrain();
  if (!brain) {
    const known = brains.map((b) => b.displayName).join(' or ');
    console.error(`\n  ${C.bad('stratless needs an assistant of your own to put your history into words.')}`);
    console.error(`  ${C.dim(`It borrows one you already have — install ${known}, then try again.`)}\n`);
    process.exit(1);
  }

  const window = loadRecentExchanges(JUDGE_WINDOW);
  if (!window.length) {
    const here = detectAdapters();
    const who = here.length ? here.map((a) => a.displayName).join(' or ') : 'your AI coding assistant';
    console.log(`\n  No conversations found yet.\n  ${C.dim(`Talk to ${who} a few times, run \`${hint('stratless init')}\`, then try this.`)}\n`);
    return;
  }

  // `update --rebuild` — the full cold rebuild, first-class. It quotes each built pair's own
  // estimate and takes a typed yes BEFORE anything is cleared: a declined quote changes nothing.
  // On yes it removes the derived state, which manufactures exactly the condition the existing
  // cold-build path was built for — one build path, no second one to maintain.
  if (_rest.includes('--rebuild')) {
    // Never clear under a live process: a worker mid-flush holds this map in memory and would
    // write half of the old world back over the cleared shelf.
    const running = readLock();
    if (running && !lockIsStale(running)) {
      console.log(`\n  ${C.it('a stratless process is running')} ${C.dim(`(pid ${running.pid}) — nothing cleared; let it finish or \`${hint('stratless stop')}\` it, then rebuild.`)}\n`);
      return;
    }
    const pile = loadMoments();
    const targets = detectAdapters()
      .map((a) => ({ a, own: pile.filter((m) => m.record === a.record.id).length }))
      .filter((t) => t.own > 0 && loadCategories(t.a.record.id).length > 0);
    if (!targets.length) {
      console.log(`\n  ${C.dim(`no built map to rebuild — a plain \`${hint('stratless update')}\` builds fresh on its own.`)}\n`);
      return;
    }
    console.log(`\n  ${C.b('Full rebuild')} — re-cluster, re-name, and re-voice each pair from its whole archive.`);
    for (const t of targets) console.log(`    ${t.a.displayName}: ${C.b(estimateLine(estimateBuild(t.own)))}`);
    console.log(`  ${C.dim('your archive, your moments, and the fit ledger stay · the evidence rewrites from scratch')}`);
    let raze: boolean;
    try {
      raze = await confirmBuild(`\n  Rebuild now? ${C.dim('[y/N]')} `);
    } catch {
      raze = false;
    }
    if (!raze) {
      console.log(`\n  ${C.dim('nothing cleared, nothing spent.')}\n`);
      return;
    }
    for (const t of targets) clearDerivedFor(t.a.record.id);
    console.log(`  ${C.dim('derived state cleared — building cold…')}`);
  }

  // A hand-run update (a real terminal) forces a flush; the background hook (no TTY) respects the
  // gates. `consented` (the door's explicit yes) forces it too — stderr redirection must not swallow it.
  const flushing = opts.consented || process.stderr.isTTY;
  // Record a consented COLD-START build DURABLY, before any lock decision. Consent must survive a lock
  // race (a background hook worker holding the lock) or a killed process — it must never live only in
  // the spawned worker's env. A hook never sets this, so it can never manufacture consent.
  // Consent is recorded when ANY detected assistant still awaits its first build — a machine that
  // built for one tool and then gained a second is exactly the person this must not skip.
  const consentedColdBuild = flushing && detectAdapters().some((a) => loadCategories(a.record.id).length === 0);
  if (consentedColdBuild) requestColdBuild();
  // A flushing run also stamps the STANDING growth consent: its surfaces (the door's quote, this
  // typed `update`) are the ones whose copy says young maps get rebuilt as history grows. After
  // this one stamp, the background worker may take a young rebuild on its own — announced, cents.
  if (flushing) recordGrowthConsent();

  const holder = readLock();
  const alive = !!(holder && !lockIsStale(holder));
  // A foreground command (another stratless command in another terminal) holds the same lock but
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
  } else {
    spawnedAtMs = Date.now();
    if (!spawnWorker(flushing)) {
      console.error(`\n  ${C.bad('could not start the background refresh.')}\n`);
      process.exit(1);
    }
  }

  if (!process.stderr.isTTY) {
    // the hook's path: ring, say where to look, give the prompt back
    console.log(`  refresh running in the background · watch: ${hint('stratless status')}`);
    return;
  }
  let code = await tailWorker(spawnedAtMs, prevStamp);
  // We may have only tailed a FOREIGN collect-only worker (it held the lock when we arrived). If a
  // consented build is still pending, the lock is free now — run it, and watch it. One re-attempt, so
  // this can never loop.
  if (!code && consentedColdBuild && coldBuildRequested() && !workerAlive()) {
    const at = Date.now();
    const stamp = readProgress()?.updatedAt ?? '';
    if (spawnWorker(true)) code = await tailWorker(at, stamp);
  }
  if (code) process.exit(code);
}
