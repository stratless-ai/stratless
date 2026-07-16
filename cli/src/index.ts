#!/usr/bin/env node
/**
 * stratless — build your AI a model of who you are, so it stops making you feel stupid.
 *
 *   stratless init      keep your history + turn on the after-session refresh
 *   stratless profile   the model of you your assistant should load
 *   stratless report    the same picture, written for you to read
 *   stratless update    re-read what's new, rebuild the profile, and load it
 *   stratless stop      turn it off — stop refreshing and unload the profile
 *   stratless status    stratless's own state: on or off, and what it has cost
 *   stratless stats     your assistant's activity in a project, in raw counts
 *
 * Runs on your machine. Reads your own history. Nothing leaves.
 */
import { loadEdits, claudeProjectDir, type Edit } from './transcript.js';
import { findAssistant } from './claude.js';
import { init as doInit, ARCHIVE, stopRefresh } from './init.js';
import { health } from './canary.js';
import { loadRecentExchanges, sessionCount } from './exchange.js';
import { judgeAll, cachedCount } from './judge.js';
import { synthesizeProfile, synthesizeReport, topTopics, type Corpus } from './synthesize.js';
import { injectProfile, removeProfile, humanMdPath, claudeMdPath } from './sink.js';
import { readUsage } from './usage.js';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const C = {
  b: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  you: (s: string) => `\x1b[36m${s}\x1b[0m`,
  it: (s: string) => `\x1b[33m${s}\x1b[0m`,
  ok: (s: string) => `\x1b[32m${s}\x1b[0m`,
  warn: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bad: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

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
 * The profiler — read the whole corpus, learn who you are, say it back.
 *
 * `profile` renders the AI's copy (what loads into its context); `report` renders yours. Same
 * pipeline underneath — judge every exchange once (cached forever), synthesize the pile once.
 */
function profiler(kind: 'profile' | 'report'): void {
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
    console.log(`  ${C.dim('Talk to Claude Code a few times, run `stratless init`, then try this again.')}\n`);
    return;
  }

  const sessions = sessionCount(window);
  process.stderr.write(`\n  ${C.dim(`reading ${window.length.toLocaleString()} recent exchanges across ${sessions} sessions…`)}\n`);
  const run = judgeAll([...window].reverse(), bin, {
    limit: judgeLimit(),
    onProgress: (done, total) => process.stderr.write(`\r  ${C.dim(`judging ${done}/${total} new…`)}   `),
  });
  process.stderr.write(`\r${' '.repeat(44)}\r`);

  if (!run.judgments.length) {
    console.error(`\n  ${C.bad('Could not read a single exchange.')} ${C.dim('Is `claude -p` working? Try:  claude -p hello')}\n`);
    process.exit(1);
  }

  const corpus: Corpus = {
    sessions,
    exchanges: run.judgments.length,
    topics: topTopics(run.judgments),
    from: window[0].ts.slice(0, 10),
    to: window[window.length - 1].ts.slice(0, 10),
  };

  const text =
    kind === 'profile'
      ? synthesizeProfile(run.judgments, corpus, bin)
      : synthesizeReport(run.judgments, corpus, bin);

  if (!text) {
    console.error(`\n  ${C.bad(`Could not build your ${kind}.`)} ${C.dim('The assistant returned nothing — silence beats a guess.')}\n`);
    process.exit(1);
  }

  mkdirSync(STRATLESS, { recursive: true });
  const file = join(STRATLESS, `${kind}.txt`);
  writeFileSync(file, `${text}\n`);

  const header = kind === 'profile' ? "WHO YOU'RE WORKING WITH" : 'YOUR PATTERN — what stratless sees';
  console.log(`\n  ${C.b(header)}   ${C.dim(`(stratless · ${sessions} sessions · ${run.judgments.length} exchanges)`)}\n`);
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
  console.log(`\n  ${C.dim(`${spend} · saved to ${file}`)}${more}\n`);
}

/**
 * UPDATE — the after-session refresh: read what's new, rebuild the profile, and LOAD it.
 *
 * This is what the silent Stop hook runs. Same pipeline as `profile`, then it writes the profile into
 * the assistant's own instructions file (the load step) so the next session starts already knowing you.
 */
function update(): void {
  const bin = findAssistant();
  if (!bin) {
    console.error(`\n  ${C.bad('stratless needs your assistant to read your history.')}`);
    console.error(`  ${C.dim('It borrows the `claude` you already have. Install Claude Code, then try again.')}\n`);
    process.exit(1);
  }

  const window = loadRecentExchanges(JUDGE_WINDOW);
  if (!window.length) {
    console.log(`\n  No conversations found yet.\n  ${C.dim('Talk to Claude Code a few times, run `stratless init`, then try this.')}\n`);
    return;
  }

  const sessions = sessionCount(window);
  process.stderr.write(`\n  ${C.dim(`reading ${window.length.toLocaleString()} recent exchanges across ${sessions} sessions…`)}\n`);
  const run = judgeAll([...window].reverse(), bin, {
    limit: judgeLimit(),
    onProgress: (done, total) => process.stderr.write(`\r  ${C.dim(`judging ${done}/${total} new…`)}   `),
  });
  process.stderr.write(`\r${' '.repeat(44)}\r`);

  if (!run.judgments.length) {
    console.error(`\n  ${C.bad('Could not read a single exchange.')} ${C.dim('Is `claude -p` working?')}\n`);
    process.exit(1);
  }

  const corpus: Corpus = {
    sessions,
    exchanges: run.judgments.length,
    topics: topTopics(run.judgments),
    from: window[0].ts.slice(0, 10),
    to: window[window.length - 1].ts.slice(0, 10),
  };
  const text = synthesizeProfile(run.judgments, corpus, bin);
  if (!text) {
    console.error(`\n  ${C.bad('Could not build your profile.')} ${C.dim('The assistant returned nothing — silence beats a guess.')}\n`);
    process.exit(1);
  }

  mkdirSync(STRATLESS, { recursive: true });
  writeFileSync(join(STRATLESS, 'profile.txt'), `${text}\n`);
  const { humanMd, claudeMd } = injectProfile(text);

  const spend = run.fresh ? `${run.fresh} new, ${run.cached} from cache` : `all ${run.cached} from cache`;
  const more = run.deferred ? ` · ${run.deferred} left for next run` : '';
  console.log(`\n  ${C.ok('profile refreshed and loaded')}  ${C.dim(`(${spend}${more})`)}`);
  console.log(`  ${C.dim(`wrote ${humanMd}`)}`);
  console.log(`  ${C.dim(`pointed ${claudeMd} at it (via @import)`)}\n`);
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
  console.log(`  ${C.dim('Run `stratless init` to turn everything back on.')}\n`);
}

/**
 * STATUS — stratless's own state, and what it has cost. Distinct from `stats` (which counts your
 * ASSISTANT's activity in a project): this answers "is stratless on, is my profile loaded, and how
 * much of my own plan has it spent?" Every line is read locally and for free — it spends nothing.
 */
function status(): void {
  // 1. Is the after-session refresh installed? (the Stop hook we write into settings.json)
  const settings = join(homedir(), '.claude', 'settings.json');
  let refresh = false;
  try {
    if (existsSync(settings)) {
      const s = JSON.parse(readFileSync(settings, 'utf8')) as { hooks?: { Stop?: unknown } };
      refresh = JSON.stringify(s.hooks?.Stop ?? []).includes('stratless update');
    }
  } catch {
    /* an unreadable settings file reads as off, never a crash */
  }

  // 2. Is the profile actually loaded? HUMAN.md exists AND CLAUDE.md carries our redirect block.
  const human = humanMdPath();
  const claude = claudeMdPath();
  const humanExists = existsSync(human);
  let redirected = false;
  try {
    redirected = existsSync(claude) && readFileSync(claude, 'utf8').includes('<!-- stratless:start -->');
  } catch {
    /* treat unreadable as not-loaded */
  }
  const loaded = humanExists && redirected;

  // 3. When was it last refreshed? HUMAN.md's mtime is the honest answer.
  let last = 'never';
  try {
    if (humanExists) last = statSync(human).mtime.toISOString().slice(0, 10);
  } catch {
    /* leave as "never" */
  }

  const judged = cachedCount();
  const u = readUsage();
  const cost = `$${u.costUsd.toFixed(2)}`;
  const onOwn = `across ${u.calls.toLocaleString()} read${u.calls === 1 ? '' : 's'}, on your own claude`;

  console.log(`\n  ${C.b('stratless status')}\n`);
  console.log(`    after-session refresh   ${refresh ? C.ok('on') : C.dim('off')}`);
  console.log(`    profile loaded          ${loaded ? C.ok('yes') : C.dim('no')}${humanExists ? `  ${C.dim(human)}` : ''}`);
  console.log(`    exchanges judged        ${C.b(judged.toLocaleString())}`);
  console.log(`    last refresh            ${C.dim(last)}`);
  console.log(`    spent so far            ${C.b(cost)}  ${C.dim(onOwn)}`);
  if (!refresh) console.log(`\n  ${C.dim('Run `stratless init` to turn the after-session refresh on.')}`);
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

function main(): void {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const cwd = process.cwd();

  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    console.log(`stratless ${version()}`);
    return;
  }

  if (cmd === 'init') {
    const auto = args.includes('--auto');
    const r = doInit({ auto });
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
          ? 'Auto-refresh rebuilds your profile in the background after each session. Turn it off with: stratless stop'
          : 'Auto-refresh is off. Turn on background updates any time with: stratless init --auto',
      )}\n`,
    );
    console.log(`  ${C.dim('Next:')} stratless profile\n`);
    return;
  }

  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`
  ${C.b('stratless')} — build your AI a model of who you are

    ${C.b('stratless init')}       ${C.dim('keep your history safe (add --auto for background refresh)')}
    ${C.b('stratless profile')}    ${C.dim('the model of you your assistant should load')}
    ${C.b('stratless report')}     ${C.dim('the same picture, written for you to read')}
    ${C.b('stratless update')}     ${C.dim('re-read what is new, rebuild the profile, and load it')}
    ${C.b('stratless stop')}       ${C.dim('turn it off — stop refreshing and unload the profile')}
    ${C.b('stratless status')}     ${C.dim("stratless's own state: on or off, and what it has cost")}
    ${C.b('stratless stats')}      ${C.dim("your assistant's activity in a project: raw counts, free")}

  ${C.dim('Runs on your machine. Reads your own history. Nothing leaves.')}
`);
    return;
  }

  if (cmd === 'stats') return stats(cwd);
  if (cmd === 'status') return status();
  if (cmd === 'profile') return profiler('profile');
  if (cmd === 'report') return profiler('report');
  if (cmd === 'update') return update();
  if (cmd === 'stop') return stop();

  console.error(`  unknown command: ${cmd}`);
  process.exit(1);
}

main();
