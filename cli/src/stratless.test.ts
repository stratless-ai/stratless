/**
 * The whole product is one claim: IT DOES NOT LIE.
 *
 * Every test below is a lie it actually told during development on 2026-07-14. They are not
 * hypotheticals — each one shipped, was caught by looking, and is pinned here so it can never
 * come back. A confidently-wrong answer, screenshotted by one stranger, ends this product.
 */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';

import { parseSession, type Edit } from './transcript.js';
import { parseExchanges } from './exchange.js';
import { why } from './match.js';

let dir: string;
let repo: string;

/** A throwaway git repo + a transcript that wrote into it. */
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'stratless-test-'));
  repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
});
after(() => rmSync(dir, { recursive: true, force: true }));

const turn = (prompt: string, said: string, tool: object) =>
  [
    JSON.stringify({ type: 'user', message: { content: prompt }, timestamp: '2026-07-01T10:00:00Z' }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-07-01T10:00:05Z',
      message: { content: [{ type: 'text', text: said }, tool] },
    }),
  ].join('\n');

const writeTranscript = (name: string, body: string): string => {
  const p = join(dir, name);
  writeFileSync(p, `${body}\n`);
  return p;
};

// ── transcript ────────────────────────────────────────────────────────────────────────────

test('MultiEdit is parsed — dropping it makes `why` claim "you wrote this"', () => {
  const p = writeTranscript(
    'multi.jsonl',
    turn('refactor the limits', 'Applying both changes.', {
      type: 'tool_use',
      name: 'MultiEdit',
      input: {
        file_path: '/x/limits.ts',
        edits: [
          { old_string: 'const A = 1;', new_string: 'const MAX_UPLOAD_BYTES = 10485760;' },
          { old_string: 'const B = 2;', new_string: 'const MAX_RETRIES = 3;' },
        ],
      },
    }),
  );
  const edits = parseSession(p);
  assert.equal(edits.length, 2, 'both halves of a MultiEdit must survive');
  assert.ok(edits.some((e) => e.body.includes('MAX_UPLOAD_BYTES')));
  assert.ok(edits.some((e) => e.body.includes('MAX_RETRIES')));
  assert.equal(edits[0].prompt, 'refactor the limits', 'the human turn must ride along');
});

test('Edit and Write are both read', () => {
  const p = writeTranscript(
    'ew.jsonl',
    `${turn('a', 'x', {
      type: 'tool_use',
      name: 'Edit',
      input: { file_path: '/x/a.ts', new_string: 'const A = 1;' },
    })}\n${turn('b', 'y', {
      type: 'tool_use',
      name: 'Write',
      input: { file_path: '/x/b.ts', content: 'const B = 2;' },
    })}`,
  );
  assert.equal(parseSession(p).length, 2);
});

test('subagent turns are not the human conversation', () => {
  const p = join(dir, 'side.jsonl');
  writeFileSync(
    p,
    `${JSON.stringify({
      type: 'assistant',
      isSidechain: true,
      timestamp: '2026-07-01T10:00:00Z',
      message: {
        content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/x/a.ts', new_string: 'nope' } }],
      },
    })}\n`,
  );
  assert.equal(parseSession(p).length, 0);
});

// ── exchanges: the profiler's evidence ──────────────────────────────────────────────────────
//
// The profile is only ever as honest as the pairs it reads. Every test here pins a way the parser
// could quietly manufacture or drop evidence — each of which becomes a wrong claim about a person.

const u = (text: string, ts = '2026-07-01T10:00:00Z') =>
  JSON.stringify({ type: 'user', message: { content: text }, timestamp: ts });
const a = (text: string, ts = '2026-07-01T10:00:05Z') =>
  JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'text', text }] } });

test('each real human message is the reaction to one turn AND the prompt for the next', () => {
  const p = writeTranscript(
    'chain.jsonl',
    [
      u('how do i deploy'),
      a('Push to main and it builds.'),
      u('wait what does that mean for us'),
      a('Every commit goes live the moment you push.'),
      u('ok got it'),
    ].join('\n'),
  );
  const ex = parseExchanges(p);
  assert.equal(ex.length, 2, 'two closed turns — the dangling last human message is not a third');
  assert.equal(ex[0].prompt, 'how do i deploy');
  assert.equal(ex[0].said, 'Push to main and it builds.');
  assert.equal(ex[0].reaction, 'wait what does that mean for us', 'the reaction carries the signal');
  assert.equal(ex[1].prompt, 'wait what does that mean for us', 'that same message opens the next turn');
});

test('a turn where the assistant only ran tools is NOT an exchange — there is no understanding to judge', () => {
  const p = writeTranscript(
    'toolonly.jsonl',
    [
      u('rename the file'),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-07-01T10:00:05Z',
        message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/x/a.ts', new_string: 'x' } }] },
      }),
      u('did it work?'),
    ].join('\n'),
  );
  assert.equal(parseExchanges(p).length, 0, 'no assistant words = nothing transferred = judge nothing');
});

test('a tool_result is not the human reacting, and assistant text accumulates across it', () => {
  const p = writeTranscript(
    'toolresult.jsonl',
    [
      u('fix the bug'),
      a('Looking now.'),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
      a('Fixed it — off-by-one in the loop.'),
      u('nice'),
    ].join('\n'),
  );
  const ex = parseExchanges(p);
  assert.equal(ex.length, 1, 'the tool_result must not split the turn into two');
  assert.equal(ex[0].reaction, 'nice');
  assert.ok(ex[0].said.includes('Looking now') && ex[0].said.includes('off-by-one'), 'both assistant texts survive');
});

test('subagent turns are not the human conversation', () => {
  const p = writeTranscript(
    'sidechain.jsonl',
    [
      u('do the thing'),
      JSON.stringify({
        type: 'assistant',
        isSidechain: true,
        timestamp: '2026-07-01T10:00:05Z',
        message: { content: [{ type: 'text', text: 'subagent chatter' }] },
      }),
      u('done?'),
    ].join('\n'),
  );
  assert.equal(parseExchanges(p).length, 0, 'a sidechain turn is not the person talking');
});

// ── match: the verdicts ───────────────────────────────────────────────────────────────────

const edit = (file: string, body: string, over: Partial<Edit> = {}): Edit => ({
  file,
  date: '2026-07-01',
  ts: '2026-07-01T10:00:05Z',
  body,
  prompt: 'make login work',
  said: 'Using a 30-day session.',
  session: 'abc12345',
  ...over,
});

test('a BLANK line must never match — it once scored 100% on nothing', () => {
  const f = join(repo, 'blank.ts');
  writeFileSync(f, 'const SESSION_TTL_MS = 2592000000;\n\nexport function go() {}\n');
  const a = why('blank.ts', 2, [edit(f, 'const SESSION_TTL_MS = 2592000000;')], repo);
  assert.notEqual(a.verdict, 'matched', 'a blank line can never be a confident match');
  if (a.edit) assert.ok(a.note, 'if it answers about a blank line at all, it MUST say it widened');
});

test('`export const X = 48_000` is traceable — a filter once silently ate every constant', () => {
  const f = join(repo, 'win.ts');
  writeFileSync(f, 'export const CLASSIFY_WINDOW = 48_000;\nexport const OTHER = 1;\n');
  const a = why('win.ts', 1, [edit(f, 'export const CLASSIFY_WINDOW = 48_000;\nexport const OTHER = 1;')], repo);
  assert.ok(a.edit, 'constants and thresholds are exactly the consequential lines');
  assert.ok(a.confidence > 0.5);
});

test('a line the assistant never wrote is YOURS — never a confident guess', () => {
  const f = join(repo, 'mine.ts');
  writeFileSync(f, 'export function handWrittenByAHuman(x: number) { return x * 2; }\n');
  const a = why('mine.ts', 1, [edit(join(repo, 'elsewhere.ts'), 'const UNRELATED = 1;')], repo);
  assert.equal(a.verdict, 'yours');
  assert.equal(a.confidence, 0);
  assert.equal(a.edit, undefined);
});

test('an out-of-range line throws — it does not invent an answer', () => {
  const f = join(repo, 'short.ts');
  writeFileSync(f, 'const A = 1;\n');
  assert.throws(() => why('short.ts', 999, [], repo), /999/);
});

