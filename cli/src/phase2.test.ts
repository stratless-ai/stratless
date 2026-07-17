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
import { artifactShapeProblem } from './synthesize.js';
import { stopWorker, readLock } from './worker.js';
import { readProgress } from './progress.js';

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
  assert.equal(r.n, 40 * 250, 'every exchange yielded exactly once');
  assert.equal(r.firstSession, 'session-039', 'newest file walks first');
  // ~72MB of corpus text: loading it all would balloon well past this; one-file-at-a-time stays flat.
  assert.ok(r.peak < 130 * 1024 * 1024, `peak RSS ${(r.peak / 1e6).toFixed(0)}MB stays under the flat-memory bound`);
});

// ── C3 — kill-safe progress: two SIGKILLs, then completion, with bounded re-spend ─────────────

test('C3: kill the worker twice mid-run — resume re-spends at most one chunk per death', async () => {
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

test('C7: stopWorker kills a busy worker within grace, cleans the lock, labels the run', async () => {
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

test('wake: five simultaneous updates ring one worker; every doorbell returns fast', async () => {
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
});

// ── The artifact-shape lint (C9's second half): chatter never loads again ──────────────────────

test('shape lint: the exact production chatter is refused; real artifacts pass', () => {
  const chatter = 'It looks like your message came through empty, no request attached, just the system context. What would you like to work on?';
  assert.equal(artifactShapeProblem(chatter, { kind: 'profile', patternEra: false }), 'assistant chatter', 'the 2026-07-18 incident can never load again');
  assert.equal(artifactShapeProblem(chatter, { kind: 'profile', patternEra: true }), 'assistant chatter');
  assert.equal(artifactShapeProblem("I don't have permission to write that file, but here is the content.", { kind: 'profile', patternEra: true }), 'assistant chatter', "Phase 0's B1 artifact");
  assert.equal(
    artifactShapeProblem('This person moves fast.\nWHAT THEY KNOW\n…', { kind: 'profile', patternEra: true }),
    'text without the section headings',
    'a pattern-era profile opens with a kind heading, not prose',
  );
  assert.equal(artifactShapeProblem('WHAT THEY KNOW\nTypeScript, deeply.', { kind: 'profile', patternEra: true }), undefined);
  assert.equal(artifactShapeProblem('**HOW THEY WORK**\nShort loops.', { kind: 'profile', patternEra: true }), undefined, 'markdown-bold drift is cosmetic, not a different shape');
  assert.equal(artifactShapeProblem('You move fast and check claims yourself.', { kind: 'profile', patternEra: false }), undefined, 'the flat-era profile is plain prose');
  assert.equal(artifactShapeProblem('You clicked with the deploy work this week.', { kind: 'report', patternEra: true }), undefined, 'the report is prose for a human');
});
