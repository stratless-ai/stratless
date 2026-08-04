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
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';

import { stopWorker, readLock, processCommand } from '../runner/worker.js';
import { readProgress } from '../runner/progress.js';
import { readUsage, diffUsage } from '../runner/usage.js';
import { loadCategories } from '../pipeline/categories.js';
import { loadAssignments } from '../pipeline/assign.js';
import { loadMoments } from '../pipeline/moments.js';
import { requestColdBuild, coldBuildRequested, recordGrowthConsent, readState, writeState } from '../runner/state.js';
import { loadEngine } from '../pipeline/engine.js';
import { isYes } from '../index.js';

let dir: string;
const PS_UNAVAILABLE = processCommand(process.pid) === undefined;
const distDir = dirname(fileURLToPath(import.meta.url));
const cli = join(distDir, '..', 'index.js');

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
    STRATLESS_STATE: join(st, 'state.json'),
    STRATLESS_USAGE: join(st, 'usage.json'),
    STRATLESS_PATTERNS: join(st, 'patterns.json'),
    STRATLESS_LOCK: join(st, 'lock'),
    STRATLESS_PROGRESS: join(st, 'progress.json'),
    STRATLESS_RENDERS: join(st, 'renders.json'),
    STRATLESS_BUILD: join(st, 'build.json'),
    STRATLESS_MOMENTS: join(st, 'moments.jsonl'),
    STRATLESS_RECORDS_DIR: join(st, 'records'),
    STRATLESS_PROFILE_DIR: st,
    STRATLESS_CATEGORIES: join(st, 'records', 'claude-code', 'categories.jsonl'),
    STRATLESS_ASSIGNMENTS: join(st, 'records', 'claude-code', 'assignments.jsonl'),
    STRATLESS_HUMAN_MD: join(home, '.claude', 'HUMAN.md'),
    STRATLESS_CLAUDE_MD: join(home, '.claude', 'CLAUDE.md'),
  };
  return { home, env };
}

/**
 * A fake `claude` that answers the cold build's naming call. v2 called a model once per batch of
 * moments; v3 names every pile in one call, so the delay here makes that stage long enough to
 * interrupt. A completed first build also asks once to voice its new rows; that call receives the
 * same valid envelope, records its receipt, and intentionally yields no picks.
 */
function writeNameBin(name: string, delayMs: number): string {
  const p = join(dir, name);
  writeFileSync(
    p,
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const input = args.find((a) => a.includes('PILE ')) || '';
try { const n = Number(fs.readFileSync(process.env.FAKE_COUNTER, 'utf8')) || 0; fs.writeFileSync(process.env.FAKE_COUNTER, String(n + 1)); } catch {}
if (${delayMs}) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${delayMs});
const ids = [...input.matchAll(/### PILE (\\d+)/g)].map((m) => Number(m[1]));
const groups = ids.map((id) => ({ name: 'pattern-' + id, description: 'does thing ' + id, quote: 'go', pile: id }));
process.stdout.write(JSON.stringify({ result: JSON.stringify({ groups }), is_error: false, total_cost_usd: 0.0001, usage: { input_tokens: 1, output_tokens: 1 } }));
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
      `import { iterateExchangesNewestFirst } from '${new URL(`file://${join(distDir, '..', 'pipeline', 'exchange.js')}`).href}';`,
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

test('C3: kill the worker twice mid-build — nothing half-written, and the next run completes', async () => {
  // v2 assigned in batches, so kill-safety meant "re-spend at most one batch". v3 makes ONE call and
  // `freeze()` writes categories, assignments and the frozen model TOGETHER at the end — so the
  // guarantee is stronger and simpler: an interrupted build leaves the stores untouched, and the
  // next run starts clean rather than reading a half-built model as if it were whole.
  // SIX conversations: a pattern must span three, so a single-session fixture can never build.
  const { env } = makeHome('c3-home', Array.from({ length: 6 }, () => ({ exchanges: 8 })));
  const bin = writeNameBin('name-claude-c3', 400); // the naming call is the whole paid stage
  const counter = join(dir, 'counter-c3');
  writeFileSync(counter, '0');
  const childEnv = {
    ...process.env, ...env, STRATLESS_CLAUDE_BIN: bin, FAKE_COUNTER: counter,
    STRATLESS_FAKE_EMBED: '1', STRATLESS_FLUSH: '1',
  };

  for (let round = 0; round < 2; round++) {
    const w = spawn(process.execPath, [cli, '__worker'], { env: childEnv, stdio: 'ignore' });
    const closed = new Promise((r) => w.on('close', r)); // armed BEFORE the kill — a fast exit races otherwise
    await sleep(250 + round * 200); // land the kill at different depths
    w.kill('SIGKILL');
    await closed;
  }
  const done = spawn(process.execPath, [cli, '__worker'], { env: childEnv, stdio: 'ignore' });
  await new Promise((r) => done.on('close', r));
  assert.equal(await waitTerminal(env, 8000), 'done', 'the final run completes');

  const moments = loadMoments(env.STRATLESS_MOMENTS);
  const rows = loadAssignments('claude-code', env.STRATLESS_ASSIGNMENTS);
  assert.ok(moments.length > 0, 'the pile got built — collecting is free and survives every kill');
  assert.equal(rows.length, moments.length, 'every moment carries exactly one record');
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, 'no moment written twice');
});

// ── C7 — stop is total: a busy worker dies within grace, labeled, nothing respawns ─────────────

test('C7: stopWorker stops a busy worker within grace, cleans the lock, labels the run', { skip: PS_UNAVAILABLE ? '`ps` is unavailable in this sandbox' : false }, async () => {
  const { env } = makeHome('c7-home', Array.from({ length: 6 }, () => ({ exchanges: 8 })));
  const bin = writeNameBin('name-claude-c7', 3000); // the naming call holds the worker busy
  const counter = join(dir, 'counter-c7');
  writeFileSync(counter, '0');
  // NO seeded categories: we want the COLD path, which is the one that spends and can be interrupted.
  const childEnv = { ...process.env, ...env, STRATLESS_CLAUDE_BIN: bin, FAKE_COUNTER: counter, STRATLESS_FAKE_EMBED: '1', STRATLESS_FLUSH: '1' };
  const w = spawn(process.execPath, [cli, '__worker'], { env: childEnv, stdio: 'ignore' });
  // wait for the worker to take the lock, then let it get well into the build
  const lockDeadline = Date.now() + 5000;
  while (Date.now() < lockDeadline && !readLock(env.STRATLESS_LOCK)) await sleep(50);
  assert.ok(readLock(env.STRATLESS_LOCK), 'the worker took the lock');
  await sleep(400);

  process.env.STRATLESS_LOCK = env.STRATLESS_LOCK;
  process.env.STRATLESS_PROGRESS = env.STRATLESS_PROGRESS;
  try {
    const t0 = Date.now();
    const res = await stopWorker(3000);
    assert.equal(res.killed, true, 'a worker was there to stop');
    assert.ok(Date.now() - t0 < 4500, 'stopped within the grace window');
    assert.equal(readLock(env.STRATLESS_LOCK), undefined, 'the lock is cleaned');
    const p = readProgress(env.STRATLESS_PROGRESS);
    assert.equal(p?.phase, 'stopped', 'the run is labeled');
    assert.ok(p?.summary?.[0].includes('stopped by you'), "in the person's terms");
    await sleep(800);
    assert.equal(readLock(env.STRATLESS_LOCK), undefined, 'nothing respawns until a human acts');
  } finally {
    delete process.env.STRATLESS_LOCK;
    delete process.env.STRATLESS_PROGRESS;
    w.kill('SIGKILL');
  }
});

// ── Wake semantics — five doorbells, one worker, zero double-spend ─────────────────────────────

test('wake: five simultaneous updates ring one worker; every doorbell returns fast', async () => {
  const { env } = makeHome('wake-home', Array.from({ length: 6 }, () => ({ exchanges: 6 })));
  // `update` resolves `claude` again at the detach boundary, so put the fake under that exact name
  // first on PATH. Otherwise a developer with Claude Code installed could accidentally replace the
  // test pin with their real binary — the test must never spend a person's plan.
  const bin = writeNameBin('claude', 1500);
  const counter = join(dir, 'counter-wake');
  writeFileSync(counter, '0');
  requestColdBuild(env.STRATLESS_STATE);
  const childEnv = {
    ...process.env,
    ...env,
    PATH: `${dirname(bin)}${delimiter}${process.env.PATH ?? ''}`,
    STRATLESS_CLAUDE_BIN: bin,
    STRATLESS_FAKE_EMBED: '1',
    FAKE_COUNTER: counter,
  };

  const t0 = Date.now();
  const rings = await Promise.all(
    Array.from({ length: 5 }, () =>
      new Promise<string>((resolve) => {
        execFile(process.execPath, [cli, 'update'], { env: childEnv, timeout: 15_000 }, (_e, stdout) => resolve(stdout));
      }),
    ),
  );
  const rang = Date.now() - t0;
  assert.ok(rang < 10_000, `doorbells return without doing the work themselves (${rang}ms)`);
  for (const out of rings) assert.ok(/background/.test(out), 'each doorbell says where the work went');

  assert.equal(await waitTerminal(env, 30_000), 'done', 'the one worker finishes');
  const calls = Number(readFileSync(counter, 'utf8'));
  const usage = readUsage(env.STRATLESS_USAGE);
  assert.equal(calls, 2, 'one cold build made its two expected borrowed calls, with no duplicate worker spend');
  assert.equal(usage.byFeature.name?.calls, 1, 'the five doorbells still produce exactly one naming call');
  assert.equal(usage.byFeature.write?.calls, 1, 'the new generation is voiced once');
  const moments = loadMoments(env.STRATLESS_MOMENTS);
  const rows = loadAssignments('claude-code', env.STRATLESS_ASSIGNMENTS);
  assert.ok(loadCategories('claude-code', env.STRATLESS_CATEGORIES).length > 0, 'the one worker completed the cold build');
  assert.equal(rows.length, moments.length, 'every collected moment was assigned exactly once');
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, 'no worker duplicated an assignment');
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
  const typo = run(['status', '--chekc']);
  assert.equal(typo.code, 1, 'the typo refuses');
  assert.ok(typo.out.includes('unknown flag'), 'and says why');
  assert.ok(typo.out.includes('--check'), 'with the did-you-mean');
  const stray = run(['mirror', 'extra']);
  assert.equal(stray.code, 1, 'a stray argument refuses too');
  assert.ok(stray.out.includes('unexpected argument'));
  const selector = run(['profile', 'codex']);
  assert.equal(selector.code, 1, '`profile` has no hidden per-assistant selector');
  assert.ok(selector.out.includes('unexpected argument for profile: codex'));
  const clean = run(['--version']);
  assert.equal(clean.code, 0, 'clean commands still run');
  const packageVersion = JSON.parse(readFileSync(join(distDir, '..', '..', 'package.json'), 'utf8')).version;
  assert.equal(clean.out.trim(), `stratless ${packageVersion}`, 'the nested dist layout still resolves the package version');
});

test('Codex-only status is on after approval, and stop warns when later hook trust shifts', () => {
  const home = join(dir, 'codex-stop-warning');
  const codexHome = join(home, '.codex');
  const hooks = join(codexHome, 'hooks.json');
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(
    hooks,
    JSON.stringify({
      hooks: {
        SessionEnd: [
          { description: 'stratless', hooks: [{ type: 'command', command: 'stratless update >/dev/null 2>&1 &' }] },
        ],
      },
    }),
  );
  writeFileSync(join(codexHome, 'config.toml'), `[hooks.state."${hooks}:session_end:0:0"]\ntrusted_hash = "sha256:fixture"\n`);
  const childEnv = {
    ...process.env,
    HOME: home,
    CODEX_HOME: codexHome,
    STRATLESS_LOCK: join(home, '.stratless', 'lock'),
    STRATLESS_PROFILE_DIR: join(home, '.stratless'),
    STRATLESS_HUMAN_MD: join(home, '.stratless', 'HUMAN.md'),
    STRATLESS_CLAUDE_MD: join(home, '.claude', 'CLAUDE.md'),
  };

  const statusOut = execFileSync(process.execPath, [cli, 'status'], { encoding: 'utf8', env: childEnv });
  assert.match(statusOut, /after-session refresh\s+on/, 'Codex approval alone makes status report the refresh as on');

  const doc = JSON.parse(readFileSync(hooks, 'utf8'));
  doc.hooks.SessionEnd.push({ description: 'mine-later', hooks: [{ type: 'command', command: 'true' }] });
  writeFileSync(hooks, JSON.stringify(doc));
  const stopOut = execFileSync(process.execPath, [cli, 'stop'], { encoding: 'utf8', env: childEnv });
  assert.ok(stopOut.includes('Codex will ask you to re-approve 1 SessionEnd hook'), 'stop surfaces the positional-trust consequence');
  assert.deepEqual(
    JSON.parse(readFileSync(hooks, 'utf8')).hooks.SessionEnd.map((group: { description: string }) => group.description),
    ['mine-later'],
    "stop removes only stratless and preserves the person's later hook",
  );
});

// ── report folded into `profile --read`: lazy, over the profile's FROZEN corpus ────────────────
// The bug this kills: `report` used to build separately and describe a DIFFERENT window than the
// loaded profile. Now the read renders over the exact evidence the profile saw, only when asked,
// and never re-judges a new exchange.

// The fold's whole promise is "never a different corpus than the loaded profile". These pin the two
// ways the frozen corpus can fail to belong to the loaded profile — both must REFUSE, never render.
// ── The artifact-shape lint (C9's second half): chatter never loads again ──────────────────────

// ── The Phase 2 review fixes (2026-07-18): each verified finding pinned ────────────────────────

test('review: stopWorker never kills an unverified holder — a recycled PID is not a worker', async () => {
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

test('review: update respects a foreground COMMAND lock — no tail, no spawn, honest message', async () => {
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

test('review: init goes through the strict-args gate too (init takes no flags now)', () => {
  try {
    execFileSync(process.execPath, [cli, 'init', '--nope'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
    assert.fail('should have refused');
  } catch (err: any) {
    assert.equal(err.status, 1);
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    assert.ok(out.includes('unknown flag'), 'the unknown flag refuses before init runs');
    assert.ok(out.includes('init'), 'and names the command it was rejected for');
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

test('receipt: a finished run carries its spend line; status can read it after the fact', async () => {
  const { env } = makeHome('receipt-home', Array.from({ length: 6 }, () => ({ exchanges: 6 })));
  const bin = writeNameBin('name-claude-receipt', 20);
  const counter = join(dir, 'counter-receipt');
  writeFileSync(counter, '0');
  const childEnv = {
    ...process.env,
    ...env,
    STRATLESS_CLAUDE_BIN: bin,
    STRATLESS_FAKE_EMBED: '1',
    STRATLESS_FLUSH: '1',
    FAKE_COUNTER: counter,
  };
  const w = spawn(process.execPath, [cli, '__worker'], { env: childEnv, stdio: 'ignore' });
  await new Promise((r) => w.on('close', r));
  assert.equal(await waitTerminal(env, 3000), 'done');
  const p = readProgress(env.STRATLESS_PROGRESS)!;
  assert.ok(p.spend, 'the run carries its receipt');
  assert.equal(p.spend, 'this run: 4 tokens · < $0.01 at API rates', 'tokens first, with the honest sub-cent API-equivalent cost');
  assert.ok(p.summary!.some((l) => l === p.spend), 'and the tail prints it with the summary');
  const status = execFileSync(process.execPath, [cli, 'status'], {
    encoding: 'utf8',
    env: { ...childEnv, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(status, /last run\s+4 tokens · < \$0\.01 at API rates/, 'status carries the finished run forward');
});

// ── THE COLD-START SPEND GATE (0.4.0) ────────────────────────────────────────────────────────────
// A fresh machine has no categories. discover() (the paid stage) must fire ONLY on a consented,
// interactive invocation — marked by STRATLESS_FLUSH, set only from a real terminal. A background
// hook (no TTY, no STRATLESS_FLUSH) collects the pile for free and spends nothing.

/** A fake `claude` that answers the discover + assign + write calls (so a consented build completes)
 *  AND records every invocation to FAKE_COUNTER — so a test can assert it was NEVER called. */
/**
 * A fake `claude` for the consent-gate tests: it counts every invocation, and answers the naming call
 * the engine makes. The gate under test is "did the assistant get called at all", so the counter is
 * the assertion and the payload only has to be well-formed.
 */
function writeNameCounterBin(name: string): string {
  const p = join(dir, name);
  writeFileSync(
    p,
    `#!/usr/bin/env node
const fs = require('fs');
try { const n = Number(fs.readFileSync(process.env.FAKE_COUNTER, 'utf8')) || 0; fs.writeFileSync(process.env.FAKE_COUNTER, String(n + 1)); } catch { fs.writeFileSync(process.env.FAKE_COUNTER, '1'); }
const args = process.argv.slice(2);
const input = args.find((a) => a.includes('PILE ')) || '';
const ids = [...input.matchAll(/### PILE (\\d+)/g)].map((m) => Number(m[1]));
const groups = ids.length
  ? ids.map((id) => ({ name: 'pattern-' + id, description: 'does thing ' + id, quote: 'go', pile: id }))
  : [];
process.stdout.write(JSON.stringify({ result: JSON.stringify({ groups }), is_error: false, total_cost_usd: 0.0001, usage: { input_tokens: 1, output_tokens: 1 } }));
`,
  );
  chmodSync(p, 0o755);
  return p;
}

test('cold start is spend-gated: a background hook collects the pile but never builds', async () => {
  const { home, env } = makeHome('coldgate-hook', [{ exchanges: 4 }, { exchanges: 4 }, { exchanges: 4 }, { exchanges: 4 }]);
  const counter = join(home, 'calls');
  const bin = writeNameCounterBin('fake-cold-hook');
  // No STRATLESS_FLUSH — this is exactly how the after-session hook runs (non-TTY).
  const childEnv = { ...process.env, ...env, STRATLESS_CLAUDE_BIN: bin, FAKE_COUNTER: counter };
  const w = spawn(process.execPath, [cli, '__worker'], { env: childEnv, stdio: 'ignore' });
  await new Promise((r) => w.on('close', r));

  assert.ok(!existsSync(counter), 'the assistant was NEVER called — nothing was spent');
  assert.equal(loadCategories('claude-code', env.STRATLESS_CATEGORIES).length, 0, 'no categories minted on a hook run');
  assert.ok(loadMoments(env.STRATLESS_MOMENTS).length > 0, 'but the pile WAS collected, for free');
  const p = readProgress(env.STRATLESS_PROGRESS);
  assert.ok(p?.summary?.some((l) => l.includes('full build not run')), `and it says the build has not run (${JSON.stringify(p?.summary)})`);

  // status surfaces the pending build from that same state (pile present, no categories).
  const out = execFileSync(process.execPath, [cli, 'status'], { encoding: 'utf8', env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(out, /profile build/);
  assert.match(out, /not run yet/);
});

test('cold start builds when consented: a TTY invocation (STRATLESS_FLUSH) mints categories', async () => {
  const { home, env } = makeHome('coldgate-consent', Array.from({ length: 6 }, () => ({ exchanges: 6 })));
  const counter = join(home, 'calls');
  const bin = writeNameCounterBin('fake-cold-consent');
  const childEnv = { ...process.env, ...env, STRATLESS_CLAUDE_BIN: bin, FAKE_COUNTER: counter, STRATLESS_FAKE_EMBED: '1', STRATLESS_FLUSH: '1' };
  const w = spawn(process.execPath, [cli, '__worker'], { env: childEnv, stdio: 'ignore' });
  await new Promise((r) => w.on('close', r));

  assert.ok(existsSync(counter), 'the consented build DID call the assistant');
  assert.ok(loadCategories('claude-code', env.STRATLESS_CATEGORIES).length > 0, 'and minted at least one category');
});

test('a DURABLE consent flag makes even a non-TTY worker build — consent survives a lock race', async () => {
  const { home, env } = makeHome('coldgate-durable', Array.from({ length: 6 }, () => ({ exchanges: 6 })));
  const counter = join(home, 'calls');
  const bin = writeNameCounterBin('fake-cold-durable');
  // Consent recorded on disk (as the door / a typed `update` does), but NO STRATLESS_FLUSH in this
  // worker's env — exactly the case where a background hook worker won the lock after the user's yes.
  requestColdBuild(env.STRATLESS_STATE);
  const childEnv = { ...process.env, ...env, STRATLESS_CLAUDE_BIN: bin, FAKE_COUNTER: counter, STRATLESS_FAKE_EMBED: '1' }; // no STRATLESS_FLUSH
  const w = spawn(process.execPath, [cli, '__worker'], { env: childEnv, stdio: 'ignore' });
  await new Promise((r) => w.on('close', r));

  assert.ok(existsSync(counter), 'the durable consent triggered the build with no env flag');
  assert.ok(loadCategories('claude-code', env.STRATLESS_CATEGORIES).length > 0, 'categories minted');
  assert.equal(coldBuildRequested(env.STRATLESS_STATE), false, 'and the flag was consumed exactly once');
});

// ── THE YOUNG TRIGGER (0.11.0) ───────────────────────────────────────────────────────────────────
// A pair cold-built on thin history must not keep its day-one map forever. When the history could
// support double what it supported at build (engine.ts `outgrown`), the worker rebuilds — riding
// the STANDING growth consent, which only a flushing surface stamps. Three gates under test:
// standing consent lets a background worker take a YOUNG rebuild (and only a young one — the
// cold-start tests above stay the proof it cannot leak into first builds); no standing consent
// means announce-only; and no trigger means no spend, consent or not.

/** Grow a fixture HOME's history: `extra` more sessions appended after the first `already`. */
function addSessions(home: string, name: string, already: number, extra: number, exchanges = 6): void {
  const proj = join(home, '.claude', 'projects', 'proj');
  const base = Date.parse('2026-07-01T00:00:00Z');
  for (let i = 0; i < extra; i++) {
    const n = already + i;
    writeFileSync(join(proj, `session-${String(n).padStart(3, '0')}.jsonl`), transcript(exchanges, base + n * 86_400_000, 60, `${name}-late-${n}`));
  }
}

/** First consented build over the fixture, so the young tests start from a real frozen map. */
async function firstBuild(env: Record<string, string>, bin: string, counter: string): Promise<number> {
  const childEnv = { ...process.env, ...env, STRATLESS_CLAUDE_BIN: bin, FAKE_COUNTER: counter, STRATLESS_FAKE_EMBED: '1', STRATLESS_FLUSH: '1' };
  const w = spawn(process.execPath, [cli, '__worker'], { env: childEnv, stdio: 'ignore' });
  await new Promise((r) => w.on('close', r));
  assert.ok(loadCategories('claude-code', env.STRATLESS_CATEGORIES).length > 0, 'the first build minted the map');
  return Number(readFileSync(counter, 'utf8')) || 0;
}

test('young trigger: standing consent lets a background worker rebuild an outgrown map', async () => {
  const { home, env } = makeHome('young-standing', Array.from({ length: 9 }, () => ({ exchanges: 6 })));
  const counter = join(home, 'calls');
  const bin = writeNameCounterBin('fake-young-standing');
  const calls = await firstBuild(env, bin, counter);
  const built = loadEngine('claude-code', join(env.STRATLESS_RECORDS_DIR, 'claude-code', 'engine.json'));
  assert.equal(built?.sessionsAtBuild, 9, 'the base the trigger measures from');

  // The history doubles (9 → 18 conversations), and the standing consent is on disk — as a typed
  // `update` would have left it. The worker runs exactly as the hook does: no TTY, no env flag.
  // The flush cadence must be DUE for a background rebuild (the retry bound) — age the last flush
  // past the weekly default, as a real week of use would have.
  addSessions(home, 'young-standing', 9, 9);
  recordGrowthConsent(env.STRATLESS_STATE);
  writeState({ ...readState(env.STRATLESS_STATE), lastFlushAt: new Date(Date.now() - 8 * 86_400_000).toISOString() }, env.STRATLESS_STATE);
  const childEnv = { ...process.env, ...env, STRATLESS_CLAUDE_BIN: bin, FAKE_COUNTER: counter, STRATLESS_FAKE_EMBED: '1' }; // no STRATLESS_FLUSH
  const w = spawn(process.execPath, [cli, '__worker'], { env: childEnv, stdio: 'ignore' });
  await new Promise((r) => w.on('close', r));

  assert.ok(Number(readFileSync(counter, 'utf8')) > calls, 'the rebuild called the assistant');
  const after = loadEngine('claude-code', join(env.STRATLESS_RECORDS_DIR, 'claude-code', 'engine.json'));
  assert.equal(after?.sessionsAtBuild, 18, 'the map was re-frozen on the doubled history');
  const p = readProgress(env.STRATLESS_PROGRESS);
  assert.ok(p?.summary?.some((l) => l.includes('outgrew')), `and the rebuild announced its reason (${JSON.stringify(p?.summary)})`);
});

test('young trigger without standing consent: announce only, nothing spent', async () => {
  const { home, env } = makeHome('young-announce', Array.from({ length: 9 }, () => ({ exchanges: 6 })));
  const counter = join(home, 'calls');
  const bin = writeNameCounterBin('fake-young-announce');
  const calls = await firstBuild(env, bin, counter);

  addSessions(home, 'young-announce', 9, 9); // outgrown — but no growth consent was ever stamped
  const childEnv = { ...process.env, ...env, STRATLESS_CLAUDE_BIN: bin, FAKE_COUNTER: counter, STRATLESS_FAKE_EMBED: '1' };
  const w = spawn(process.execPath, [cli, '__worker'], { env: childEnv, stdio: 'ignore' });
  await new Promise((r) => w.on('close', r));

  assert.equal(Number(readFileSync(counter, 'utf8')), calls, 'the assistant was NEVER called');
  const after = loadEngine('claude-code', join(env.STRATLESS_RECORDS_DIR, 'claude-code', 'engine.json'));
  assert.equal(after?.sessionsAtBuild, 9, 'the map was not rebuilt');
  const p = readProgress(env.STRATLESS_PROGRESS);
  assert.ok(p?.summary?.some((l) => /outgrown its \d+-pattern map/.test(l)), `it announces and points at \`update\` (${JSON.stringify(p?.summary)})`);
});

test('young trigger rides the cadence: standing consent + trigger, but flush not due — no spend', async () => {
  // THE RETRY BOUND. A rebuild whose naming call fails leaves the trigger true and the consent
  // standing; without the cadence gate the worker would re-attempt the paid call on every wake.
  const { home, env } = makeHome('young-cadence', Array.from({ length: 9 }, () => ({ exchanges: 6 })));
  const counter = join(home, 'calls');
  const bin = writeNameCounterBin('fake-young-cadence');
  const calls = await firstBuild(env, bin, counter);

  addSessions(home, 'young-cadence', 9, 9); // outgrown, consent standing — but the flush just ran
  recordGrowthConsent(env.STRATLESS_STATE);
  const childEnv = { ...process.env, ...env, STRATLESS_CLAUDE_BIN: bin, FAKE_COUNTER: counter, STRATLESS_FAKE_EMBED: '1' };
  const w = spawn(process.execPath, [cli, '__worker'], { env: childEnv, stdio: 'ignore' });
  await new Promise((r) => w.on('close', r));

  assert.equal(Number(readFileSync(counter, 'utf8')), calls, 'no paid call before the cadence is due');
  const after = loadEngine('claude-code', join(env.STRATLESS_RECORDS_DIR, 'claude-code', 'engine.json'));
  assert.equal(after?.sessionsAtBuild, 9, 'the map waits for the next scheduled refresh');
  const p = readProgress(env.STRATLESS_PROGRESS);
  assert.ok(p?.summary?.some((l) => l.includes('next scheduled refresh')), `and says it is only waiting (${JSON.stringify(p?.summary)})`);
});

test('no trigger, no rebuild: standing consent alone never spends on a map that still fits', async () => {
  const { home, env } = makeHome('young-quiet', Array.from({ length: 9 }, () => ({ exchanges: 6 })));
  const counter = join(home, 'calls');
  const bin = writeNameCounterBin('fake-young-quiet');
  const calls = await firstBuild(env, bin, counter);

  addSessions(home, 'young-quiet', 9, 3); // 12 conversations support 4 — under both bars (6)
  recordGrowthConsent(env.STRATLESS_STATE); // consent IS standing; the trigger is what's absent
  const childEnv = { ...process.env, ...env, STRATLESS_CLAUDE_BIN: bin, FAKE_COUNTER: counter, STRATLESS_FAKE_EMBED: '1' };
  const w = spawn(process.execPath, [cli, '__worker'], { env: childEnv, stdio: 'ignore' });
  await new Promise((r) => w.on('close', r));

  assert.equal(Number(readFileSync(counter, 'utf8')), calls, 'nothing was spent');
  const after = loadEngine('claude-code', join(env.STRATLESS_RECORDS_DIR, 'claude-code', 'engine.json'));
  assert.equal(after?.sessionsAtBuild, 9, 'the frozen map is untouched');
});

test('isYes: only an explicit y/yes builds; everything else defers (the default-NO spend gate)', () => {
  for (const yes of ['y', 'Y', 'yes', 'YES', ' yes ', 'Yes']) assert.equal(isYes(yes), true, `"${yes}" builds`);
  for (const no of ['', ' ', 'n', 'no', 'nope', 'yeah', 'ya', 'yep', 'sure', 'ok', '1', 'yy']) assert.equal(isYes(no), false, `"${no}" defers`);
});

test('profile: reads HUMAN.md (the pipeline output), not the dead profile.txt, header stripped', () => {
  const human = join(dir, 'profile-HUMAN.md');
  writeFileSync(
    human,
    '# Who you are working with\n# (managed by stratless — do not edit)\n<!-- humanmd/v3 -->\n\nDerived from 12 conversations.\n\n## What to catch for me\n\n**Catch unverified numbers** — 99 times\n',
  );
  // ISOLATED HOME on purpose: `profile` reads the machine's pair files and detected adapters, so
  // inheriting the developer's real HOME makes the test's outcome depend on whether THEIR machine
  // has built — which is exactly what happened the night the first real pair files appeared.
  const isolatedHome = join(dir, 'profile-look-home');
  mkdirSync(join(isolatedHome, '.claude', 'projects', 'p'), { recursive: true });
  writeFileSync(join(isolatedHome, '.claude', 'projects', 'p', 's.jsonl'), '{}\n');
  const env = {
    ...process.env,
    HOME: isolatedHome,
    STRATLESS_PROFILE_DIR: join(dir, 'profile-look-profiles'),
    STRATLESS_HUMAN_MD: human,
    STRATLESS_RENDERS: join(dir, 'profile-renders.json'),
    STRATLESS_CLAUDE_MD: join(dir, 'profile-CLAUDE.md'),
  };
  const out = execFileSync(process.execPath, [cli, 'profile'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(out, /WHO YOU'RE WORKING WITH/);
  assert.match(out, /Derived from 12 conversations/);
  assert.doesNotMatch(out, /Nothing built yet/, 'a built profile is never called "nothing built"');
  assert.doesNotMatch(out, /managed by stratless/, 'the managed-by header is stripped from the display');
});

test('profile: says "nothing built" only when HUMAN.md is absent', () => {
  const isolatedHome = join(dir, 'profile-absent-home');
  mkdirSync(join(isolatedHome, '.claude', 'projects'), { recursive: true });
  const env = {
    ...process.env,
    HOME: isolatedHome,
    STRATLESS_PROFILE_DIR: join(dir, 'profile-absent-profiles'),
    STRATLESS_HUMAN_MD: join(dir, 'profile-absent-HUMAN.md'),
    STRATLESS_RENDERS: join(dir, 'profile-absent-renders.json'),
    STRATLESS_CLAUDE_MD: join(dir, 'profile-absent-CLAUDE.md'),
  };
  const out = execFileSync(process.execPath, [cli, 'profile'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(out, /Nothing built yet/);
});

test('the door (init): arms the hook by default, shows a free read, defers the build when not a TTY', () => {
  const { home, env } = makeHome('door-nontty', [{ exchanges: 5 }, { exchanges: 5 }]);
  // execFileSync gives the child a piped stdin/stdout — process.stdin.isTTY is falsy, the "later" path.
  const out = execFileSync(process.execPath, [cli, 'init'], { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });

  // install = alive: the after-session hook is armed WITHOUT any --auto flag.
  const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
  assert.ok(JSON.stringify(settings.hooks?.Stop ?? []).includes('stratless update'), 'the after-session hook is armed by default');

  assert.match(out, /What I can already see/, 'the free read is shown');
  assert.match(out, /course corrections/, 'including the friction scoreboard');
  assert.match(out, /Full profile:/, 'and the cost estimate');
  assert.match(out, /Build the full profile any time|No rush/, 'non-TTY defers the build, never prompts');
});

// ── status: WHICH build is loaded, not just whether ────────────────────────────────────────────

test('status names the loaded build, flags a stale one, and never guesses without a stamp', () => {
  const { env } = makeHome('loaded-stamp', [{ exchanges: 2 }]);
  const childEnv = { ...process.env, ...env };
  const run = (): string =>
    execFileSync(process.execPath, [cli, 'status'], { encoding: 'utf8', env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  // loaded = the PAIR file exists AND CLAUDE.md carries the managed block. Each pair has its own
  // file, its own stamp, and its own latest in the sidecar (the per-record doctrine).
  const pairFile = join(env.STRATLESS_PROFILE_DIR, 'HUMAN.claude-code.md');
  writeFileSync(env.STRATLESS_CLAUDE_MD, '<!-- stratless:start -->\n@HUMAN.claude-code.md\n<!-- stratless:end -->\n');
  const meta = { builtAt: '2026-07-26T16:01:22.000Z', sessions: 136, exchanges: 5751, categories: 30 };
  writeFileSync(env.STRATLESS_RENDERS, JSON.stringify({ profiles: { 'claude-code': meta }, histories: { 'claude-code': [meta] } }));

  // 1. the loaded file IS the latest build → the line says which, with the stamp
  writeFileSync(pairFile, '# Who you are working with\n# (managed by stratless)\n# built 2026-07-26 16:01 UTC\n\nbody\n');
  assert.match(run(), /this build \(2026-07-26 16:01 UTC\)/, 'loaded == latest names the build');

  // 2. the loaded file is an older build → flagged loudly, both stamps, and the fix
  writeFileSync(pairFile, '# Who you are working with\n# built 2026-07-24 02:12 UTC\n\nbody\n');
  const stale = run();
  assert.match(stale, /OLDER build \(2026-07-24 02:12 UTC\)/, 'a stale load is named, not hidden');
  assert.match(stale, /latest is 2026-07-26 16:01 UTC/, 'with the stamp it should be on');
  assert.match(stale, /stratless update/, 'and the one command that fixes it');

  // 3. no `# built` header (a pre-0.4.0 file) → the plain line, no claim it cannot back
  writeFileSync(pairFile, 'no header here\n');
  const plain = run();
  assert.match(plain, /profile loaded\s+Claude Code\s+yes/, 'still honestly loaded');
  assert.ok(!plain.includes('this build') && !plain.includes('OLDER'), 'no stamp, no claim');
});

test('status reports each assistant on the machine by name, so one loaded tool cannot speak for an empty one', () => {
  // THE BUG THIS PINS: the line used to be a single boolean over every adapter, so a person running
  // two assistants with the profile in only one of them was told `profile loaded  yes`. That is the
  // one state on this line worth catching, and it was the one state it could not show.
  const { home, env } = makeHome('loaded-per-assistant', [{ exchanges: 2 }]);
  const codexHome = join(home, '.codex');
  mkdirSync(join(codexHome, 'sessions'), { recursive: true });
  const childEnv = { ...process.env, ...env, CODEX_HOME: codexHome };
  const run = (): string =>
    execFileSync(process.execPath, [cli, 'status'], { encoding: 'utf8', env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });

  const meta = { builtAt: '2026-07-26T16:01:22.000Z', sessions: 136, exchanges: 5751, categories: 30 };
  writeFileSync(env.STRATLESS_RENDERS, JSON.stringify({ profiles: { 'claude-code': meta }, histories: { 'claude-code': [meta] } }));
  writeFileSync(join(env.STRATLESS_PROFILE_DIR, 'HUMAN.claude-code.md'), '# Who you are working with\n# built 2026-07-26 16:01 UTC\n\nbody\n');
  // Claude Code carries its pair's profile; Codex's pair exists on the machine and has never earned
  // a file — the honest state of a freshly-added assistant.
  writeFileSync(env.STRATLESS_CLAUDE_MD, '<!-- stratless:start -->\n@HUMAN.claude-code.md\n<!-- stratless:end -->\n');

  const partial = run();
  assert.match(partial, /profile loaded\s+Claude Code\s+yes/, 'the tool that has it is named');
  assert.match(partial, /Codex\s+no\s+.*not enough history yet/, 'the pair with no file yet is told the truth, not blamed');
  assert.ok(!/profile loaded\s+yes/.test(partial), 'no bare aggregate yes stands in for both');

  // The Codex pair earns a file and it is delivered — the same command says so, per tool.
  writeFileSync(join(env.STRATLESS_PROFILE_DIR, 'HUMAN.codex.md'), '# Who you are working with\n# built 2026-07-27 09:00 UTC\n\ncodex body\n');
  writeFileSync(
    join(codexHome, 'AGENTS.md'),
    '<!-- stratless:start -->\n# built 2026-07-27 09:00 UTC\ncodex body\n<!-- stratless:end -->\n',
  );
  const both = run();
  assert.match(both, /Claude Code\s+yes/);
  assert.match(both, /Codex\s+yes/);
  assert.ok(!both.includes('load it:'), 'nothing left to fix, so nothing is suggested');

  // TWO files now, each named on its own row — the one-artifact assumption is gone.
  assert.ok(both.includes('HUMAN.claude-code.md'), "Claude Code's row names its own file");
  assert.ok(both.includes('HUMAN.codex.md'), "Codex's row names its own file");
});

test('a machine with one assistant is never told about a tool it does not run', () => {
  // The other half of the same rule: rows come from `detect()`, so an assistant that is not on this
  // machine is not mentioned. A Codex-only person should never read the words "Claude Code" here.
  const { home, env } = makeHome('loaded-codex-only', [{ exchanges: 2 }]);
  const codexHome = join(home, '.codex');
  mkdirSync(join(codexHome, 'sessions'), { recursive: true });
  rmSync(join(home, '.claude', 'projects'), { recursive: true, force: true }); // Claude Code was never here
  const childEnv = { ...process.env, ...env, CODEX_HOME: codexHome };

  const meta = { builtAt: '2026-07-26T16:01:22.000Z', sessions: 136, exchanges: 5751, categories: 30 };
  writeFileSync(env.STRATLESS_RENDERS, JSON.stringify({ profiles: { codex: meta }, histories: { codex: [meta] } }));
  writeFileSync(join(env.STRATLESS_PROFILE_DIR, 'HUMAN.codex.md'), '# Who you are working with\n# built 2026-07-26 16:01 UTC\n\nbody\n');
  writeFileSync(
    join(codexHome, 'AGENTS.md'),
    '<!-- stratless:start -->\n# built 2026-07-26 16:01 UTC\nbody\n<!-- stratless:end -->\n',
  );

  const out = execFileSync(process.execPath, [cli, 'status'], { encoding: 'utf8', env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(out, /profile loaded\s+Codex\s+yes/, 'the one assistant present is named');

  // Scoped to the rows on purpose. Elsewhere in `status` the spend line names the BRAIN — the model
  // that put this history into words — and that is provider-bound, deliberately not an adapter leg:
  // a Codex-only machine borrowing a Claude brain is the common case, not a contradiction. What must
  // not appear is an absent tool in the list of who is being handed the profile.
  const lines = out.split('\n');
  const start = lines.findIndex((l) => l.includes('profile loaded'));
  const rows = [lines[start]];
  for (const l of lines.slice(start + 1)) {
    if (!/^\s{24,}\S/.test(l)) break; // a continuation row is the only thing indented this far
    rows.push(l);
  }
  assert.ok(!rows.join('\n').includes('Claude Code'), 'an assistant that is not on this machine is never listed');
});
