#!/usr/bin/env node
/**
 * stratless — your coding assistant explains itself.
 *
 *   stratless why <file>:<line>    the decision that made this line
 *   stratless stats                what your assistant did to you
 *
 * Runs on your machine. Reads your own history. Nothing leaves.
 * Nothing is generated that isn't already in your repo.
 */
import { loadEdits, claudeProjectDir, type Edit } from './transcript.js';
import { why, type Answer } from './match.js';
import { findAssistant, explain } from './explain.js';
import { init as doInit, ARCHIVE } from './init.js';
import { health } from './canary.js';
import { loadExchanges, sessionCount } from './exchange.js';
import { judgeAll } from './judge.js';
import { synthesizeProfile, synthesizeReport, topTopics, type Corpus } from './synthesize.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function render(file: string, lineNo: number, a: Answer): void {
  console.log(`\n  ${C.b(`${file}:${lineNo}`)}`);
  if (a.line) console.log(`  ${C.dim(clip(a.line, 76))}\n`);

  if (a.verdict === 'yours') {
    console.log(`  ${C.ok('This one is yours.')} No assistant edit in the archive wrote it.`);
    if (a.note) console.log(`  ${C.dim(a.note)}`);
    console.log();
    return;
  }

  if (a.verdict === 'lost') {
    console.log(`  ${C.bad('The conversation that explains this line was deleted.')}`);
    if (a.note) console.log(`  ${C.dim(a.note)}`);
    console.log(`\n  ${C.dim('Claude Code deletes transcripts after 30 days. Run `stratless init` to stop it.')}\n`);
    return;
  }

  const e = a.edit!;
  const tag = a.verdict === 'matched' ? C.ok('✓ matched') : C.warn('~ likely');
  console.log(`  ${tag} ${C.dim(`${Math.round(a.confidence * 100)}% · written ${e.date} · session ${e.session.slice(0, 8)}`)}\n`);

  if (e.prompt) console.log(`  ${C.you('You said')}  ${clip(e.prompt, 72)}`);
  if (e.said) console.log(`  ${C.it('It said')}   ${clip(e.said, 72)}`);

  // Tier 1 — what it MEANS, in words you own. Borrowed from the assistant you already have.
  // Silence is the correct output when it can't answer honestly.
  const bin = findAssistant();
  if (bin) {
    const meaning = explain(e, a.line, bin);
    if (meaning) console.log(`\n  ${C.b('So what')}   ${meaning}`);
  }

  if (a.blame) console.log(`\n  ${C.dim(`git: ${a.blame.sha} ${a.blame.date} — ${clip(a.blame.summary, 46)}`)}`);
  if (a.note) console.log(`  ${C.warn('note')}: ${a.note}`);
  console.log();
}

/**
 * If we can't read the log, SAY SO. Never fall through to a confident lie.
 *
 * stratless reads a format it does not own, and Claude Code will change it. When that happens
 * nothing crashes — we'd parse zero edits, match nothing, and tell every user "you wrote this line
 * yourself" with total confidence, forever, silently. `health()` catches exactly that: write-tool
 * calls visible in the log whose input we can no longer read. It refuses instead of guessing.
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
 * The profiler — read the whole corpus, learn who you are, say it back.
 *
 * `profile` renders the AI's copy (what loads into its context); `report` renders yours. Same
 * pipeline underneath — judge every exchange once (§3.2, cached forever), synthesize the pile once
 * (§3.3) — so running one after the other costs a single extra synthesis, never a re-read.
 */
function profiler(kind: 'profile' | 'report'): void {
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
  const cap = Number(process.env.STRATLESS_JUDGE_LIMIT);
  const limit = Number.isFinite(cap) && cap > 0 ? cap : undefined;

  // Progress goes to stderr so `stratless profile > file` keeps only the profile itself.
  process.stderr.write(`\n  ${C.dim(`reading ${exchanges.length.toLocaleString()} exchanges across ${sessions} sessions…`)}\n`);
  const run = judgeAll(exchanges, bin, {
    limit,
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

function main(): void {
  const [cmd, arg] = process.argv.slice(2);
  const cwd = process.cwd();

  if (cmd === 'init') {
    const r = doInit();
    console.log(`\n  ${C.ok('stratless is watching your history.')}\n`);
    console.log(`    reaper           ${C.dim(String(r.before))} → ${C.b(`${r.after} days`)}`);
    console.log(`    archived         ${C.b(String(r.copied))} transcripts${r.skipped ? C.dim(` (${r.skipped} already current)`) : ''}`);
    console.log(`    kept at          ${C.dim(ARCHIVE)}`);
    console.log(`\n  ${C.dim('Claude Code deletes transcripts after 30 days — per file, even in a project')}`);
    console.log(`  ${C.dim('you use daily. Anything already gone is gone. Everything from here is kept.')}\n`);
    console.log(`  ${C.dim('Next:')} stratless stats\n`);
    return;
  }


  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`
  ${C.b('stratless')} — your coding assistant explains itself

    ${C.b('stratless init')}                ${C.dim('stop the 30-day reaper. archive everything.')}
    ${C.b('stratless profile')}             ${C.dim("the model of you your assistant should load")}
    ${C.b('stratless report')}              ${C.dim('the same, written for you to read')}
    ${C.b('stratless stats')}               ${C.dim('raw counts — instant, free, no tokens')}
    ${C.b('stratless why <file>:<line>')}   ${C.dim('the decision that made this line')}

  ${C.dim('Runs on your machine. Reads your own history. Nothing leaves.')}
`);
    return;
  }

  if (cmd === 'stats') return stats(cwd);
  if (cmd === 'profile') return profiler('profile');
  if (cmd === 'report') return profiler('report');

  if (cmd === 'why') {
    if (!arg) {
      console.error('  usage: stratless why <file>:<line>');
      process.exit(1);
    }
    const m = /^(.*):(\d+)$/.exec(arg);
    if (!m) {
      console.error(`  usage: stratless why <file>:<line>   (got "${arg}")`);
      process.exit(1);
    }
    const [, file, n] = m;
    if (!existsSync(file)) {
      console.error(`  no such file: ${file}`);
      process.exit(1);
    }
    const edits = loadEdits(cwd);
    if (!guard(cwd, edits)) process.exit(1);
    if (!edits.length) {
      console.error(`\n  No history for this project.\n  ${C.dim(`Looked in: ${claudeProjectDir(cwd)}`)}\n`);
      process.exit(1);
    }
    render(file, Number(n), why(file, Number(n), edits, cwd));
    return;
  }

  console.error(`  unknown command: ${cmd}`);
  process.exit(1);
}

main();
