#!/usr/bin/env node
/**
 * stratless — build your AI a model of who you are, so it stops making you feel stupid.
 *
 *   stratless init      keep your history + turn on the after-session refresh
 *   stratless profile   the model of you your assistant should load
 *   stratless report    the same picture, written for you to read
 *   stratless update    re-read what's new, rebuild the profile, and load it
 *   stratless stats     raw counts — instant, free, no tokens
 *
 * Runs on your machine. Reads your own history. Nothing leaves.
 */
import { loadEdits, claudeProjectDir, type Edit } from './transcript.js';
import { findAssistant } from './claude.js';
import { init as doInit, ARCHIVE, stopRefresh } from './init.js';
import { health } from './canary.js';
import { loadExchanges, sessionCount } from './exchange.js';
import { judgeAll } from './judge.js';
import { synthesizeProfile, synthesizeReport, topTopics, type Corpus } from './synthesize.js';
import { injectProfile } from './sink.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

/** Amortize default: a good first profile without chewing the whole backlog in one run. */
const DEFAULT_JUDGE_LIMIT = 50;

/**
 * Per-run cap on FRESH judge calls (cache hits are always free). `--backfill` lifts it entirely;
 * STRATLESS_JUDGE_LIMIT overrides it; otherwise a sane default keeps every run — and the after-session
 * hook — cheap, and the backlog drains over sessions.
 */
const judgeLimit = (backfill: boolean): number | undefined => {
  if (backfill) return undefined;
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
function profiler(kind: 'profile' | 'report', backfill: boolean): void {
  const bin = findAssistant();
  if (!bin) {
    console.error(`\n  ${C.bad('stratless needs your assistant to read your history.')}`);
    console.error(`  ${C.dim('It borrows the `claude` you already have — no API key, nothing new to install.')}`);
    console.error(`  ${C.dim('Install Claude Code, then run this again.')}\n`);
    process.exit(1);
  }

  const exchanges = loadExchanges();
  if (!exchanges.length) {
    console.log(`\n  No conversations found yet.`);
    console.log(`  ${C.dim('Talk to Claude Code a few times, run `stratless init`, then try this again.')}\n`);
    return;
  }

  const sessions = sessionCount(exchanges);
  process.stderr.write(`\n  ${C.dim(`reading ${exchanges.length.toLocaleString()} exchanges across ${sessions} sessions…`)}\n`);
  const run = judgeAll([...exchanges].reverse(), bin, {
    limit: judgeLimit(backfill),
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
    from: exchanges[0].ts.slice(0, 10),
    to: exchanges[exchanges.length - 1].ts.slice(0, 10),
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
function update(backfill: boolean): void {
  const bin = findAssistant();
  if (!bin) {
    console.error(`\n  ${C.bad('stratless needs your assistant to read your history.')}`);
    console.error(`  ${C.dim('It borrows the `claude` you already have. Install Claude Code, then try again.')}\n`);
    process.exit(1);
  }

  const exchanges = loadExchanges();
  if (!exchanges.length) {
    console.log(`\n  No conversations found yet.\n  ${C.dim('Talk to Claude Code a few times, run `stratless init`, then try this.')}\n`);
    return;
  }

  const sessions = sessionCount(exchanges);
  process.stderr.write(`\n  ${C.dim(`reading ${exchanges.length.toLocaleString()} exchanges across ${sessions} sessions…`)}\n`);
  const run = judgeAll([...exchanges].reverse(), bin, {
    limit: judgeLimit(backfill),
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
    from: exchanges[0].ts.slice(0, 10),
    to: exchanges[exchanges.length - 1].ts.slice(0, 10),
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
 * STOP — the off switch. Removes the after-session refresh hook. Your history, archive, and profile
 * stay exactly as they are; only the automatic updates stop. Being able to shut it up is half of why a
 * tool that reads everything earns trust.
 */
function stop(): void {
  if (stopRefresh()) {
    console.log(`\n  ${C.ok('after-session refresh is off.')}`);
    console.log(`  ${C.dim('Your history + profile are untouched. Run `stratless update` by hand, or `stratless init` to turn it back on.')}\n`);
  } else {
    console.log(`\n  ${C.dim('the after-session refresh was not on — nothing to stop.')}\n`);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const backfill = args.includes('--backfill') || args.includes('--all');
  const cwd = process.cwd();

  if (cmd === 'init') {
    const r = doInit();
    console.log(`\n  ${C.ok('stratless is watching your history.')}\n`);
    console.log(`    reaper           ${C.dim(String(r.before))} → ${C.b(`${r.after} days`)}`);
    console.log(`    archived         ${C.b(String(r.copied))} transcripts${r.skipped ? C.dim(` (${r.skipped} already current)`) : ''}`);
    console.log(`    kept at          ${C.dim(ARCHIVE)}`);
    console.log(`    after-session    ${r.hookInstalled ? C.b('refresh installed') : C.dim('refresh already on')}`);
    console.log(`\n  ${C.dim('Claude Code deletes transcripts after 30 days — per file, even in a project you')}`);
    console.log(`  ${C.dim('use daily. Anything already gone is gone. Everything from here is kept.')}\n`);
    console.log(`  ${C.dim('Next:')} stratless profile\n`);
    return;
  }

  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`
  ${C.b('stratless')} — build your AI a model of who you are

    ${C.b('stratless init')}       ${C.dim('keep your history + turn on the after-session refresh')}
    ${C.b('stratless profile')}    ${C.dim('the model of you your assistant should load')}
    ${C.b('stratless report')}     ${C.dim('the same picture, written for you to read')}
    ${C.b('stratless update')}     ${C.dim('re-read what is new, rebuild the profile, and load it')}
    ${C.b('stratless stop')}       ${C.dim('turn the after-session refresh back off')}
    ${C.b('stratless stats')}      ${C.dim('raw counts — instant, free, no tokens')}

  ${C.dim('add --backfill to profile/update to read your whole history at once (else it amortizes).')}
  ${C.dim('Runs on your machine. Reads your own history. Nothing leaves.')}
`);
    return;
  }

  if (cmd === 'stats') return stats(cwd);
  if (cmd === 'profile') return profiler('profile', backfill);
  if (cmd === 'report') return profiler('report', backfill);
  if (cmd === 'update') return update(backfill);
  if (cmd === 'stop') return stop();

  console.error(`  unknown command: ${cmd}`);
  process.exit(1);
}

main();
