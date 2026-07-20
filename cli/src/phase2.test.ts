/**
 * PHASE 2 TESTS — the worker (cold-start build, spec §12 Phase 2).
 *
 * C1 flat memory · C3 kill-safe progress · C7 stop is total · wake semantics (N doorbells, one
 * worker) — plus the 0.3.5 riders: strict flag parsing and the artifact-shape lint. The worker is
 * tested as a REAL detached process driven through dist/index.js with a fixture HOME, exactly the
 * way the hook runs it.
 */
import { strict as assert } from 'node:assert';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';

import { iterateExchangesNewestFirst } from './exchange.js';
import { stopWorker, readLock } from './worker.js';
import { readProgress } from './progress.js';
import { readUsage, diffUsage } from './usage.js';

let dir: string;
const distDir = dirname(fileURLToPath(import.meta.url));
const cli = join(distDir, 'index.js');

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'stratless-phase2-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** One synthetic transcript: `exchanges` (prompt → answer → reaction) pairs, minute-spaced.
 *  `seed` makes every file's content distinct — the iterator dedupes by content hash, so an
 *  archive of forty identical conversations would (correctly) collapse to one. */
function transcript(exchanges: number, startTs: number, fat: number, seed: string): string {
  const ts = (i: number) => new Date(startTs + i * 60_000).toISOString();
  const lines: string[] = [
    JSON.stringify({ type: 'user', message: { content: `prompt ${seed}-0 ${'p'.repeat(fat)}` }, timestamp: ts(0) }),
  ];
  for (let i = 0; i < exchanges; i++) {
    lines.push(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: `answer ${seed}-${i} ${'a'.repeat(fat)}` }] },
        timestamp: ts(i * 2 + 1),
      }),
    );
    lines.push(
      JSON.stringify({ type: 'user', message: { content: `reaction ${seed}-${i} ${'r'.repeat(fat)}` }, timestamp: ts(i * 2 + 2) }),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** A fixture HOME with a projects dir of synthetic transcripts + every store path, as env. */
function makeHome(name: string, files: { exchanges: number; fat?: number }[]): { home: string; env: Record<string, string> } {
  const home = join(dir, name);
  const proj = join(home, '.claude', 'projects', 'proj');
  mkdirSync(proj, { recursive: true });
  const base = Date.parse('2026-07-01T00:00:00Z');
  files.forEach((f, i) => {
    writeFileSync(
      join(proj, `session-${String(i).padStart(3, '0')}.jsonl`),
      transcript(f.exchanges, base + i * 86_400_000, f.fat ?? 60, `${name}-${i}`),
    );
  });
  const st = join(home, '.stratless');
  mkdirSync(st, { recursive: true });
  const env: Record<string, string> = {
    HOME: home,
    STRATLESS_CACHE: join(st, 'judgments.json'),
    STRATLESS_STATE: join(st, 'state.json'),
    STRATLESS_USAGE: join(st, 'usage.json'),
    STRATLESS_PATTERNS: join(st, 'patterns.json'),
    STRATLESS_LOCK: join(st, 'lock'),
    STRATLESS_PROGRESS: join(st, 'progress.json'),
    STRATLESS_RENDERS: join(st, 'renders.json'),
    STRATLESS_BUILD: join(st, 'build.json'),
    STRATLESS_HUMAN_MD: join(home, '.claude', 'HUMAN.md'),
    STRATLESS_CLAUDE_MD: join(home, '.claude', 'CLAUDE.md'),
  };
  return { home, env };
}

/** The counting fake claude: streamed turns answer after `delayMs`, each bumping a counter file. */
function writeCountingBin(name: string, delayMs: number): string {
  const p = join(dir, name);
  writeFileSync(
    p,
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('stream-json')) {
  let buf = '';
  process.stdin.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let n = 0;
      try { n = Number(fs.readFileSync(process.env.FAKE_COUNTER, 'utf8')) || 0; } catch {}
      fs.writeFileSync(process.env.FAKE_COUNTER, String(n + 1));
      setTimeout(() => {
        process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: '{"verdict":"transferred","topic":"t","behavior":"b"}', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0.0001 }) + '\\n');
      }, ${delayMs});
    }
  });
  process.stdin.on('end', () => setTimeout(() => process.exit(0), ${delayMs} + 100));
} else {
  process.stdout.write(JSON.stringify({ result: 'WHAT THEY KNOW\\nSteady, verified, concrete. Flat text for the smoke profile.', is_error: false, total_cost_usd: 0.0001, usage: { input_tokens: 1, output_tokens: 1 } }));
}
`,
  );
  chmodSync(p, 0o755);
  return p;
}

const terminal = (env: Record<string, string>): string | undefined => {
  const p = readProgress(env.STRATLESS_PROGRESS);
  return p && ['done', 'failed', 'stopped'].includes(p.phase) ? p.phase : undefined;
};

async function waitTerminal(env: Record<string, string>, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const t = terminal(env);
    if (t) return t;
    await sleep(150);
  }
  return 'timeout';
}

// ── C1 — flat memory: 10,000 fat exchanges walk through a bounded process ──────────────────────

test('C1: the newest-first walk holds one file at a time — RSS flat over a 10k-exchange archive', async () => {
  const { home } = makeHome(
    'c1-home',
    Array.from({ length: 40 }, () => ({ exchanges: 250, fat: 2400 })),
  );
  const roots = join(home, '.claude', 'projects');
  const script = join(dir, 'c1-walk.mjs');
  writeFileSync(
    script,
    [
      `import { iterateExchangesNewestFirst } from '${new URL(`file://${join(distDir, 'exchange.js')}`).href}';`,
      `let n = 0, peak = 0, firstSession = '';`,
      `for (const e of iterateExchangesNewestFirst([process.argv[2]])) {`,
      `  if (!firstSession) firstSession = e.session;`,
      `  n++;`,
      `  if (n % 500 === 0) globalThis.gc?.();`,
      `  const rss = process.memoryUsage().rss;`,
      `  if (rss > peak) peak = rss;`,
      `}`,
      `console.log(JSON.stringify({ n, peak, firstSession }));`,
    ].join('\n'),
  );
  const out = execFileSync(process.execPath, ['--expose-gc', script, roots], { encoding: 'utf8', timeout: 60_000 });
  const r = JSON.parse(out.trim()) as { n: number; peak: number; firstSession: string };
  // 40 sessions × 250 closed turns, PLUS one session opener each: the first human message of a
  // transcript is now an exchange in its own right, so every session yields exactly one more.
  assert.equal(r.n, 40 * 251, 'every exchange yielded exactly once');
  assert.equal(r.firstSession, 'session-039', 'newest file walks first');
  // ~72MB of corpus text: loading it all would balloon well past this; one-file-at-a-time stays flat.
  assert.ok(r.peak < 130 * 1024 * 1024, `peak RSS ${(r.peak / 1e6).toFixed(0)}MB stays under the flat-memory bound`);
});

// ── C3 — kill-safe progress: two SIGKILLs, then completion, with bounded re-spend ─────────────

test('C3: kill the worker twice mid-run — resume re-spends at most one chunk per death', { skip: "stage 0: the worker finishes instantly with no pipeline behind it, so there is nothing to kill mid-run. The plumbing under test is untouched — un-skip when assign lands in stage 2." }, async () => {
  const { env } = makeHome('c3-home', [{ exchanges: 36 }]);
  const bin = writeCountingBin('counting-claude-c3', 60);
  const counter = join(dir, 'counter-c3');
  const childEnv = { ...process.env, ...env, STRATLESS_CLAUDE_BIN: bin, FAKE_COUNTER: counter, STRATLESS_JUDGE_LIMIT: '36' };

  for (let round = 0; round < 2; round++) {
    const w = spawn(process.execPath, [cli, '__worker', '--now'], { env: childEnv, stdio: 'ignore' });
    await sleep(900 + round * 400); // land the kill at different depths
    w.kill('SIGKILL');
    await new Promise((r) => w.on('close', r));
  }
  const done = spawn(process.execPath, [cli, '__worker', '--now'], { env: childEnv, stdio: 'ignore' });
  await new Promise((r) => done.on('close', r));
  assert.equal(await waitTerminal(env, 2000), 'done', 'the final run completes');

  const judged = Object.keys(JSON.parse(readFileSync(env.STRATLESS_CACHE, 'utf8'))).length;
  assert.equal(judged, 36, 'every exchange judged exactly once in the cache');
  const calls = Number(readFileSync(counter, 'utf8'));
  assert.ok(calls >= 36, `at least one call per exchange (${calls})`);
  assert.ok(calls <= 36 + 2 * 12, `two SIGKILLs cost at most one 12-turn chunk each (${calls} calls for 36 exchanges)`);
});

// ── C7 — stop is total: a busy worker dies within grace, labeled, nothing respawns ─────────────

test('C7: stopWorker kills a busy worker within grace, cleans the lock, labels the run', { skip: "stage 0: the worker finishes instantly with no pipeline behind it, so there is nothing to kill mid-run. The plumbing under test is untouched — un-skip when assign lands in stage 2." }, async () => {
  const { env } = makeHome('c7-home', [{ exchanges: 40 }]);
  const bin = writeCountingBin('counting-claude-c7', 500);
  const childEnv = { ...process.env, ...env, STRATLESS_CLAUDE_BIN: bin, FAKE_COUNTER: join(dir, 'counter-c7'), STRATLESS_JUDGE_LIMIT: '40' };
  const w = spawn(process.execPath, [cli, '__worker', '--now'], { env: childEnv, stdio: 'ignore' });
  // wait for the worker to take the lock and start
  const lockDeadline = Date.now() + 5000;
  while (Date.now() < lockDeadline && !readLock(env.STRATLESS_LOCK)) await sleep(100);
  assert.ok(readLock(env.STRATLESS_LOCK), 'the worker took the lock');

  process.env.STRATLESS_LOCK = env.STRATLESS_LOCK;
  process.env.STRATLESS_PROGRESS = env.STRATLESS_PROGRESS;
  try {
    const t0 = Date.now();
    const res = await stopWorker(3000);
    assert.equal(res.killed, true, 'a worker was there to kill');
    assert.ok(Date.now() - t0 < 4500, 'dead within the grace window');
    assert.equal(readLock(env.STRATLESS_LOCK), undefined, 'the lock is cleaned');
    const p = readProgress(env.STRATLESS_PROGRESS);
    assert.equal(p?.phase, 'stopped', 'the run is labeled');
    assert.ok(p?.summary?.[0].includes('stopped by you'), 'in the person\'s terms');
    await sleep(800);
    assert.equal(readLock(env.STRATLESS_LOCK), undefined, 'nothing respawns until a human acts');
  } finally {
    delete process.env.STRATLESS_LOCK;
    delete process.env.STRATLESS_PROGRESS;
    w.kill('SIGKILL');
  }
});

// ── Wake semantics — five doorbells, one worker, zero double-spend ─────────────────────────────

test('wake: five simultaneous updates ring one worker; every doorbell returns fast', { skip: "stage 0: the worker finishes instantly with no pipeline behind it, so there is nothing to kill mid-run. The plumbing under test is untouched — un-skip when assign lands in stage 2." }, async () => {
  const { env } = makeHome('wake-home', [{ exchanges: 24 }]);
  const bin = writeCountingBin('counting-claude-wake', 80);
  const counter = join(dir, 'counter-wake');
  const childEnv = { ...process.env, ...env, STRATLESS_CLAUDE_BIN: bin, FAKE_COUNTER: counter, STRATLESS_JUDGE_LIMIT: '24' };

  const t0 = Date.now();
  const rings = await Promise.all(
    Array.from({ length: 5 }, () =>
      new Promise<string>((resolve) => {
        execFile(process.execPath, [cli, 'update', '--now'], { env: childEnv, timeout: 15_000 }, (_e, stdout) => resolve(stdout));
      }),
    ),
  );
  const rang = Date.now() - t0;
  assert.ok(rang < 10_000, `doorbells return without doing the work themselves (${rang}ms)`);
  for (const out of rings) assert.ok(/background/.test(out), 'each doorbell says where the work went');

  assert.equal(await waitTerminal(env, 30_000), 'done', 'the one worker finishes');
  const calls = Number(readFileSync(counter, 'utf8'));
  assert.ok(calls <= 24 + 12, `no parallel double-judging (${calls} calls for 24 exchanges)`);
  assert.equal(Object.keys(JSON.parse(readFileSync(env.STRATLESS_CACHE, 'utf8'))).length, 24, 'the cache holds each exchange once');
});

// ── Strict args (0.3.5 rider): a typo is a refusal, never a different request ──────────────────

test('strict args: unknown flags refuse loudly with a did-you-mean; clean args still pass', () => {
  const run = (args: string[]): { code: number; out: string } => {
    try {
      const out = execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
      return { code: 0, out };
    } catch (err: any) {
      return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };
  const typo = run(['update', '--npw']);
  assert.equal(typo.code, 1, 'the typo refuses');
  assert.ok(typo.out.includes('unknown flag'), 'and says why');
  assert.ok(typo.out.includes('--now'), 'with the did-you-mean');
  const stray = run(['stats', 'extra']);
  assert.equal(stray.code, 1, 'a stray argument refuses too');
  assert.ok(stray.out.includes('unexpected argument'));
  const clean = run(['--version']);
  assert.equal(clean.code, 0, 'clean commands still run');
  assert.ok(clean.out.includes('stratless'));
  // `profile --now` retired: intercepted with a nudge, never a hard error, never a rebuild.
  const profileNow = run(['profile', '--now']);
  assert.equal(profileNow.code, 0, 'profile --now is intercepted, not a hard error');
  assert.ok(/update --now/.test(profileNow.out), 'and points at update --now — profile only looks');
});

// ── report folded into `profile --read`: lazy, over the profile's FROZEN corpus ────────────────
// The bug this kills: `report` used to build separately and describe a DIFFERENT window than the
// loaded profile. Now the read renders over the exact evidence the profile saw, only when asked,
// and never re-judges a new exchange.

// The fold's whole promise is "never a different corpus than the loaded profile". These pin the two
// ways the frozen corpus can fail to belong to the loaded profile — both must REFUSE, never render.
// ── The artifact-shape lint (C9's second half): chatter never loads again ──────────────────────

// ── The Phase 2 review fixes (2026-07-18): each verified finding pinned ────────────────────────

test('review: stopWorker never kills an unverified holder — a recycled PID is not a worker', { skip: "stage 0: the worker finishes instantly with no pipeline behind it, so there is nothing to kill mid-run. The plumbing under test is untouched — un-skip when assign lands in stage 2." }, async () => {
  const lockFile = join(dir, 'unverified.lock');
  const innocent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], { stdio: 'ignore' });
  await sleep(80);
  try {
    // A crash leftover: lock says "worker", but its startedAt is months before this process began.
    writeFileSync(lockFile, `${JSON.stringify({ pid: innocent.pid, startedAt: '2026-01-01T00:00:00Z', kind: 'worker' })}\n`);
    process.env.STRATLESS_LOCK = lockFile;
    process.env.STRATLESS_PROGRESS = join(dir, 'unverified-progress.json');
    const res = await stopWorker(500);
    assert.equal(res.killed, false, 'the kill is refused');
    assert.equal(res.unverified, true, 'and says why');
    assert.equal(innocent.exitCode, null, 'the innocent process is untouched');
  } finally {
    delete process.env.STRATLESS_LOCK;
    delete process.env.STRATLESS_PROGRESS;
    innocent.kill('SIGKILL');
  }
});

test('review: update respects a foreground COMMAND lock — no tail, no spawn, honest message', { skip: "stage 0: the worker finishes instantly with no pipeline behind it, so there is nothing to kill mid-run. The plumbing under test is untouched — un-skip when assign lands in stage 2." }, async () => {
  const { env } = makeHome('cmdlock-home', [{ exchanges: 4 }]);
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 6000)'], { stdio: 'ignore' });
  await sleep(80);
  try {
    writeFileSync(env.STRATLESS_LOCK, `${JSON.stringify({ pid: holder.pid, startedAt: new Date().toISOString(), kind: 'command' })}\n`);
    // Pin a bin that EXISTS (never invoked — update refuses at the lock) so this test does not
    // secretly depend on the machine having a real `claude` on PATH. CI caught exactly that.
    const out = await new Promise<string>((resolve) => {
      execFile(
        process.execPath,
        [cli, 'update'],
        { env: { ...process.env, ...env, STRATLESS_CLAUDE_BIN: process.execPath }, timeout: 15_000 },
        (_e, stdout) => resolve(stdout),
      );
    });
    assert.ok(out.includes('another stratless command is running'), 'the command holder is named, not tailed');
    assert.equal(readProgress(env.STRATLESS_PROGRESS), undefined, 'and no worker was spawned over it');
  } finally {
    holder.kill('SIGKILL');
  }
});

test('review: init goes through the strict-args gate too', () => {
  try {
    execFileSync(process.execPath, [cli, 'init', '--autoo'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
    assert.fail('should have refused');
  } catch (err: any) {
    assert.equal(err.status, 1);
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    assert.ok(out.includes('unknown flag'), 'the typo refuses before init runs');
    assert.ok(out.includes('--auto'), 'with the did-you-mean');
  }
});

test('a mistyped command suggests the nearest one (0.3.5 did-you-mean, commands too)', () => {
  const run = (args: string[]): { code: number; out: string } => {
    try {
      const out = execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
      return { code: 0, out };
    } catch (err: any) {
      return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };
  const typo = run(['updat']);
  assert.equal(typo.code, 1, 'the mistyped command refuses');
  assert.ok(typo.out.includes('unknown command'), 'and says so');
  assert.ok(typo.out.includes('did you mean update'), 'with the nearest verb');
  const far = run(['xyzzy']);
  assert.equal(far.code, 1);
  assert.ok(!far.out.includes('did you mean'), 'gibberish gets no false suggestion');
});

// ── The per-run receipt (0.3.5): announced, spent, accounted ───────────────────────────────────

test('receipt: diffUsage isolates one run\'s spend, including per-model ground truth', () => {
  const before = readUsage(join(dir, 'nonexistent-usage.json'));
  const t = (calls: number, cost: number, tok: number) => ({
    calls, costUsd: cost, inputTokens: tok, outputTokens: tok, cacheCreationTokens: 0, cacheReadTokens: tok * 10,
    unmeteredCalls: 0, pinEscapedCalls: 0,
  });
  const after = { ...t(34, 0.21, 900), byFeature: {}, byModel: { 'claude-haiku-4-5': t(31, 0.11, 700), 'claude-sonnet-5': t(3, 0.1, 200) } };
  const d = diffUsage(before, after);
  assert.equal(d.calls, 34);
  assert.ok(Math.abs(d.costUsd - 0.21) < 1e-9);
  assert.equal(d.byModel['claude-haiku-4-5'].calls, 31, 'the models that ran, by their real names');
  assert.equal(d.byModel['claude-sonnet-5'].calls, 3);
  const later = { ...after, ...t(35, 0.22, 910), byFeature: {}, byModel: { ...after.byModel, 'claude-haiku-4-5': t(32, 0.12, 710) } };
  const d2 = diffUsage(after, later);
  assert.equal(d2.calls, 1, 'a second snapshot isolates only the new spend');
  assert.equal(d2.byModel['claude-haiku-4-5'].calls, 1);
  assert.equal(d2.byModel['claude-sonnet-5'], undefined, 'models that spent nothing stay off the receipt');
});

test('receipt: a finished run carries its spend line; status can read it after the fact', { skip: "stage 0: nothing spends yet, so a finished run carries no receipt. The receipt plumbing is untouched — un-skip when assign lands in stage 2." }, async () => {
  const { env } = makeHome('receipt-home', [{ exchanges: 6 }]);
  const bin = writeCountingBin('counting-claude-receipt', 20);
  const childEnv = { ...process.env, ...env, STRATLESS_CLAUDE_BIN: bin, FAKE_COUNTER: join(dir, 'counter-receipt'), STRATLESS_JUDGE_LIMIT: '6' };
  const w = spawn(process.execPath, [cli, '__worker', '--now'], { env: childEnv, stdio: 'ignore' });
  await new Promise((r) => w.on('close', r));
  assert.equal(await waitTerminal(env, 3000), 'done');
  const p = readProgress(env.STRATLESS_PROGRESS)!;
  assert.ok(p.spend, 'the run carries its receipt');
  assert.ok(/this run: .*tokens/.test(p.spend!), `tokens first (${p.spend})`);
  assert.ok(/\$\d/.test(p.spend!), 'with the API-equivalent cost');
  assert.ok(p.summary!.some((l) => l === p.spend), 'and the tail prints it with the summary');
});
