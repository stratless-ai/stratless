#!/usr/bin/env node
/**
 * stratless — build your AI a model of who you are, so it stops making you feel stupid.
 *
 *   stratless mirror    a free read of you and your AI, from live logs — changes nothing, no setup
 *   stratless init      keep your history, see a free read, build your profile
 *   stratless profile   see the model of you — LOOKS, never spends; update LOADS
 *   stratless update    read what's new; rebuild + load the profile
 *   stratless stop      turn it off — stop refreshing and unload the profile
 *   stratless status    stratless's own state: on or off, and what it has cost
 *
 * Runs on your machine. Reads your own history. Nothing leaves.
 */
import { loadAssignments } from './assign.js';
import { join as joinLabelled, misfitRate } from './count.js';
import { findAssistant, onPath } from './claude.js';
import { init as doInit, ARCHIVE, PROJECTS, stopRefresh, refreshArmed, type InitResult } from './init.js';
import { runtimeDir, runtimeInstalled, ensureRuntime, runtimePresent, modelPresent, modelDir } from './embed.js';
import { fetchLatest, newerThan } from './notify.js';
import { loadRecentExchanges } from './exchange.js';
import { removeProfile, humanMdPath, claudeMdPath } from './load.js';
import { readRenders, requestColdBuild, coldBuildRequested, readState, setFlushCadence, type FlushCadence } from './state.js';
import { readUsage } from './usage.js';
import { CorruptStoreError } from './atomic.js';
import { readLock, lockIsStale, stopWorker, spawnDetached, resolveBinPath } from './worker.js';
import { runWorker, installedVersion, JUDGE_WINDOW } from './loop.js';
import { readProgress, type Progress } from './progress.js';
import { makePalette } from './palette.js';
import { mirrorOfArchive, mirrorOfArchiveAsync } from './mirror.js';
import { renderMirror, renderCard } from './mirrorview.js';
import { estimateBuild, estimateFromMessages, estimateLine } from './estimate.js';
import { loadMoments } from './moments.js';
import { loadCategories } from './categories.js';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

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

/** The one braille cursor, shared by the tail and the discrete-wait spinner so the CLI moves alike. */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * A zero-dependency spinner for a discrete wait. Runs on its own 100ms interval, so the work it wraps
 * must yield to the event loop for the cursor to move (that is what `mirrorOfArchiveAsync` is for). TTY
 * only — a pipe (a hook, CI) gets one static line, never a stream of cursor frames. Returns a stop().
 */
function startSpinner(label: string, stream: NodeJS.WriteStream = process.stderr): () => void {
  const pal = stream === process.stdout ? C : CE;
  if (!stream.isTTY) {
    stream.write(`  ${pal.dim(label)}\n`);
    return () => {};
  }
  let i = 0;
  stream.write('\x1B[?25l'); // hide the real cursor while ours spins in its place
  const draw = (): void => {
    i = (i + 1) % SPINNER_FRAMES.length;
    stream.write(`\r  ${pal.ok(SPINNER_FRAMES[i])} ${pal.dim(label)}`);
  };
  draw();
  const id = setInterval(draw, 100);
  return () => {
    clearInterval(id);
    stream.write(`\r${' '.repeat(label.length + 6)}\r\x1B[?25h`); // clear the row, restore the cursor
  };
}

/**
 * MIRROR — the zero-commitment free read. A stranger runs `stratless mirror` (or bare `stratless`) and
 * sees how they and their AI work, computed from their LIVE Claude Code logs at ~/.claude/projects —
 * with NO `init`, no archive, no settings touched, no spend. Pure arithmetic → stdout. This is the
 * run-it-now, change-nothing surface the launch forwards; `--share` renders the screenshot-safe card
 * (aggregate-only, no repo or session names). The mirror is the diagnosis; `init`/`update` is the cure,
 * pointed at in the footer — never auto-run, because the whole promise is that this changed nothing.
 *
 * This is the ONE read now: `stats` (0.4.4) folded in here, since it printed the same rows off a
 * frozen archive snapshot while this reads live. Once a build exists it adds the `profile captures X%`
 * coverage line (what `stats` uniquely had) and the footer shifts from "build it" to "refresh it".
 */
async function mirror(args: string[]): Promise<void> {
  const share = args.includes('--share');
  const empty = (): void =>
    console.log(
      `\n  ${C.dim('No conversations to read yet. Talk to Claude Code a few times, then run')} ${C.b(hint('stratless mirror'))} ${C.dim('again.')}\n`,
    );

  // The LIVE logs, not the archive — this must work with nothing archived and no init ever run.
  if (!existsSync(PROJECTS)) return empty();

  // The nested-tree walk is the ~10s wait; the async twin lets the spinner rotate through it.
  const stopReading = startSpinner('reading your history…', process.stdout);
  let m: ReturnType<typeof mirrorOfArchive> | undefined;
  try {
    m = await mirrorOfArchiveAsync(PROJECTS);
  } catch {
    m = undefined;
  } finally {
    stopReading();
  }
  const rows = m ? (share ? renderCard(m) : renderMirror(m, { full: true })) : [];
  if (!rows.length) return empty();

  // Completeness: the share of your moments the built profile's categories cover (1 - the misfit
  // rate), shown in the positive frame. This is the one thing the retired `stats` had that the door
  // did not; it only means something once a build exists, so it is skipped before the first build and
  // never printed on the shareable card (a stranger has no profile, and it would leak nothing useful).
  let completeness: string | undefined;
  if (!share) {
    try {
      const labelled = joinLabelled(loadMoments(), loadAssignments());
      if (labelled.length) completeness = `${Math.round(100 * (1 - misfitRate(labelled)))}% of your moments`;
    } catch {
      /* no build yet — no completeness line */
    }
  }

  console.log(`\n  ${C.b(share ? 'You and your AI' : 'You and your AI, measured')}\n`);
  const w = Math.max(...rows.map((r) => r.label.length), completeness ? 'profile captures'.length : 0);
  for (const row of rows) console.log(`    ${C.dim(row.label.padEnd(w))}   ${C.b(row.value)}`);
  if (completeness) console.log(`    ${C.dim('profile captures'.padEnd(w))}   ${C.b(completeness)}`);

  if (share) {
    // A screenshot carries no funnel — just the neutral repro line, so a viewer can get their own.
    console.log(`\n  ${C.dim('npx stratless mirror · runs on your machine, nothing leaves')}\n`);
  } else if (completeness) {
    // A profile is already built — no build funnel; point at refresh and the rest of the surface.
    console.log(`\n  ${C.dim('Nothing was changed on your machine.')} ${C.dim('Refresh anytime:')} ${C.b(hint('stratless update'))}`);
    console.log(`  ${C.dim('all commands:')} ${C.b(hint('stratless help'))}\n`);
  } else {
    // No profile yet — the funnel to the full build.
    console.log(`\n  ${C.dim('Nothing was changed on your machine.')} ${C.dim('Keep it fresh + build the full profile:')} ${C.b(hint('stratless init'))}`);
    console.log(`  ${C.dim('all commands:')} ${C.b(hint('stratless help'))}\n`);
  }
}

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

/** The `# built` stamp inside the LOADED HUMAN.md — WHICH build the assistant is actually reading,
 *  not just whether one is. undefined when the file is absent or predates the stamp (pre-0.4.0). */
function loadedBuiltStamp(): string | undefined {
  try {
    return readFileSync(humanMdPath(), 'utf8').slice(0, 400).match(/^# built (.+)$/m)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

/** The one honest footer a look shares. */
function lookFooter(): void {
  console.log(
    profileLoaded()
      ? `  ${C.dim(`loaded: ${humanMdPath()} · refresh it with \`${hint('stratless update')}\``)}`
      : `  ${C.it('not loaded yet')} ${C.dim('· load it into your assistant:')} ${C.b(hint('stratless update'))}`,
  );
  console.log('');
}

/**
 * The profiler — LOOKING IS FREE (Sun's design decision, and it is now literal).
 *
 * `profile` prints the LAST BUILT rendering instantly, at zero spend, under a header carrying that
 * build's own date and numbers (from the sidecar — never recomputed at print). `profile` looks,
 * `update` builds and loads.
 *
 * Before the discovery pipeline it kept a build path for the first-ever look, which meant a command
 * whose whole promise is "free" could quietly start spending. With the build moving to `update` that
 * path is gone: nothing built yet now says so and points at the command that does spend.
 */
/** A build's ISO timestamp as a readable, globalized version stamp: `2026-07-23 12:28 UTC`. UTC so it
 *  reads the same anywhere; minute precision because a person checks "am I on the latest?", not ms. */
function builtStamp(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

async function profiler(_rest: string[] = []): Promise<void> {
  // The profile BODY is HUMAN.md (the discovery pipeline's output) — NOT the old ~/.stratless/profile.txt,
  // which nothing writes any more. Gate on the body existing; the render sidecar only carries the header
  // facts, and a profile with no sidecar is still a profile worth showing.
  const human = humanMdPath();
  if (!existsSync(human)) {
    console.log(`\n  ${C.it('Nothing built yet.')} ${C.dim('`profile` only ever looks — it never spends.')}`);
    console.log(`  ${C.dim('Build and load it with:')} ${C.b(hint('stratless update'))}\n`);
    return;
  }

  // Strip HUMAN.md's managed-by header (the `#` lines + the `<!-- humanmd/v1 -->` marker) — plumbing a
  // person reading their own profile does not need to see.
  const raw = readFileSync(human, 'utf8').split('\n');
  const start = raw.findIndex((l) => l.trim() !== '' && !/^\s*#/.test(l) && !/^\s*<!--/.test(l));
  const body = raw.slice(start === -1 ? 0 : start).join('\n').trimEnd();

  const meta = readRenders().profile;
  const header = meta
    ? `(stratless · built ${builtStamp(meta.builtAt)} · ${meta.sessions} sessions · ${meta.exchanges.toLocaleString()} moments)`
    : '(stratless · your profile)';
  console.log(`\n  ${C.b("WHO YOU'RE WORKING WITH")}   ${C.dim(header)}\n`);
  console.log(body.split('\n').map((l) => `  ${l}`).join('\n'));
  console.log(`\n  ${C.dim('free — this is the last build')}`);
  lookFooter();
}

/**
 * UPDATE — the after-session refresh: read what's new, and rebuild + LOAD the profile when it's DUE.
 *
 * This is what the silent Stop hook runs, so it must be cheap by default. Collecting new moments is
 * free and happens every run; the flush (tag + count + rebuild) waits out the cadence cooldown
 * (flushDue), and a hand-typed `update` beats the cooldown. A gated skip still guarantees an
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
async function confirmBuild(promptText: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return isYes(await rl.question(promptText));
  } finally {
    rl.close();
  }
}

/** The consent parse, kept pure so the "default is NO" property is directly testable: only an explicit
 *  y/yes builds; a bare Enter, EOF, a pipe, "yeah", or any garbage defers. */
export function isYes(answer: string): boolean {
  const a = answer.trim().toLowerCase();
  return a === 'y' || a === 'yes';
}

/** Spawn the one detached worker. `flush` sets the consent signal for THIS worker's env (the fast
 *  path); durable consent lives in state (requestColdBuild) so a lock race can never drop it. */
function spawnWorker(bin: string, flush: boolean): number | undefined {
  const env: Record<string, string> = {};
  const abs = resolveBinPath(bin) ?? (bin.includes('/') ? bin : undefined);
  if (abs) env.STRATLESS_CLAUDE_BIN = abs; // C5: the claude path, captured while the PATH is real
  if (flush) env.STRATLESS_FLUSH = '1';
  return spawnDetached(process.execPath, [fileURLToPath(import.meta.url), '__worker'], env);
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
async function update(_rest: string[], opts: { consented?: boolean } = {}): Promise<void> {
  // `update --daily|--weekly` records how often the worker may auto-rebuild on its own (this run
  // rebuilds now regardless). Absent leaves the current setting; default is weekly.
  const cadence: FlushCadence | undefined = _rest.includes('--weekly') ? 'weekly' : _rest.includes('--daily') ? 'daily' : undefined;
  if (cadence) {
    setFlushCadence(cadence);
    console.log(`\n  ${C.dim(`auto-rebuild set to ${C.b(cadence)} — \`${hint('stratless update')}\` still rebuilds now, anytime`)}`);
  }

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

  // A hand-run update (a real terminal) forces a flush; the background hook (no TTY) respects the
  // gates. `consented` (the door's explicit yes) forces it too — stderr redirection must not swallow it.
  const flushing = opts.consented || process.stderr.isTTY;
  // Record a consented COLD-START build DURABLY, before any lock decision. Consent must survive a lock
  // race (a background hook worker holding the lock) or a killed process — it must never live only in
  // the spawned worker's env. A hook never sets this, so it can never manufacture consent.
  const consentedColdBuild = flushing && loadCategories().length === 0;
  if (consentedColdBuild) requestColdBuild();

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
    if (!spawnWorker(bin, flushing)) {
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
    if (spawnWorker(bin, true)) code = await tailWorker(at, stamp);
  }
  if (code) process.exit(code);
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
  if (existsSync(modelDir())) {
    console.log(`  ${C.dim(`The local model (~34MB) is still at ${modelDir()} — remove it if you want the disk back.`)}`);
  }
  if (runtimeInstalled()) {
    console.log(`  ${C.dim(`The local runtime (~11MB) is still at ${runtimeDir()} — remove it if you want the disk back.`)}`);
  }
  console.log(`  ${C.dim(`Run \`${hint('stratless update')}\` to load it again, \`${hint('stratless init')}\` to turn the refresh back on.`)}\n`);
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
    const stopCheck = startSpinner('checking npm for a newer version…');
    const latest = await fetchLatest();
    stopCheck();
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

  // 3. The recent-builds trajectory — newest first, from the sidecar's history. Each stamp is the
  //    SAME one HUMAN.md carries in its `# built` header, so status and the file can never disagree.
  //    Fall back to the single latest render (a sidecar written before history), then to the file's
  //    mtime, so an old install still shows something honest.
  const renders = readRenders();
  const builds = renders.history?.length ? renders.history : renders.profile ? [renders.profile] : [];
  let mtimeStamp = '';
  try {
    if (!builds.length && humanExists) mtimeStamp = statSync(human).mtime.toISOString().slice(0, 10);
  } catch {
    /* leave blank */
  }

  const u = readUsage();
  // Tokens are the honest unit — a subscription spends quota, not dollars — and the cache tokens
  // (the ~17–24k harness overhead every borrowed call carries) ARE the consumption, so they count.
  // The dollar figure is the API-equivalent, labelled as exactly that.
  const tokens = u.inputTokens + u.outputTokens + u.cacheCreationTokens + u.cacheReadTokens;
  const fmtTok = (t: number): string =>
    t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1000 ? `${Math.round(t / 1000)}k` : String(t);
  // Split lifetime spend into the LIVE engine stages and everything RETIRED. The dead keys roll into
  // ONE honest line instead of a column of dead labels; the total still counts them, so the sum never
  // lies — only the clutter is gone. A fresh user has no retired spend and never sees that line.
  //
  // `discover` and `assign` joined the retired set on 2026-07-26: v3 replaced them with `build` (the
  // cold run: shape, fingerprint, cluster, name) and `grow` (placing new moments — free). Anyone who
  // ran a previous version still has that spend on their meter, and it must keep a readable label
  // rather than disappearing or printing a raw key.
  const RETIRED = new Set(['judge', 'synthesis', 'miner', 'audit', 'grade', 'discover', 'assign', 'rules', 'knowledge']);
  const STAGE_LABEL: Record<string, string> = { build: 'building', grow: 'placing', name: 'naming', write: 'writing', lift: 'patch voicing' };
  let retiredUsd = 0;
  const stageParts: string[] = [];
  for (const [f, t] of Object.entries(u.byFeature)) {
    if (RETIRED.has(f)) retiredUsd += t.costUsd;
    else stageParts.push(`${STAGE_LABEL[f] ?? f} $${t.costUsd.toFixed(2)}`);
  }

  console.log(`\n  ${C.b('stratless status')}\n`);
  console.log(`    after-session refresh   ${refresh ? C.ok('on') : C.dim('off')}`);
  console.log(`    auto-rebuild            ${C.dim(`${readState().flushCadence ?? 'weekly'} · set with \`${hint('stratless update --daily|--weekly')}\``)}`);
  // The cold-start onramp: history collected but the paid build not yet run. Derived, never stored —
  // no categories on disk while the pile holds moments means "free read live, full build pending".
  try {
    const cats = loadCategories();
    const pile = loadMoments();
    if (!cats.length && pile.length) {
      const est = estimateLine(estimateBuild(pile.length));
      console.log(`    profile build           ${C.warn('not run yet')}  ${C.dim(`${est} — run ${hint('stratless update')}`)}`);
    }
  } catch {
    /* stores absent on a brand-new machine — nothing to report */
  }
  // Phase 2: a live worker is visible here — the tail's Ctrl-C message points people HERE.
  {
    const holder = readLock();
    const wp = readProgress();
    if (holder && !lockIsStale(holder)) {
      const ph = wp && wp.pid === holder.pid ? wp.phase : 'working';
      console.log(`    running now             ${C.ok('yes')}  ${C.dim(`${ph} · pid ${holder.pid} · stop: ${hint('stratless stop')}`)}`);
    } else {
      if (wp && wp.phase === 'stopped') {
        console.log(`    last run                ${C.it('stopped by you')}`);
      } else if (wp && wp.phase === 'failed') {
        console.log(`    last run                ${C.warn('failed')}  ${C.dim(wp.summary?.[0] ?? '')}`);
      }
    }
  }
  // WHICH build is loaded, not just whether. The file's own `# built` stamp is compared to the
  // latest build's — they diverge only when a rebuild never loaded, a `stop` unloaded, or the file
  // was replaced by hand: exactly the states a bare "yes" would hide. Same stamp formula on both
  // sides (load.ts writes it, builtStamp renders it), so agreement is exact, never fuzzy.
  const loadedStamp = loaded ? loadedBuiltStamp() : undefined;
  const latestStamp = builds.length ? builtStamp(builds[0].builtAt) : undefined;
  if (loaded && loadedStamp && latestStamp && loadedStamp !== latestStamp) {
    console.log(`    profile loaded          ${C.ok('yes')}  ${C.warn(`an OLDER build (${loadedStamp})`)} ${C.dim(`— latest is ${latestStamp} · load it: ${hint('stratless update')}`)}`);
  } else if (loaded && loadedStamp) {
    console.log(`    profile loaded          ${C.ok('yes')}  ${C.dim(`${latestStamp ? 'this build' : 'built'} (${loadedStamp}) · ${human}`)}`);
  } else {
    console.log(`    profile loaded          ${loaded ? C.ok('yes') : C.dim('no')}${humanExists ? `  ${C.dim(human)}` : ''}`);
  }

  // RECENT BUILDS — when it last updated, and how the pile is growing. The trust surface: a person
  // sees their profile is kept fresh, never silently frozen. Newest first, the latest one flagged.
  if (builds.length) {
    console.log(`\n    recent builds`);
    for (const [i, b] of builds.slice(0, 5).entries()) {
      const cats = b.categories != null ? ` · ${b.categories} categories` : '';
      const tag = i === 0 ? `   ${C.dim('(latest)')}` : '';
      console.log(`      ${builtStamp(b.builtAt)}   ${C.dim(`${b.sessions.toLocaleString()} conv · ${b.exchanges.toLocaleString()} moments${cats}`)}${tag}`);
    }
  } else {
    console.log(`    last built              ${C.dim(mtimeStamp || 'never')}`);
  }

  // SPEND — lifetime total, the live stages, the retired miner era rolled into one line, the most
  // recent run's receipt, and the meter's own blind spots (silent accounting would be the bug).
  const lastRunSpend = readProgress()?.spend;
  console.log(`\n    spend`);
  console.log(`      total          ${C.b(`$${u.costUsd.toFixed(2)}`)}  ·  ${fmtTok(tokens)} tokens  ·  ${u.calls.toLocaleString()} calls  ${C.dim('on your own claude')}`);
  if (stageParts.length) console.log(`      by stage       ${C.dim(stageParts.join(' · '))}`);
  if (retiredUsd > 0.005) console.log(`      retired        ${C.dim(`$${retiredUsd.toFixed(2)}  (earlier miner stages)`)}`);
  if (lastRunSpend) console.log(`      last run       ${C.dim(lastRunSpend.replace('this run: ', ''))}`);
  const gaps: string[] = [];
  if (u.unmeteredCalls) gaps.push(`${u.unmeteredCalls} unmetered (true cost unknown)`);
  if (u.pinEscapedCalls) gaps.push(`${u.pinEscapedCalls} pin-dropped`);
  if (gaps.length) console.log(`      flags          ${C.warn(gaps.join(' · '))}`);

  if (!refresh) console.log(`\n  ${C.dim(`Run \`${hint('stratless init')}\` to turn the after-session refresh back on.`)}`);
  console.log('');
}


// ── STRICT ARGS (0.3.5, from the dogfood backlog): an unknown flag is a silent lie about what
// the user asked for — `update --npw` once ran as a PLAIN update while its author believed he had
// forced a rebuild. Unknown flags and stray arguments exit loudly, with a did-you-mean.
const COMMAND_ARGS: Record<string, { flags: string[]; positionals: number }> = {
  init: { flags: [], positionals: 0 },
  profile: { flags: [], positionals: 0 },
  update: { flags: ['--daily', '--weekly'], positionals: 0 },
  status: { flags: ['--check'], positionals: 0 },
  mirror: { flags: ['--share'], positionals: 0 },
  stop: { flags: [], positionals: 0 },
  __worker: { flags: [], positionals: 0 },
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

  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    console.log(`stratless ${installedVersion()}`);
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
    // THE DOOR — the product's only interactive moment. Keep the history, show a FREE read of the
    // person (no spend), quote the paid build honestly, then take ONE consent: build now (watched) or
    // later. The paid build never fires without an explicit yes on a real terminal.
    let r: InitResult;
    try {
      r = doInit();
    } catch (err) {
      // Refuse, don't clobber — say what's wrong (a malformed settings.json) and stop cleanly.
      console.error(`\n  ${C.bad('stratless could not update your settings.')}`);
      console.error(`  ${C.dim(String(err instanceof Error ? err.message : err).split('\n').join('\n  '))}\n`);
      process.exit(1);
    }

    // 1. what we kept. Install = alive: the after-session refresh is on now; `stop` is the one ceremony.
    console.log(`\n  ${C.ok('stratless is keeping your history.')}\n`);
    console.log(`    reaper           ${C.dim(String(r.before))} → ${C.b(`${r.after} days`)}`);
    console.log(`    archived         ${C.b(String(r.copied))} transcripts${r.skipped ? C.dim(` (${r.skipped} already current)`) : ''}`);
    console.log(`    kept at          ${C.dim(ARCHIVE)}`);
    console.log(`    after-session    ${C.b('refresh on')}  ${C.dim(`· off any time: ${hint('stratless stop')}`)}`);
    console.log(`\n  ${C.dim('Claude Code deletes transcripts after 30 days — per file, even in a project you')}`);
    console.log(`  ${C.dim('use daily. Anything already gone is gone. Everything from here is kept.')}\n`);

    // The armed hook runs the bare `stratless`; from an npx-only install it would silently do nothing.
    if (!onPath('stratless')) {
      console.log(`  ${C.warn('heads up:')} ${C.dim('the after-session refresh runs `stratless`, but it is not on your PATH yet.')}`);
      console.log(`  ${C.dim('Install it so the refresh can run:')} ${C.b('npm install -g stratless')}\n`);
    }

    // 2. the free read — computed from the archive we just froze. No model call, no spend. The
    //    archive walk takes ~10s on a big history, so spin a cursor through it (the async twin yields).
    const stopReading = startSpinner('reading your history…', process.stdout);
    let mirror: ReturnType<typeof mirrorOfArchive> | undefined;
    try {
      mirror = await mirrorOfArchiveAsync(ARCHIVE);
    } catch {
      mirror = undefined;
    } finally {
      stopReading();
    }
    const rows = mirror ? renderMirror(mirror) : [];
    if (!rows.length) {
      console.log(`  ${C.dim('No conversations to read yet — talk to Claude Code a few times, then run')} ${C.b(hint('stratless update'))}${C.dim('.')}\n`);
      return;
    }
    console.log(`  ${C.b('What I can already see')} ${C.dim('(free, from your own history):')}\n`);
    const w = Math.max(...rows.map((row) => row.label.length));
    for (const row of rows) console.log(`    ${C.dim(row.label.padEnd(w))}   ${C.b(row.value)}`);

    // 3. the estimate — the cold quote from the shipped rate card (estimate.ts); the live ETA takes
    //    over once the real build runs. Use the real pile if it exists; before it does, scale the
    //    mirror's message count UP to estimated moments so the quote never lands under the real spend.
    let pile = 0;
    try {
      pile = loadMoments().length;
    } catch {
      /* fresh machine: no pile yet */
    }
    const est = pile > 0 ? estimateBuild(pile) : estimateFromMessages(mirror!.scale.messages);
    console.log(`\n  ${C.dim('Full profile:')}    ${C.b(estimateLine(est))}   ${C.dim('built on your own claude, nothing leaves.')}`);
    // THE DOWNLOAD IS PART OF THE ASK. Most of the build now runs on a small local model, which is
    // why it costs cents instead of dollars — but the engine (~3MB runtime) and its weights (~34MB)
    // have to arrive once, and neither is in the npm package. Consenting to a build must mean
    // consenting to that, said out loud and itemized, before the yes. Silently pulling ~40MB
    // because someone agreed to a price is the kind of surprise the whole door exists to prevent.
    if (!runtimePresent()) {
      const arriving = [
        !runtimeInstalled() ? 'local runtime (~3MB)' : '',
        !modelPresent() ? 'local model (~34MB)' : '',
      ].filter(Boolean).join(' + ');
      console.log(`  ${C.dim('One-time:')}         ${C.b(arriving)}   ${C.dim('downloaded once, then every build runs offline.')}`);
    }

    // 4. the one consent. Only a real terminal can say yes; a pipe or a missing assistant points to
    //    `update`, which is itself the consented build path.
    const bin = findAssistant();
    if (bin && process.stdin.isTTY && process.stdout.isTTY) {
      console.log('');
      let yes = false;
      try {
        yes = await confirmBuild(`  Build your profile now? ${C.dim('[y/N]')} `);
      } catch {
        yes = false; // an aborted prompt (Ctrl-D/EOF) is a no — never a crash, never a build
      }
      if (yes) {
        // FOREGROUND, on the consented path only. The background Stop hook must never do this: a
        // ~40MB fetch that happens invisibly while someone is working is exactly the surprise the
        // door exists to prevent. If it fails, say so and stop — the build would only fail later.
        if (!runtimePresent()) {
          const stopFetch = startSpinner('fetching the local runtime (one time)…', process.stdout);
          try {
            await ensureRuntime();
          } catch (err) {
            stopFetch();
            console.error(`\n  ${C.bad('could not download the local runtime.')}`);
            console.error(`  ${C.dim(String(err instanceof Error ? err.message : err))}`);
            console.error(`  ${C.dim(`check your connection and run ${hint('stratless init')} again.`)}\n`);
            process.exit(1);
          }
          stopFetch();
        }
        return await update([], { consented: true }); // consent is explicit here — force the build
      }
    }
    console.log(`\n  ${C.dim('No rush — the free read stays and stratless keeps it current after each session.')}`);
    console.log(`  ${C.dim('Build the full profile any time with')} ${C.b(hint('stratless update'))}${C.dim('.')}\n`);
    return;
  }

  // Muscle memory outlives a command. `report` folded into `profile`; `patterns` and `receipt` are
  // not part of the current surface (the discovery pipeline carries the evidence in the profile
  // itself). Redirect rather than error at someone who typed what used to work.
  if (cmd === 'report' || cmd === 'patterns' || cmd === 'receipt') {
    console.log(`\n  ${C.it(`${cmd} isn't part of stratless right now.`)}`);
    console.log(`  ${C.dim(`see the model of you with ${C.b(hint('stratless profile'))}`)}\n`);
    return;
  }

  // `stats` folded into `mirror` (0.4.4): the same read, but `stats` read a frozen archive snapshot
  // while `mirror` reads live. Point the muscle memory at the survivor rather than error.
  if (cmd === 'stats') {
    console.log(`\n  ${C.it('stats is now `mirror`.')}`);
    console.log(`  ${C.dim(`see your read with ${C.b(hint('stratless mirror'))}`)}\n`);
    return;
  }

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(`
  ${C.b('stratless')} — build your AI a model of who you are

    ${C.dim('get started:')}  ${C.b('npx stratless')} ${C.dim('(a free read)')}  ·  ${C.b('npx stratless init')} ${C.dim('(keep + build)')}

    ${C.b('stratless mirror')}     ${C.dim('a free read of you and your AI, changes nothing, no setup (--share: a card)')}
    ${C.b('stratless init')}       ${C.dim('keep your history, see a free read, build your profile')}
    ${C.b('stratless profile')}    ${C.dim('see the model of you — free, instant, never spends')}
    ${C.b('stratless update')}     ${C.dim('read what is new; rebuild + load the profile')}
    ${C.b('stratless stop')}       ${C.dim('turn it off — stop refreshing and unload the profile')}
    ${C.b('stratless status')}     ${C.dim("stratless's own state and what it has cost (--check: newer version?)")}

  ${C.dim('Runs on your machine. Reads your own history. Nothing leaves.')}
  ${C.dim('docs: https://stratless.com/docs')}
`);
    return;
  }

  // Bare `stratless` is the one-word CTA: show the free read, not the help wall. The explicit help
  // flags above still print the full list, so nothing is unreachable.
  if (!cmd) return mirror([]);

  // C2's command-layer half: a damaged spend-cache surfaces as ONE clear refusal, wherever it was
  // hit. Reading corruption as "empty" would re-bill the person's whole history without a word.
  try {
    if (cmd === '__worker') {
      // hidden: the doorbells spawn this — the worker process's whole life is runWorker()
      process.exitCode = await runWorker();
      return;
    }
    if (cmd === 'mirror') return await mirror(args.slice(1));
    if (cmd === 'status') return await status(args.slice(1));
    if (cmd === 'profile') return await profiler(args.slice(1));
    if (cmd === 'update') return await update(args.slice(1));
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
  const KNOWN = ['init', 'mirror', 'profile', 'update', 'stop', 'status', 'help'];
  const guess = cmd ? KNOWN.map((k) => [k, editDistance(cmd, k)] as const).filter(([, d]) => d <= 3).sort((a, b) => a[1] - b[1])[0]?.[0] : undefined;
  console.error(`\n  ${C.bad(`unknown command: ${cmd}`)}${guess ? C.dim(`  (did you mean ${guess}?)`) : ''}`);
  console.error(`  ${C.dim(`see \`${hint('stratless help')}\` for the full list`)}\n`);
  process.exit(1);
}

/** Run as a CLI only when invoked directly (`node index.js …` or the bin symlink), never when a test
 *  imports this module for its pure helpers. Resolves symlinks so the npm-global bin still counts. */
function invokedAsCli(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false; // if we can't be sure it's the entrypoint, don't auto-run — safe for imports
  }
}

if (invokedAsCli()) void main();
