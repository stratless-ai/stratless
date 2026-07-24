/**
 * MIRROR COMMAND TESTS — the zero-commitment free read (`stratless mirror`).
 *
 * The command reads the LIVE logs at ~/.claude/projects and must run for a stranger who has NEVER
 * run `init`: no archive, no ~/.stratless, no settings touched, no spend. Because homedir()/ARCHIVE/
 * PROJECTS freeze at import time, the only faithful way to point the read at a fixture is a subprocess
 * with a fresh HOME (the phase2.test.ts pattern), so these run dist/index.js the way the user does.
 *
 * The fixture is built so course-corrections=1 and tool-declines=1 over 4 messages: the correct rate
 * is 25.00/100 and a SUMMED (buggy) rate would be 50.00 — which lets the never-sum rule be checked end
 * to end, not just at the renderer.
 */
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readFileSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';

let dir: string;
const distDir = dirname(fileURLToPath(import.meta.url));
const cli = join(distDir, 'index.js');

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'stratless-mirror-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const REPO = '/work/acme-secret-client'; // the cwd whose basename must never reach the shareable card
const rec = (o: Record<string, unknown>): string =>
  JSON.stringify({ sessionId: 's1', entrypoint: 'cli', cwd: REPO, ...o });

/** The fixture live-log tree: 4 submitted messages, 1 course-correction, 1 tool decline, 1 Bash call. */
const FIXTURE = [
  rec({ type: 'user', uuid: 'u1', timestamp: '2026-07-01T10:00:00.000Z', message: { content: [{ type: 'text', text: 'add a login button please to the page' }] } }),
  rec({ type: 'assistant', uuid: 'a1', timestamp: '2026-07-01T10:00:30.000Z', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }),
  rec({ type: 'user', uuid: 'u2', timestamp: '2026-07-01T10:01:00.000Z', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
  rec({ type: 'user', uuid: 'u3', timestamp: '2026-07-01T10:01:30.000Z', toolDenialKind: 'user-rejected', message: { content: [{ type: 'text', text: '' }] } }),
  rec({ type: 'user', uuid: 'u4', timestamp: '2026-07-02T11:00:00.000Z', message: { content: [{ type: 'text', text: 'why is it not working now' }] } }),
  rec({ type: 'user', uuid: 'u5', timestamp: '2026-07-02T11:05:00.000Z', message: { content: [{ type: 'text', text: 'ok continue with the plan now' }] } }),
  rec({ type: 'user', uuid: 'u6', timestamp: '2026-07-02T11:10:00.000Z', message: { content: [{ type: 'text', text: 'looks good thanks' }] } }),
].join('\n');

/**
 * A fixture HOME. `withLogs` writes the nested ~/.claude/projects/proj/s1.jsonl tree; `withSettings`
 * pre-seeds ~/.claude/settings.json. Deliberately does NOT create ~/.stratless — its absence after a
 * run is the zero-side-effect proof.
 */
function makeHome(name: string, opts: { withLogs?: boolean; withSettings?: boolean } = {}): string {
  const home = join(dir, name);
  mkdirSync(join(home, '.claude'), { recursive: true });
  if (opts.withLogs) {
    const proj = join(home, '.claude', 'projects', 'proj');
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, 's1.jsonl'), `${FIXTURE}\n`);
  }
  if (opts.withSettings) writeFileSync(join(home, '.claude', 'settings.json'), '{"cleanupPeriodDays":30}\n');
  return home;
}

/** Run the built CLI with a fixture HOME, exactly as a user would; return stdout. */
function run(home: string, ...cmd: string[]): string {
  return execFileSync(process.execPath, [cli, ...cmd], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
}

test('mirror reads the live logs with no archive and no init', () => {
  const home = makeHome('live', { withLogs: true });
  const out = run(home, 'mirror');
  assert.match(out, /4 messages · 2 active days/, 'counts submitted messages and active days from the live tree');
  assert.match(out, /course corrections\s+25\.00 \/ 100 messages/, '1 correction over 4 messages = 25.00, corrections ALONE');
  assert.match(out, /tool declines\s+1/, 'the one decline is reported separately as a raw count');
  assert.doesNotMatch(out, /50\.00/, 'the two friction numbers are NEVER summed (that would read 50.00)');
  assert.ok(!existsSync(join(home, '.stratless')), 'the read created nothing under ~/.stratless');
});

test('mirror with no history guides instead of crashing', () => {
  const home = makeHome('empty'); // .claude exists, but no projects dir
  const out = run(home, 'mirror'); // execFileSync throws on non-zero exit — reaching here proves exit 0
  assert.match(out, /talk to Claude Code a few times/i, 'the friendly first-run guide, not a crash or a scary 0');
});

test('mirror has zero side effects — settings.json untouched, ~/.stratless never created', () => {
  const home = makeHome('noeffect', { withLogs: true, withSettings: true });
  const settings = join(home, '.claude', 'settings.json');
  const before = readFileSync(settings, 'utf8');
  run(home, 'mirror');
  run(home, 'mirror', '--share');
  assert.equal(readFileSync(settings, 'utf8'), before, 'settings.json byte-identical before/after');
  assert.ok(!existsSync(join(home, '.stratless')), 'no archive, no state — ~/.stratless still absent');
});

test('mirror --share omits the repo name and keeps the friction numbers separate', () => {
  const home = makeHome('share', { withLogs: true });
  const out = run(home, 'mirror', '--share');
  assert.doesNotMatch(out, /acme-secret-client/, 'the repo basename must never reach the shareable card');
  assert.doesNotMatch(out, /busiest repo/, 'the identifying row is dropped from the card');
  assert.match(out, /course corrections\s+25\.00 \/ 100 messages/, 'the KPI, alone');
  assert.match(out, /tool declines\s+1/, 'declines separate');
  assert.doesNotMatch(out, /50\.00/, 'never the summed number');
});

test('bare `stratless` shows the mirror, not the help wall', () => {
  const home = makeHome('bare', { withLogs: true });
  const out = run(home); // no command
  assert.match(out, /You and your AI, measured/, 'bare command renders the free read');
  assert.doesNotMatch(out, /get started:/, 'not the help text');
});

test('`stratless help` still lists every verb, including mirror', () => {
  const home = makeHome('help');
  const out = run(home, 'help');
  assert.match(out, /stratless mirror/, 'mirror is in the help');
  assert.match(out, /stratless init/, 'and the rest of the surface is still reachable');
});
