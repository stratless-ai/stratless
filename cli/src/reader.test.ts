/**
 * Tests for THE SHARED READER.
 *
 * Every case here is one of the six ways a "count the person's messages" pass was found to be
 * wrong on real data. Fixtures are synthetic so the right answer is known by construction —
 * the point is that a future change cannot quietly reintroduce a failure we already paid for.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTurns, readSessions, isTypedMessage, stripWrappers, dayKey, PASTE_BOUND, driftCheck } from './reader.js';

let n = 0;
const rec = (o: Record<string, unknown>) => ({
  uuid: `u${++n}`,
  sessionId: 's1',
  timestamp: '2026-07-01T10:00:00.000Z',
  entrypoint: 'cli',
  ...o,
});
const user = (text: string, o: Record<string, unknown> = {}) =>
  rec({ type: 'user', message: { content: [{ type: 'text', text }] }, ...o });
const asst = (text: string, o: Record<string, unknown> = {}) =>
  rec({ type: 'assistant', message: { content: [{ type: 'text', text }] }, ...o });

function archiveOf(files: Record<string, unknown[]>): string {
  const dir = mkdtempSync(join(tmpdir(), 'reader-'));
  for (const [name, records] of Object.entries(files)) {
    writeFileSync(join(dir, name), records.map((r) => JSON.stringify(r)).join('\n'));
  }
  return dir;
}
const typedTexts = (dir: string) => [...readTurns([dir])].filter(isTypedMessage).map((t) => t.text);

test('our own borrowed calls are excluded, whole file at a time', () => {
  const dir = archiveOf({
    'a.jsonl': [user('what I really typed')],
    'b.jsonl': [
      rec({ type: 'user', entrypoint: 'sdk-cli', message: { content: [{ type: 'text', text: 'PERSON ASKED: x' }] } }),
      rec({ type: 'user', entrypoint: 'sdk-cli', message: { content: [{ type: 'text', text: 'You are building a PROFILE' }] } }),
    ],
  });
  assert.deepEqual(typedTexts(dir), ['what I really typed']);
  rmSync(dir, { recursive: true });
});

test('the pipeline never eats its own exhaust: a <stratless-…> turn is dropped, the person survives', () => {
  const dir = archiveOf({
    'a.jsonl': [
      rec({ type: 'user', message: { content: [{ type: 'text', text: '<stratless-judge>\nPERSON ASKED: x' }] } }),
      user('why do we need a queue?'),
    ],
  });
  assert.deepEqual(typedTexts(dir), ['why do we need a queue?']);
  rmSync(dir, { recursive: true });
});

// ── the canary (v3): refuse when the log format moves; never lie "no data" over unreadable history ──

test('the canary: real transcripts that read as NOTHING are a refusal, not "no data"', () => {
  const dir = archiveOf({
    // records in a shape the reader no longer recognises — the format moved (`type` renamed)
    'moved.jsonl': Array.from({ length: 40 }, (_, i) => ({
      uuid: `x${i}`,
      sessionId: 's1',
      timestamp: '2026-07-01T10:00:00.000Z',
      kind: 'human',
      body: 'a real message the reader can no longer see',
    })),
  });
  const r = driftCheck([dir], { minBytes: 200 });
  assert.equal(r.ok, false, 'content on disk + zero typed turns = drift, not emptiness');
  assert.equal(r.typed, 0);
  assert.match(r.reason ?? '', /format/i);
  rmSync(dir, { recursive: true });
});

test('the canary stays silent when the reader still works (a talk-only or normal history)', () => {
  const dir = archiveOf({ 'ok.jsonl': [user('a real typed message'), asst('reply'), user('another')] });
  assert.equal(driftCheck([dir], { minBytes: 10 }).ok, true, 'one typed turn read → the reader works → not drift');
  rmSync(dir, { recursive: true });
});

test('the canary does not fire on a nearly-empty archive (a fresh machine)', () => {
  const dir = archiveOf({ 'tiny.jsonl': [{ kind: 'human', body: 'x' }] });
  assert.equal(driftCheck([dir]).ok, true, 'below the byte floor = "nothing yet", never a false refusal');
  rmSync(dir, { recursive: true });
});

test('the canary ignores our OWN borrowed calls — only the person can be unreadable', () => {
  const dir = archiveOf({
    'ours.jsonl': Array.from({ length: 60 }, () =>
      rec({ type: 'user', entrypoint: 'sdk-cli', message: { content: [{ type: 'text', text: 'PERSON ASKED: '.repeat(20) }] } })),
  });
  assert.equal(driftCheck([dir], { minBytes: 200 }).ok, true, 'an all-machine archive is stratless talking to itself, not the reader failing');
  rmSync(dir, { recursive: true });
});

test('subagent traffic and harness bookkeeping are not the person', () => {
  const dir = archiveOf({
    'a.jsonl': [user('mine'), user('subagent', { isSidechain: true }), user('meta', { isMeta: true })],
  });
  assert.deepEqual(typedTexts(dir), ['mine']);
  rmSync(dir, { recursive: true });
});

test('harness wrappers are stripped; a wrapper-only record is not a message', () => {
  assert.equal(stripWrappers('<task-notification>bg job done</task-notification>'), '');
  assert.equal(stripWrappers('<command-name>/model</command-name>real words'), 'real words');
  assert.equal(stripWrappers('This session is being continued from a previous one'), '');
  const dir = archiveOf({
    'a.jsonl': [user('<task-notification>done</task-notification>'), user('real question')],
  });
  assert.deepEqual(typedTexts(dir), ['real question']);
  rmSync(dir, { recursive: true });
});

test('a replayed record is one event, not two (session resume rewrites history)', () => {
  const dup = user('said once');
  const dir = archiveOf({ 'a.jsonl': [dup], 'b.jsonl': [dup, user('and then this')] });
  assert.deepEqual(typedTexts(dir), ['said once', 'and then this']);
  rmSync(dir, { recursive: true });
});

test('drafts collapse to the submitted version — edits anywhere, not just appended', () => {
  const dir = archiveOf({
    'a.jsonl': [
      asst('go on'),
      user('so you mean just reconnect?', { parentUuid: 'p1' }),
      user('so you mean you could just reconnect?', { parentUuid: 'p1' }),
    ],
  });
  assert.deepEqual(typedTexts(dir), ['so you mean you could just reconnect?']);
  rmSync(dir, { recursive: true });
});

test('a multi-part request is NOT a draft — consecutive messages chain by parent', () => {
  const first = user('one thing', { uuid: 'm1', parentUuid: 'p1' });
  const dir = archiveOf({ 'a.jsonl': [first, user('and another', { parentUuid: 'm1' })] });
  assert.deepEqual(typedTexts(dir), ['one thing', 'and another']);
  rmSync(dir, { recursive: true });
});

test('an interrupt is a control action, never a message', () => {
  const dir = archiveOf({
    'a.jsonl': [user('[Request interrupted by user]'), user('wait, stop')],
  });
  const turns = [...readTurns([dir])];
  assert.equal(turns.filter((t) => t.interrupted).length, 1);
  assert.deepEqual(typedTexts(dir), ['wait, stop']);
  rmSync(dir, { recursive: true });
});

test('a paste counts as a message but is flagged out of length statistics', () => {
  const dir = archiveOf({ 'a.jsonl': [user('x'.repeat(PASTE_BOUND + 1)), user('short one')] });
  const typed = [...readTurns([dir])].filter(isTypedMessage);
  assert.equal(typed.length, 2);
  assert.deepEqual(typed.map((t) => t.pasted), [true, false]);
  rmSync(dir, { recursive: true });
});

test('the system blocking a tool is not the person declining one', () => {
  const dir = archiveOf({
    'a.jsonl': [user('do it', { toolDenialKind: 'user-rejected' }), user('ok', { toolDenialKind: 'automode-blocked' })],
  });
  const kinds = [...readTurns([dir])].map((t) => t.denial);
  assert.deepEqual(kinds, ['user-rejected', 'automode-blocked']);
  rmSync(dir, { recursive: true });
});

test('a denial names WHICH tool was refused — the tool_use id resolved against the ledger', () => {
  const dir = archiveOf({
    'a.jsonl': [
      rec({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tid1', name: 'ExitPlanMode' }, { type: 'tool_use', id: 'tid2', name: 'Bash' }] } }),
      rec({
        type: 'user',
        toolDenialKind: 'user-rejected',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tid1', is_error: true, content: 'rejected' }] },
      }),
      // a denial whose id was never seen resolves to nothing rather than guessing
      rec({
        type: 'user',
        toolDenialKind: 'user-rejected',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tid-unknown', is_error: true, content: 'rejected' }] },
      }),
    ],
  });
  const denials = [...readTurns([dir])].filter((t) => t.denial);
  assert.deepEqual(denials[0].deniedTools, ['ExitPlanMode'], 'the id resolves to the refused tool, not its neighbour');
  assert.equal(denials[1].deniedTools, undefined, 'an unresolvable id stays silent');
  rmSync(dir, { recursive: true });
});

test('the working day boundary is 04:00, so past-midnight work belongs to the day it started', () => {
  const late = new Date('2026-07-01T22:30:00');
  const past = new Date('2026-07-02T01:30:00');
  const next = new Date('2026-07-02T09:00:00');
  assert.equal(dayKey(late), dayKey(past), 'work at 01:30 belongs to the previous day');
  assert.notEqual(dayKey(past), dayKey(next), 'the new day starts after 04:00');
});

test('assistant tool use is captured; prose-only replies carry no tools', () => {
  const dir = archiveOf({
    'a.jsonl': [
      rec({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }, { type: 'tool_use', name: 'Edit' }] } }),
      asst('just words'),
    ],
  });
  const turns = [...readTurns([dir])];
  assert.deepEqual(turns[0].tools, ['Bash', 'Edit']);
  assert.equal(turns[1].tools, undefined);
  rmSync(dir, { recursive: true });
});

test('a missing or unreadable archive yields nothing rather than throwing', () => {
  assert.deepEqual([...readTurns(['/nope/not/here'])], []);
});

test('the walk RECURSES — ~/.claude/projects nests one directory per project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reader-deep-'));
  mkdirSync(join(dir, 'project-a', 'deeper'), { recursive: true });
  writeFileSync(join(dir, 'project-a', 'deeper', 's.jsonl'), JSON.stringify(user('buried three levels down')));
  assert.deepEqual(typedTexts(dir), ['buried three levels down'], 'a flat readdir would find nothing here');
  rmSync(dir, { recursive: true });
});

test('both roots are read as one union, deduped by uuid', () => {
  const shared = user('written to projects, then archived');
  const a = archiveOf({ 'live.jsonl': [shared, user('only in the live dir')] });
  const b = archiveOf({ 'copy.jsonl': [shared] }); // the archive copy of the same session
  const texts = [...readTurns([a, b])].filter(isTypedMessage).map((t) => t.text);
  assert.equal(texts.filter((t) => t === 'written to projects, then archived').length, 1, 'the copy is not a second event');
  assert.ok(texts.includes('only in the live dir'));
  rmSync(a, { recursive: true });
  rmSync(b, { recursive: true });
});

test('files arrive NEWEST-MODIFIED first, so a caller can stop early', () => {
  const dir = archiveOf({
    'old.jsonl': [user('stale')],
    'new.jsonl': [user('fresh')],
  });
  const t = Date.now() / 1000;
  utimesSync(join(dir, 'old.jsonl'), t - 9000, t - 9000);
  utimesSync(join(dir, 'new.jsonl'), t, t);
  const first = readSessions([dir]).next().value;
  assert.equal(first?.turns[0].text, 'fresh', 'the newest file is offered first');
  rmSync(dir, { recursive: true });
});

test('readSessions batches per file, so pairing can never cross a session', () => {
  const dir = archiveOf({
    'one.jsonl': [user('a'), asst('reply'), user('b')],
    'two.jsonl': [user('c')],
  });
  const batches = [...readSessions([dir])];
  assert.equal(batches.length, 2, 'one batch per transcript');
  assert.ok(batches.every((b) => b.turns.length > 0), 'an empty batch is never yielded');
});
