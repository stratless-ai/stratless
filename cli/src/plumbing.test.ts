/**
 * THE PLUMBING TESTS — Phase 1 of the cold-start build (0.3.4).
 *
 * Spec §7: each acceptance criterion is a test, not an aspiration; §12: these passing IS the
 * definition of done. Covered here: C2 (atomic writes + loud corrupt caches), C4 (the lock),
 * C5 (detached survival), C6 (backoff, not death), C8 (the stopwatch exists), C9 (the borrow is
 * tool-less), C10 (recency is right-way-up), C11 (no unmetered call, no pin escape — unsaid).
 * The corrupt-store refusals for the two spend caches are pinned in stratless.test.ts, next to
 * the stores they guard.
 */
import { strict as assert } from 'node:assert';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, before, after } from 'node:test';

import { atomicWriteFileSync } from './atomic.js';
import { acquireLock, releaseLock, readLock, lockIsStale, spawnDetached } from './worker.js';
import { summarizeTurns, appendRun, stageRates, etaMs, startRun, STOPWATCH_KEEP } from './stopwatch.js';
import { runStreamBatch, isTransientFailure } from './stream.js';
import { runClaude, parseJsonResult, CLEAN_ARGS, TOOLLESS_ARGS } from './claude.js';
import { readState, writeState, type RunRecord } from './state.js';
import { readUsage, recordUsage } from './usage.js';

let dir: string;
/** Where the compiled modules live — child-process fixtures import them by absolute URL. */
const distDir = dirname(fileURLToPath(import.meta.url));
const moduleUrl = (name: string): string => pathToFileURL(join(distDir, name)).href;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'stratless-plumbing-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Write an executable node script fixture and return its path. */
function writeBin(name: string, source: string): string {
  const p = join(dir, name);
  writeFileSync(p, `#!/usr/bin/env node\n${source}`);
  chmodSync(p, 0o755);
  return p;
}

// ── C2 — atomic writes: a kill leaves the old file or the new file, never a torn one ───────────

test('C2: atomicWriteFileSync creates parents, writes whole, replaces whole', () => {
  const f = join(dir, 'deep', 'nested', 'store.json');
  atomicWriteFileSync(f, '{"gen":1}');
  assert.equal(readFileSync(f, 'utf8'), '{"gen":1}');
  atomicWriteFileSync(f, '{"gen":2}');
  assert.equal(readFileSync(f, 'utf8'), '{"gen":2}', 'replaced in place');
});

test('C2: kill -9 mid-write leaves a parseable store — old version or new, never torn', async () => {
  const target = join(dir, 'kill-target.json');
  atomicWriteFileSync(target, JSON.stringify({ gen: -1, pad: 'seed' }));
  // The writer child: rewrites a ~2MB store in a hot loop through atomicWriteFileSync.
  const writer = join(dir, 'kill-writer.mjs');
  writeFileSync(
    writer,
    [
      `import { atomicWriteFileSync } from '${moduleUrl('atomic.js')}';`,
      `const target = process.argv[2];`,
      `let gen = 0;`,
      `for (;;) { atomicWriteFileSync(target, JSON.stringify({ gen: gen++, pad: 'x'.repeat(2_000_000) })); }`,
    ].join('\n'),
  );
  for (let round = 0; round < 3; round++) {
    const child = spawn(process.execPath, [writer, target], { stdio: 'ignore' });
    await sleep(60 + round * 60); // land the kill at different points in the write loop
    child.kill('SIGKILL');
    await new Promise((r) => child.on('close', r));
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as { gen: number; pad: string };
    assert.ok(Number.isInteger(parsed.gen), `round ${round}: store parses after SIGKILL (gen ${parsed.gen})`);
  }
});

// ── C4 — the lock: one spender, ever; stale locks stolen, live ones respected ──────────────────

test('C4: simultaneous acquirers — exactly one wins', async () => {
  const lockFile = join(dir, 'race.lock');
  const contender = join(dir, 'contender.mjs');
  writeFileSync(
    contender,
    [
      `import { acquireLock } from '${moduleUrl('worker.js')}';`,
      `if (acquireLock(process.argv[2])) {`,
      `  console.log('WIN');`,
      `  setTimeout(() => process.exit(0), 2500); // hold the lock past every sibling's attempt`,
      `} else {`,
      `  console.log('LOSE');`,
      `  process.exit(0);`,
      `}`,
    ].join('\n'),
  );
  const N = 8;
  const outputs = await Promise.all(
    Array.from({ length: N }, () =>
      new Promise<string>((resolve) => {
        execFile(process.execPath, [contender, lockFile], { timeout: 10_000 }, (_err, stdout) => resolve(stdout.trim()));
      }),
    ),
  );
  const wins = outputs.filter((o) => o === 'WIN').length;
  assert.equal(wins, 1, `exactly one winner (got ${wins} from [${outputs.join(', ')}])`);
});

test('C4: a dead holder is stale and stolen; the thief records itself', async () => {
  const lockFile = join(dir, 'stale-dead.lock');
  // A real process that has really exited — its pid is genuinely dead.
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const deadPid = child.pid!;
  await new Promise((r) => child.on('close', r));
  writeFileSync(lockFile, `${JSON.stringify({ pid: deadPid, startedAt: '2026-01-01T00:00:00Z' })}\n`);
  assert.equal(lockIsStale({ pid: deadPid, startedAt: '', kind: 'worker' }), true, 'dead pid reads stale');
  assert.equal(acquireLock(lockFile), true, 'the stale lock is stolen');
  assert.equal(readLock(lockFile)?.pid, process.pid, 'and the thief now holds it');
  releaseLock(lockFile);
  assert.equal(existsSync(lockFile), false, 'release removes our own lock');
});

test('C4: a live pid that is NOT a stratless-ish process is PID reuse — stale, stolen', async () => {
  const lockFile = join(dir, 'stale-foreign.lock');
  const foreign = spawn('sleep', ['30'], { stdio: 'ignore' }); // alive, but plainly not us
  await sleep(50);
  try {
    writeFileSync(lockFile, `${JSON.stringify({ pid: foreign.pid, startedAt: '2026-01-01T00:00:00Z' })}\n`);
    assert.equal(lockIsStale({ pid: foreign.pid!, startedAt: '', kind: 'worker' }), true, 'a sleep(1) holding our lock is a recycled pid');
    assert.equal(acquireLock(lockFile), true, 'stolen');
    releaseLock(lockFile);
  } finally {
    foreign.kill('SIGKILL');
  }
});

test('C4: a live node-ish holder is respected — no steal, acquire says no', async () => {
  const lockFile = join(dir, 'held.lock');
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { stdio: 'ignore' });
  await sleep(80); // let it exist for ps
  try {
    writeFileSync(lockFile, `${JSON.stringify({ pid: holder.pid, startedAt: new Date().toISOString() })}\n`);
    assert.equal(lockIsStale({ pid: holder.pid!, startedAt: '', kind: 'worker' }), false, 'alive node process = plausibly ours');
    assert.equal(acquireLock(lockFile), false, 'the lock is respected');
    assert.equal(readLock(lockFile)?.pid, holder.pid, 'and untouched');
    releaseLock(lockFile); // not ours — must be a no-op
    assert.equal(readLock(lockFile)?.pid, holder.pid, 'release never removes a lock we do not hold');
  } finally {
    holder.kill('SIGKILL');
  }
});

// ── C5 — detached survival: the worker outlives the terminal that spawned it ───────────────────

test('C5: a detached child survives its parent dying and finishes its work', async () => {
  const out = join(dir, 'detached-proof.txt');
  const parent = join(dir, 'detached-parent.mjs');
  const grandchildJs = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(out)}, 'done'), 400);`;
  writeFileSync(
    parent,
    [
      `import { spawnDetached } from '${moduleUrl('worker.js')}';`,
      `const pid = spawnDetached(process.execPath, ['-e', ${JSON.stringify(grandchildJs)}]);`,
      `if (!pid) process.exit(1);`,
      `process.exit(0); // the parent dies immediately — the worker must not care`,
    ].join('\n'),
  );
  execFileSync(process.execPath, [parent], { timeout: 5000 }); // parent runs and exits at once
  // The grandchild writes ~400ms AFTER its parent is gone. Poll rather than guess.
  let seen = false;
  for (let i = 0; i < 40 && !seen; i++) {
    await sleep(50);
    seen = existsSync(out);
  }
  assert.ok(seen, 'the detached worker completed after its parent died');
  assert.equal(readFileSync(out, 'utf8'), 'done');
});

// ── C6 — backoff, not death: a 429 storm degrades throughput and loses nothing ─────────────────

test('C6: isTransientFailure separates weather from wreckage', () => {
  for (const t of ['HTTP 429 Too Many Requests', 'rate limit exceeded', 'Overloaded', 'ECONNRESET mid-stream', 'error 529']) {
    assert.equal(isTransientFailure(t), true, `transient: ${t}`);
  }
  for (const f of ['unknown option --tools', 'invalid api key', 'model not found', '']) {
    assert.equal(isTransientFailure(f), false, `fatal: ${f}`);
  }
});

/** The fake streaming claude: answers each stdin turn with a result event; injects failures at
 *  configured GLOBAL turn numbers (counted across invocations via a counter file). */
function writeStreamBin(): string {
  return writeBin(
    'fake-stream-claude',
    `
const fs = require('fs');
if (process.env.FAKE_ARGV) fs.writeFileSync(process.env.FAKE_ARGV, JSON.stringify(process.argv.slice(2)));
const counter = process.env.FAKE_COUNTER;
const failAt = (process.env.FAKE_FAIL_AT || '').split(',').filter(Boolean).map(Number);
const mode = process.env.FAKE_FAIL_MODE || 'transient-exit';
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let n = 0;
    try { n = Number(fs.readFileSync(counter, 'utf8')) || 0; } catch {}
    n++;
    fs.writeFileSync(counter, String(n));
    if (failAt.includes(n)) {
      if (mode === 'transient-exit') { process.stderr.write('429 Too Many Requests: rate limited\\n'); process.exit(1); }
      if (mode === 'error-event') {
        process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'API 429 rate limit' }) + '\\n');
        continue; // stay alive; the caller kills the session
      }
      if (mode === 'empty-result') {
        process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: '', usage: {}, total_cost_usd: 0 }) + '\\n');
        continue; // an empty answer still advances the turn
      }
      process.stderr.write('fatal: model exploded\\n'); process.exit(1);
    }
    process.stdout.write(JSON.stringify({
      type: 'result', subtype: 'success', result: 'ok ' + n,
      usage: { input_tokens: 2, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 10 },
      total_cost_usd: 0.001,
    }) + '\\n');
  }
});
process.stdin.on('end', () => process.exit(0));
`,
  );
}

const streamItems = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `it-${i + 1}`, prompt: `q${i + 1}` }));

test('C6: a 429 storm — the batch completes, retries are counted, zero evidence lost', async () => {
  const bin = writeStreamBin();
  const usageFile = join(dir, 'usage-c6a.json');
  const counter = join(dir, 'counter-a');
  process.env.STRATLESS_USAGE = usageFile;
  process.env.STRATLESS_BACKOFF_BASE_MS = '5';
  process.env.FAKE_COUNTER = counter;
  process.env.FAKE_FAIL_AT = '3,6'; // two mid-batch rate-limit deaths
  process.env.FAKE_FAIL_MODE = 'transient-exit';
  try {
    const r = await runStreamBatch(bin, { systemPrompt: 'rules', role: 'judge', feature: 'judge', items: streamItems(8) });
    assert.equal(r.completed, 8, 'every item answered despite two 429 deaths');
    assert.equal(r.remaining.length, 0, 'nothing left for the fallback ladder');
    assert.ok(r.retries >= 2, `the backoff rung engaged (${r.retries} retries)`);
    assert.equal(r.turnsMs.length, 8, 'C8: a wall-clock recorded per completed turn');
    assert.ok(readUsage(usageFile).calls >= 2, 'each productive session recorded its receipt');
  } finally {
    delete process.env.STRATLESS_USAGE;
    delete process.env.STRATLESS_BACKOFF_BASE_MS;
    delete process.env.FAKE_COUNTER;
    delete process.env.FAKE_FAIL_AT;
    delete process.env.FAKE_FAIL_MODE;
  }
});

test('C6: an in-band error result never advances the turn — session ends, retry completes the batch', async () => {
  const bin = writeStreamBin();
  const counter = join(dir, 'counter-b');
  process.env.STRATLESS_USAGE = join(dir, 'usage-c6b.json');
  process.env.STRATLESS_BACKOFF_BASE_MS = '5';
  process.env.FAKE_COUNTER = counter;
  process.env.FAKE_FAIL_AT = '2';
  process.env.FAKE_FAIL_MODE = 'error-event';
  try {
    const r = await runStreamBatch(bin, { systemPrompt: 'rules', role: 'judge', feature: 'judge', items: streamItems(4) });
    assert.equal(r.completed, 4, 'the erroring turn was retried, not swallowed as an answer');
    for (const [, text] of r.results) assert.ok(text.startsWith('ok '), 'no error text ever recorded as a verdict');
    assert.ok(r.retries >= 1);
  } finally {
    delete process.env.STRATLESS_USAGE;
    delete process.env.STRATLESS_BACKOFF_BASE_MS;
    delete process.env.FAKE_COUNTER;
    delete process.env.FAKE_FAIL_AT;
    delete process.env.FAKE_FAIL_MODE;
  }
});

test('C6: a FATAL death keeps the 0.3.1 semantics — completed turns kept, remainder to the ladder', async () => {
  const bin = writeStreamBin();
  const counter = join(dir, 'counter-c');
  process.env.STRATLESS_USAGE = join(dir, 'usage-c6c.json');
  process.env.STRATLESS_BACKOFF_BASE_MS = '5';
  process.env.FAKE_COUNTER = counter;
  process.env.FAKE_FAIL_AT = '2';
  process.env.FAKE_FAIL_MODE = 'fatal-exit';
  try {
    const r = await runStreamBatch(bin, { systemPrompt: 'rules', role: 'judge', feature: 'judge', items: streamItems(5) });
    assert.equal(r.completed, 1, 'the turn before the fatal death survives');
    assert.equal(r.remaining.length, 4, 'the rest is handed to the per-call ladder, not retried blindly');
    assert.equal(r.retries, 0, 'no backoff spent on a non-transient failure');
  } finally {
    delete process.env.STRATLESS_USAGE;
    delete process.env.STRATLESS_BACKOFF_BASE_MS;
    delete process.env.FAKE_COUNTER;
    delete process.env.FAKE_FAIL_AT;
    delete process.env.FAKE_FAIL_MODE;
  }
});

// ── C8 — the stopwatch exists: fields recorded, rates derived, ETA measured-only ───────────────

test('C8: summarizeTurns — mean and p90 from raw walls, junk filtered', () => {
  assert.equal(summarizeTurns([]), undefined, 'no turns, no stats');
  const s = summarizeTurns([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
  assert.deepEqual(s, { count: 10, meanMs: 550, p90Ms: 1000 });
  assert.deepEqual(summarizeTurns([NaN, -5, 120]), { count: 1, meanMs: 120, p90Ms: 120 }, 'junk dropped');
});

test('C8: appendRun keeps a bounded ring, newest last', () => {
  const run = (at: string): RunRecord => ({ at, totalMs: 1, stages: [] });
  let ring: RunRecord[] | undefined;
  for (let i = 0; i < STOPWATCH_KEEP + 5; i++) ring = appendRun(ring, run(`t${i}`));
  assert.equal(ring!.length, STOPWATCH_KEEP, 'bounded');
  assert.equal(ring![ring!.length - 1].at, `t${STOPWATCH_KEEP + 4}`, 'newest last');
  assert.equal(ring![0].at, 't5', 'oldest dropped');
});

test('C8: stageRates + etaMs — rates from measured runs only, ETA refuses unmeasured stages', () => {
  const runs: RunRecord[] = [
    { at: 'a', totalMs: 0, stages: [{ stage: 'judge', ms: 1000, units: 10 }, { stage: 'mine', ms: 6000, units: 30 }] },
    { at: 'b', totalMs: 0, stages: [{ stage: 'judge', ms: 3000, units: 10 }, { stage: 'synthesis', ms: 0, units: 0 }] },
  ];
  const rates = stageRates(runs);
  assert.equal(rates.judge, 200, '(1000+3000)/(10+10)');
  assert.equal(rates.mine, 200, '6000/30');
  assert.equal(rates.synthesis, undefined, 'zero units teaches nothing — no rate');
  assert.equal(etaMs(rates, { judge: 150 }), 30_000, '150 judgments at 200ms each');
  assert.equal(etaMs(rates, { judge: 150, mine: 150 }), 60_000, 'stages sum');
  assert.equal(etaMs(rates, { judge: 10, synthesis: 1 }), undefined, 'an unmeasured stage refuses the guess');
  assert.equal(etaMs(rates, { judge: 10, synthesis: 0 }), 2000, 'zero units of an unmeasured stage is fine — no work, nothing unknown');
});

test('C8: the run record survives the state round-trip; malformed entries are dropped', () => {
  const f = join(dir, 'state-stopwatch.json');
  const good: RunRecord = {
    at: '2026-07-17T10:00:00Z',
    totalMs: 5000,
    stages: [{ stage: 'judge', ms: 4000, units: 12, turns: { count: 12, meanMs: 333, p90Ms: 500 } }],
  };
  writeState({ lastSynthesisAt: '2026-07-17T09:00:00Z', stopwatch: [good] }, f);
  const back = readState(f);
  assert.deepEqual(back.stopwatch, [good], 'timing fields persist intact');
  assert.equal(back.lastSynthesisAt, '2026-07-17T09:00:00Z', 'alongside the rest of the state');
  writeFileSync(f, JSON.stringify({ stopwatch: [good, { at: 42, totalMs: 'x' }, { at: 'ok', totalMs: 1, stages: [{ stage: 7 }] }] }));
  const filtered = readState(f);
  assert.equal(filtered.stopwatch!.length, 2, 'malformed run dropped');
  assert.deepEqual(filtered.stopwatch![0], good);
  assert.deepEqual(filtered.stopwatch![1].stages, [], 'malformed stage dropped, run kept');
});

test('C8: startRun().record() merges into existing state — never clobbers, ring stays bounded', () => {
  const f = join(dir, 'state-record.json');
  process.env.STRATLESS_STATE = f;
  try {
    writeState({ lastSynthesisAt: '2026-07-16T00:00:00Z', judgmentsAtLastSynthesis: 42 });
    const sw = startRun();
    sw.stage('judge', 1234, 5, [200, 300, 250, 180, 304]);
    sw.stage('synthesis', 900, 1);
    sw.record();
    const s = readState();
    assert.equal(s.lastSynthesisAt, '2026-07-16T00:00:00Z', 'the rest of the state survives');
    assert.equal(s.judgmentsAtLastSynthesis, 42);
    assert.equal(s.stopwatch!.length, 1);
    const run = s.stopwatch![0];
    assert.equal(run.stages.length, 2);
    assert.equal(run.stages[0].stage, 'judge');
    assert.equal(run.stages[0].units, 5);
    assert.equal(run.stages[0].turns!.count, 5, 'per-turn stats recorded');
    assert.ok(run.totalMs >= 0);
  } finally {
    delete process.env.STRATLESS_STATE;
  }
});

// ── C9 — the borrow is tool-less: every spawn carries --tools "" ───────────────────────────────

/** The fake one-shot claude: dumps argv, then behaves per FAKE_MODE. */
function writeOneShotBin(): string {
  return writeBin(
    'fake-oneshot-claude',
    `
const fs = require('fs');
if (process.env.FAKE_ARGV) fs.writeFileSync(process.env.FAKE_ARGV, JSON.stringify(process.argv.slice(2)));
const mode = process.env.FAKE_MODE || 'json';
if (mode === 'nopin-json' && process.argv.includes('--model')) { process.stderr.write('boom'); process.exit(1); }
if (mode === 'error-envelope-pinned' && process.argv.includes('--model')) {
  // A failed model pin exits 0 with an error ENVELOPE whose subtype is still 'success' (verified
  // live against claude 2.1.212) — only is_error tells the truth.
  process.stdout.write(JSON.stringify({ result: "There's an issue with the selected model.", is_error: true, subtype: 'success', total_cost_usd: 0.0001, usage: { input_tokens: 1, output_tokens: 1 } }));
  process.exit(0);
}
if (mode === 'text') { process.stdout.write('plain words, no receipt'); process.exit(0); }
process.stdout.write(JSON.stringify({
  result: 'hi',
  total_cost_usd: 0.002,
  usage: { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 1, cache_read_input_tokens: 2 },
  modelUsage: { 'claude-test-default': { inputTokens: 5, outputTokens: 3, cacheCreationInputTokens: 1, cacheReadInputTokens: 2, costUSD: 0.002 } },
}));
`,
  );
}

test('C9: runClaude spawns tool-less — --tools "" rides every attempt', () => {
  const bin = writeOneShotBin();
  const argvFile = join(dir, 'argv-oneshot.json');
  process.env.STRATLESS_USAGE = join(dir, 'usage-c9.json');
  process.env.FAKE_ARGV = argvFile;
  process.env.FAKE_MODE = 'json';
  try {
    const out = runClaude(bin, 'question', 'haiku', 'judge');
    assert.equal(out, 'hi');
    const argv = JSON.parse(readFileSync(argvFile, 'utf8')) as string[];
    const i = argv.indexOf('--tools');
    assert.ok(i >= 0, 'the --tools flag is present');
    assert.equal(argv[i + 1], '', 'and empty — ALL tools disabled');
    assert.deepEqual([...TOOLLESS_ARGS], ['--tools', ''], 'one constant governs every spawn');
    assert.ok(argv.includes('--model') && argv.includes('haiku'), 'the pin still rides the first attempt');
    // The variadic-swallow regression: --tools <tools...> would eat a FOLLOWING positional, so the
    // prompt must always precede it (verified live: trailing --tools parses; leading eats the input).
    assert.ok(argv.indexOf('question') < i, 'the prompt comes BEFORE --tools — variadic flags swallow positionals');
  } finally {
    delete process.env.STRATLESS_USAGE;
    delete process.env.FAKE_ARGV;
    delete process.env.FAKE_MODE;
  }
});

// ── the borrow is BLANK-SLATE: every spawn carries --safe-mode ─────────────────────────────────
//
// Verified live 2026-07-20: without this the borrowed assistant answers YES when asked whether it
// holds a description of the user, and quotes it back. Three sources feed it — our own HUMAN.md,
// Claude Code's auto-memory, and the project's CLAUDE.md — so a judge reads the profile it is
// helping to write. These tests pin the flag onto both spawn paths.

test('the borrow is blank-slate — --safe-mode rides every runClaude attempt', () => {
  const bin = writeOneShotBin();
  const argvFile = join(dir, 'argv-clean.json');
  process.env.STRATLESS_USAGE = join(dir, 'usage-clean.json');
  process.env.FAKE_ARGV = argvFile;
  process.env.FAKE_MODE = 'json';
  try {
    assert.equal(runClaude(bin, 'question', 'haiku', 'judge'), 'hi');
    const argv = JSON.parse(readFileSync(argvFile, 'utf8')) as string[];
    assert.ok(argv.includes('--safe-mode'), 'the JSON rung carries --safe-mode');
    assert.deepEqual([...CLEAN_ARGS], ['--safe-mode'], 'one constant governs every spawn');
    // It must precede --tools: --tools is variadic and swallows what follows it.
    assert.ok(argv.indexOf('--safe-mode') < argv.indexOf('--tools'), '--safe-mode is not swallowed by --tools');
  } finally {
    delete process.env.STRATLESS_USAGE;
    delete process.env.FAKE_ARGV;
    delete process.env.FAKE_MODE;
  }
});

test('the blank slate survives the fallback to the plain-text rung', () => {
  const bin = writeOneShotBin();
  const argvFile = join(dir, 'argv-clean-text.json');
  process.env.STRATLESS_USAGE = join(dir, 'usage-clean-text.json');
  process.env.FAKE_ARGV = argvFile;
  process.env.FAKE_MODE = 'text'; // no JSON — forces the second rung
  try {
    assert.equal(runClaude(bin, 'question', 'haiku', 'judge'), 'plain words, no receipt');
    const argv = JSON.parse(readFileSync(argvFile, 'utf8')) as string[];
    assert.ok(argv.includes('--safe-mode'), 'the degraded rung is blank-slate too — a cheaper call is not a dirtier one');
  } finally {
    delete process.env.STRATLESS_USAGE;
    delete process.env.FAKE_ARGV;
    delete process.env.FAKE_MODE;
  }
});

test('the streamed session is blank-slate too', async () => {
  const bin = writeStreamBin();
  const argvFile = join(dir, 'argv-stream-clean.json');
  process.env.STRATLESS_USAGE = join(dir, 'usage-stream-clean.json');
  process.env.FAKE_ARGV = argvFile;
  process.env.FAKE_COUNTER = join(dir, 'counter-clean');
  try {
    const r = await runStreamBatch(bin, { systemPrompt: 'rules', role: 'judge', feature: 'judge', items: streamItems(2) });
    assert.equal(r.completed, 2);
    const argv = JSON.parse(readFileSync(argvFile, 'utf8')) as string[];
    assert.ok(argv.includes('--safe-mode'), 'the stream child carries --safe-mode');
  } finally {
    delete process.env.STRATLESS_USAGE;
    delete process.env.FAKE_ARGV;
    delete process.env.FAKE_COUNTER;
  }
});

test('C9: the streamed session spawns tool-less too', async () => {
  const bin = writeStreamBin();
  const argvFile = join(dir, 'argv-stream.json');
  process.env.STRATLESS_USAGE = join(dir, 'usage-c9s.json');
  process.env.FAKE_ARGV = argvFile;
  process.env.FAKE_COUNTER = join(dir, 'counter-c9');
  try {
    const r = await runStreamBatch(bin, { systemPrompt: 'rules', role: 'judge', feature: 'judge', items: streamItems(2) });
    assert.equal(r.completed, 2);
    const argv = JSON.parse(readFileSync(argvFile, 'utf8')) as string[];
    const i = argv.indexOf('--tools');
    assert.ok(i >= 0 && argv[i + 1] === '', 'the stream child is tool-less');
  } finally {
    delete process.env.STRATLESS_USAGE;
    delete process.env.FAKE_ARGV;
    delete process.env.FAKE_COUNTER;
  }
});


// ── C11 — no unmetered call, no pin escape, unsaid ─────────────────────────────────────────────

test('C11: the ledger counts unmetered calls and pin escapes, per total and per feature', () => {
  const f = join(dir, 'usage-c11.json');
  recordUsage({ feature: 'synthesis', unmetered: true }, f);
  recordUsage({ feature: 'synthesis', unmetered: true, pinEscaped: true }, f);
  recordUsage({ feature: 'judge', costUsd: 0.01, inputTokens: 5 }, f);
  const u = readUsage(f);
  assert.equal(u.calls, 3, 'unmetered calls still COUNT as calls');
  assert.equal(u.unmeteredCalls, 2);
  assert.equal(u.pinEscapedCalls, 1);
  assert.equal(u.byFeature.synthesis.unmeteredCalls, 2, 'the feature bucket knows too');
  assert.equal(u.byFeature.judge.unmeteredCalls, 0);
});

test('C11: the plain-text rung records an UNMETERED call, never a confident zero-cost one (B3)', () => {
  const bin = writeOneShotBin();
  const usageFile = join(dir, 'usage-c11-text.json');
  process.env.STRATLESS_USAGE = usageFile;
  process.env.FAKE_MODE = 'text';
  try {
    const out = runClaude(bin, 'question', 'sonnet', 'synthesis');
    assert.equal(out, 'plain words, no receipt', 'the degraded answer still comes back');
    const u = readUsage(usageFile);
    assert.equal(u.calls, 1);
    assert.equal(u.unmeteredCalls, 1, 'the meter admits it cannot see this call');
    assert.equal(u.pinEscapedCalls, 0, 'the pin held — the plain rung was still --model sonnet');
    assert.equal(u.byFeature.synthesis.unmeteredCalls, 1);
  } finally {
    delete process.env.STRATLESS_USAGE;
    delete process.env.FAKE_MODE;
  }
});

test('the pin is absolute: a call that cannot run on its model REFUSES, never escapes (Sun 2026-07-18)', () => {
  const bin = writeOneShotBin();
  const usageFile = join(dir, 'usage-pin-absolute.json');
  process.env.STRATLESS_USAGE = usageFile;
  process.env.FAKE_MODE = 'nopin-json'; // every --model attempt dies; the ONLY answer is on the default
  try {
    const out = runClaude(bin, 'question', 'sonnet', 'synthesis');
    assert.equal(out, undefined, 'refuse rather than silently run on the account default (e.g. Opus)');
    const u = readUsage(usageFile);
    assert.equal(u.pinEscapedCalls, 0, 'no escape happened — there is no escape rung anymore');
    assert.equal(u.byModel['claude-test-default'], undefined, 'the default model was never run');
  } finally {
    delete process.env.STRATLESS_USAGE;
    delete process.env.FAKE_MODE;
  }
});

// ── The review fixes (2026-07-17): each verified finding pinned so it can't return ─────────────

test('review: an is_error envelope is a refusal — parseJsonResult never returns error prose', () => {
  // Verified live: a failed model pin exits 0 with is_error:true and subtype STILL 'success'.
  const envelope = JSON.stringify({
    result: "There's an issue with the selected model (haiku).",
    is_error: true,
    subtype: 'success',
    total_cost_usd: 0.0001,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  assert.equal(parseJsonResult(envelope), undefined, 'error prose must never become an answer');
  const ok = JSON.stringify({ result: 'real answer', is_error: false, usage: {} });
  assert.equal(parseJsonResult(ok)?.result, 'real answer', 'a healthy envelope still parses');
});

test('a broken model pin REFUSES and never returns error prose (envelope on both rungs)', () => {
  const bin = writeOneShotBin();
  const usageFile = join(dir, 'usage-envelope.json');
  process.env.STRATLESS_USAGE = usageFile;
  process.env.FAKE_MODE = 'error-envelope-pinned'; // both pinned rungs emit an is_error envelope
  try {
    const out = runClaude(bin, 'question', 'haiku', 'judge');
    assert.equal(out, undefined, 'no escape, no answer — the pin could not be honored');
    // The JSON rung refuses via parseJsonResult's is_error check; the plain rung refuses via
    // isErrorEnvelope — error prose never passes as a verdict on EITHER rung.
    const u = readUsage(usageFile);
    assert.equal(u.pinEscapedCalls, 0, 'the escape rung is gone');
  } finally {
    delete process.env.STRATLESS_USAGE;
    delete process.env.FAKE_MODE;
  }
});

test('review: atomic writes follow symlinks — the file stays the person\'s file', () => {
  const real = join(dir, 'dotfiles-repo-CLAUDE.md');
  const link = join(dir, 'CLAUDE.md');
  writeFileSync(real, 'original');
  chmodSync(real, 0o600); // the person's own chmod
  symlinkSync(real, link);
  atomicWriteFileSync(link, 'updated through the link');
  assert.ok(lstatSync(link).isSymbolicLink(), 'the symlink SURVIVES — rename would have severed it');
  assert.equal(readFileSync(real, 'utf8'), 'updated through the link', 'content landed in the real file');
  assert.equal(statSync(real).mode & 0o777, 0o600, 'and the mode the person chose is preserved');
});

test('review: a dangling symlink gets its target created — like write-through would', () => {
  const target = join(dir, 'not-yet', 'HUMAN.md');
  const link = join(dir, 'HUMAN.md');
  symlinkSync(target, link);
  atomicWriteFileSync(link, 'born through the link');
  assert.ok(lstatSync(link).isSymbolicLink(), 'the dangling link survives');
  assert.equal(readFileSync(target, 'utf8'), 'born through the link', 'the pointed-at file was created');
});

test('review: an empty lock file is a corpse — stolen, not respected (creation is link-atomic now)', () => {
  const lockFile = join(dir, 'corpse.lock');
  writeFileSync(lockFile, ''); // the old wx create-then-write could be observed like this; link cannot
  assert.equal(acquireLock(lockFile), true, 'the corpse is stolen');
  assert.equal(readLock(lockFile)?.pid, process.pid);
  releaseLock(lockFile);
});

test('review: spawnDetached with a missing binary returns undefined and never crashes', async () => {
  const pid = spawnDetached(join(dir, 'no-such-binary-xyz'), []);
  assert.equal(pid, undefined, 'no pid for a spawn that cannot happen');
  await sleep(50); // the ENOENT arrives as an ASYNC error event — unhandled it would kill this process
  assert.ok(true, 'still alive after the error event fired');
});

test('review: a hard-down claude is bounded — zero-progress transient retries cap at 2', async () => {
  const bin = writeStreamBin();
  const usageFile = join(dir, 'usage-harddown.json');
  process.env.STRATLESS_USAGE = usageFile;
  process.env.STRATLESS_BACKOFF_BASE_MS = '5';
  process.env.FAKE_COUNTER = join(dir, 'counter-harddown');
  process.env.FAKE_FAIL_AT = '1,2,3,4,5,6,7,8,9,10'; // every turn dies transient — nothing ever completes
  process.env.FAKE_FAIL_MODE = 'transient-exit';
  try {
    const r = await runStreamBatch(bin, { systemPrompt: 'rules', role: 'judge', feature: 'judge', items: streamItems(4) });
    assert.equal(r.completed, 0);
    assert.equal(r.remaining.length, 4, 'everything falls to the per-call ladder');
    assert.ok(r.retries <= 2, `bounded fast (${r.retries} retries) — the fail-fast promise survives the backoff rung`);
    assert.ok(readUsage(usageFile).unmeteredCalls >= 1, 'the dead sessions that booted are on the meter as unmetered (C11)');
  } finally {
    delete process.env.STRATLESS_USAGE;
    delete process.env.STRATLESS_BACKOFF_BASE_MS;
    delete process.env.FAKE_COUNTER;
    delete process.env.FAKE_FAIL_AT;
    delete process.env.FAKE_FAIL_MODE;
  }
});

test('review: an empty answer is not a completed turn — its wall-clock stays out of the rates', async () => {
  const bin = writeStreamBin();
  process.env.STRATLESS_USAGE = join(dir, 'usage-empty.json');
  process.env.FAKE_COUNTER = join(dir, 'counter-empty');
  process.env.FAKE_FAIL_AT = '2';
  process.env.FAKE_FAIL_MODE = 'empty-result';
  try {
    const r = await runStreamBatch(bin, { systemPrompt: 'rules', role: 'judge', feature: 'judge', items: streamItems(3) });
    assert.equal(r.turnsMs.length, r.completed, 'one timing sample per COMPLETED turn, exactly');
    assert.ok(!r.results.has('it-2'), 'the empty answer was not recorded as a verdict');
  } finally {
    delete process.env.STRATLESS_USAGE;
    delete process.env.FAKE_COUNTER;
    delete process.env.FAKE_FAIL_AT;
    delete process.env.FAKE_FAIL_MODE;
  }
});
