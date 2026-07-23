/**
 * Tests for THE FREE MIRROR.
 *
 * Fixtures are synthetic so the right answer is known by construction. Each case pins a rule that
 * was broken on real data first — the mirror is the one surface where a single wrong number
 * discredits every other number, so the rules must not be able to rot quietly.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mirrorOf, mirrorOfArchive, mirrorOfArchiveAsync, repoRoots, personTopics, type Mirror } from './mirror.js';
import type { Turn } from './reader.js';

let n = 0;
const turn = (o: Partial<Turn>): Turn => ({
  uuid: `t${++n}`,
  session: 's1',
  ts: '2026-07-01T10:00:00',
  role: 'user',
  text: '',
  interrupted: false,
  pasted: false,
  images: 0,
  ...o,
});
const msg = (text: string, o: Partial<Turn> = {}) => turn({ text, ...o });

test('a message is a message; an interrupt and a denial are events, not messages', () => {
  const m = mirrorOf([
    msg('a real question'),
    turn({ interrupted: true }),
    turn({ denial: 'user-rejected' }),
    turn({ denial: 'automode-blocked' }),
  ]);
  assert.equal(m.scale.messages, 1, 'only the typed message counts as a message');
  assert.equal(m.friction.courseCorrections, 1);
  assert.equal(m.friction.toolDeclines, 1);
  assert.equal(m.friction.systemBlocks, 1);
});

test('the system blocking a tool is never counted as the person\'s friction', () => {
  const m = mirrorOf([...Array(100)].map((_, i) => msg(`m${i}`)).concat([turn({ denial: 'automode-blocked' })]));
  assert.equal(m.friction.systemBlocks, 1);
  assert.equal(m.friction.perHundred, 0, 'a system block must not move the rate');
});

test('the friction rate is per 100 submitted messages', () => {
  const m = mirrorOf([
    ...[...Array(200)].map((_, i) => msg(`m${i}`)),
    turn({ interrupted: true }),
    turn({ interrupted: true }),
    turn({ denial: 'user-rejected' }),
  ]);
  assert.equal(m.scale.messages, 200);
  assert.equal(m.friction.perHundred, 1.5, '3 events over 200 messages = 1.5 per 100');
});

test('every friction count dereferences to the moments behind it', () => {
  const m = mirrorOf([msg('x'), turn({ interrupted: true, uuid: 'i1' }), turn({ denial: 'user-rejected', uuid: 'd1' })]);
  assert.deepEqual(
    m.friction.events.map((e) => [e.uuid, e.kind]),
    [['i1', 'course-correction'], ['d1', 'tool-decline']],
  );
});

test('messages per active day is the MEDIAN — one huge day must not set it', () => {
  const day = (d: string, count: number) =>
    [...Array(count)].map((_, i) => msg(`m${i}`, { ts: `2026-07-${d}T10:0${i % 10}:00` }));
  const m = mirrorOf([...day('01', 2), ...day('02', 3), ...day('03', 400)]);
  assert.equal(m.scale.activeDays, 3);
  assert.equal(m.scale.medianPerActiveDay, 3, 'median 3, not the mean of 135');
});

test('a paste counts as a message but never reaches the length statistics', () => {
  const m = mirrorOf([msg('one two three'), msg('x '.repeat(5000), { pasted: true })]);
  assert.equal(m.scale.messages, 2);
  assert.equal(m.writing.pastes, 1);
  assert.equal(m.writing.median, 3, 'the paste is excluded, so the median is the short message');
});

test('subdirectories collapse into the repo root they sit under', () => {
  const roots = repoRoots(['/home/a/proj', '/home/a/proj/apps/web', '/home/a/proj/apps/api', '/home/a/other']);
  assert.equal(roots.get('/home/a/proj/apps/web'), '/home/a/proj');
  assert.equal(roots.get('/home/a/proj/apps/api'), '/home/a/proj');
  assert.equal(roots.get('/home/a/other'), '/home/a/other');
  assert.equal(new Set(roots.values()).size, 2, 'four directories, two repos');
});

test('a repo is not a cwd — messages in subdirectories add up to their root', () => {
  const m = mirrorOf([
    msg('a', { cwd: '/r/proj' }),
    msg('b', { cwd: '/r/proj/apps/web' }),
    msg('c', { cwd: '/r/proj/apps/web' }),
    msg('d', { cwd: '/r/other' }),
  ]);
  assert.equal(m.context.repos.length, 2);
  assert.deepEqual(m.context.repos[0], { root: '/r/proj', messages: 3 });
});

test('`main` in two repos is two branch pairs, not one branch', () => {
  const m = mirrorOf([msg('a', { cwd: '/r/one', gitBranch: 'main' }), msg('b', { cwd: '/r/two', gitBranch: 'main' })]);
  assert.equal(m.context.branchNames, 1, 'one distinct name');
  assert.equal(m.context.branchPairs, 2, 'two (repo, branch) pairs — the honest unit');
});

test('tool mix counts tool_use blocks, not assistant turns', () => {
  const m = mirrorOf([
    turn({ role: 'assistant', tools: ['Bash', 'Bash', 'Edit'] }),
    turn({ role: 'assistant', tools: ['Bash'] }),
    turn({ role: 'assistant' }),
  ]);
  assert.equal(m.work.toolCalls, 4, 'four calls across two turns — count events, not rows');
  assert.deepEqual(m.work.toolMix[0], { name: 'Bash', calls: 3, share: 0.75 });
});

test('hours-to-cover has no parameter to tune and is stable under relabelling', () => {
  // 80 messages in one hour, 20 spread over four others.
  const at = (h: number, c: number) =>
    [...Array(c)].map((_, i) => msg('x', { ts: `2026-07-01T${String(h).padStart(2, '0')}:0${i % 10}:00` }));
  const m = mirrorOf([...at(9, 80), ...at(11, 5), ...at(13, 5), ...at(15, 5), ...at(17, 5)]);
  assert.equal(m.rhythm.hoursFor80, 1, 'one hour holds 80%');
  assert.equal(m.rhythm.hoursFor90, 3, 'covering 90% needs three');
  assert.equal(m.rhythm.byHour.reduce((a, b) => a + b, 0), 100);
});

test('the streak counts consecutive days, and a gap breaks it', () => {
  const on = (d: string) => msg('x', { ts: `2026-07-${d}T10:00:00` });
  const m = mirrorOf([on('01'), on('02'), on('03'), on('07'), on('08')]);
  assert.equal(m.scale.activeDays, 5);
  assert.equal(m.scale.longestStreak, 3);
});

test('a question is a message whose last character is a question mark', () => {
  const m = mirrorOf([msg('is it?'), msg('do this'), msg('why? because'), msg('really?  ')]);
  assert.equal(m.writing.questionShare, 0.5, 'two of four end in ?');
});

test('our own session titles are not topics the person worked on', () => {
  const titles = [
    { aiTitle: 'Refactor the release pipeline', sessionId: 'mine' },
    { aiTitle: 'Confirm acknowledgment', sessionId: 'machine' },
    { aiTitle: 'Refactor the release pipeline', sessionId: 'mine' },
  ];
  assert.deepEqual(personTopics(titles, new Set(['mine'])), ['Refactor the release pipeline'], 'deduped, ours removed');
});

test('the two interrupt forms are different events and only one counts toward the rate', () => {
  const m = mirrorOf([
    ...[...Array(100)].map((_, i) => msg(`m${i}`)),
    turn({ interrupted: true, interruptKind: 'plain' }),
    turn({ interrupted: true, interruptKind: 'tool-use' }),
    turn({ interrupted: true, interruptKind: 'tool-use' }),
  ]);
  assert.equal(m.friction.courseCorrections, 1, 'only the spontaneous Escape is a course correction');
  assert.equal(m.friction.permissionStops, 2, 'permission-flow stops are reported, never dropped');
  assert.equal(m.friction.perHundred, 1, 'summing the two forms is how 5.37 was manufactured');
});

test('a permission stop is still dereferenceable even though it is out of the rate', () => {
  const m = mirrorOf([turn({ interrupted: true, interruptKind: 'tool-use', uuid: 'p1' })]);
  assert.deepEqual(m.friction.events.map((e) => e.kind), ['permission-stop']);
});

test('branch pairs are keyed on the repo root, not the working directory', () => {
  const m = mirrorOf([
    msg('a', { cwd: '/r/proj', gitBranch: 'main' }),
    msg('b', { cwd: '/r/proj/apps/web', gitBranch: 'main' }),
    msg('c', { cwd: '/r/proj/apps/api', gitBranch: 'main' }),
  ]);
  assert.equal(m.context.branchPairs, 1, 'one repo on one branch — three subdirectories is not three pairs');
});

test('a detached HEAD is a state, not a branch', () => {
  const m = mirrorOf([msg('a', { cwd: '/r/one', gitBranch: 'HEAD' }), msg('b', { cwd: '/r/one', gitBranch: 'main' })]);
  assert.equal(m.context.branchNames, 1);
  assert.equal(m.context.branchPairs, 1);
});

test('topics come from harness titles joined on the sessions the reader kept', () => {
  const m = mirrorOf(
    [msg('hello', { session: 'mine' })],
    [
      { aiTitle: 'Rework the release gate', sessionId: 'mine' },
      { aiTitle: 'Confirm acknowledgment', sessionId: 'ours' },
    ],
  );
  assert.deepEqual(m.topics, ['Rework the release gate']);
});

test('end to end: an archive with machine traffic yields only the person', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mirror-'));
  const rows = (o: object[]) => o.map((r) => JSON.stringify(r)).join('\n');
  writeFileSync(
    join(dir, 'person.jsonl'),
    rows([
      { type: 'user', uuid: 'a', sessionId: 's', entrypoint: 'cli', timestamp: '2026-07-01T10:00:00', cwd: '/r/p', message: { content: [{ type: 'text', text: 'hello there' }] } },
      { type: 'assistant', uuid: 'b', sessionId: 's', entrypoint: 'cli', timestamp: '2026-07-01T10:01:00', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
      { type: 'user', uuid: 'c', sessionId: 's', entrypoint: 'cli', timestamp: '2026-07-01T10:02:00', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
    ]),
  );
  writeFileSync(
    join(dir, 'machine.jsonl'),
    rows([
      { type: 'user', uuid: 'z', sessionId: 'm', entrypoint: 'sdk-cli', timestamp: '2026-07-01T11:00:00', message: { content: [{ type: 'text', text: 'PERSON ASKED: x' }] } },
    ]),
  );
  const m: Mirror = mirrorOfArchive(dir);
  assert.equal(m.scale.messages, 1, 'the borrowed call is not a message the person sent');
  assert.equal(m.friction.courseCorrections, 1);
  assert.equal(m.work.toolCalls, 1);
  assert.equal(m.context.repos[0].root, '/r/p');
  rmSync(dir, { recursive: true });
});

test('mirrorOfArchiveAsync is a faithful twin: same mirror as the sync read, only it yields for the spinner', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mirror-async-'));
  const rows = (o: object[]) => o.map((r) => JSON.stringify(r)).join('\n');
  writeFileSync(
    join(dir, 's.jsonl'),
    rows([
      { type: 'user', uuid: 'a', sessionId: 's', entrypoint: 'cli', timestamp: '2026-07-01T10:00:00', cwd: '/r/p', message: { content: [{ type: 'text', text: 'hello there friend' }] } },
      { type: 'assistant', uuid: 'b', sessionId: 's', entrypoint: 'cli', timestamp: '2026-07-01T10:01:00', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
      { type: 'user', uuid: 'c', sessionId: 's', entrypoint: 'cli', timestamp: '2026-07-01T10:02:00', message: { content: [{ type: 'text', text: 'is this right?' }] } },
    ]),
  );
  assert.deepEqual(await mirrorOfArchiveAsync(dir), mirrorOfArchive(dir), 'yielding for the spinner must not change a single number');
  rmSync(dir, { recursive: true });
});
