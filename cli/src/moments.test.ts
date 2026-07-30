/**
 * MOMENTS — the pile's guarantees, pinned. Two of these were the exact bugs the design exists to
 * prevent: a re-run that duplicates yesterday's work, and a store that grows by rewriting itself.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';

import { buildMoments, loadMoments, toMoment, pileOf } from './moments.js';
import { parseExchanges, type Exchange } from './exchange.js';

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'stratless-moments-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── fixture builders ────────────────────────────────────────────────────────────────────────────

const u = (text: string, ts = '2026-07-01T10:00:00Z') =>
  JSON.stringify({ type: 'user', message: { content: text }, timestamp: ts });
const a = (text: string, ts = '2026-07-01T10:00:05Z') =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] }, timestamp: ts });
const toolAsst = (text: string, tools: string[], ts = '2026-07-01T10:00:05Z') =>
  JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    message: { content: [{ type: 'text', text }, ...tools.map((name) => ({ type: 'tool_use', name, input: {} }))] },
  });
/** Write a transcript into a fresh roots dir and return that dir, so buildMoments can walk it. */
function roots(name: string, lines: string[], mtime?: number): string {
  const rdir = mkdtempSync(join(tmpdir(), `stratless-roots-${name}-`));
  const p = join(rdir, `${name}.jsonl`);
  writeFileSync(p, lines.join('\n') + '\n');
  if (mtime) utimesSync(p, mtime, mtime);
  return rdir;
}

// ── the record ────────────────────────────────────────────────────────────────────────────────

test('a moment carries exactly the fields a stage reads — pile, reply, true length, tools, head+tail', () => {
  const ex = parseExchanges(
    join(roots('rec', [u('rename the parser'), toolAsst('I will rename it now.', ['Edit', 'Bash', 'Edit']), u('wait, why?')]), 'rec.jsonl'),
  );
  const m = toMoment(ex[1]); // ex[0] is the opener
  assert.equal(m.key, ex[1].hash, 'the key is the content hash');
  assert.equal(m.pile, 'ordinary');
  assert.equal(m.reply, 'wait, why?');
  assert.equal(m.replyLen, 'wait, why?'.length);
  assert.deepEqual(m.tools, ['Edit', 'Bash'], 'distinct names — WHAT it did');
  assert.equal(m.calls, 3, 'total invocations — HOW MUCH');
  assert.equal(m.aiHead, 'I will rename it now.', 'the opening move');
  assert.equal(m.aiTail, 'I will rename it now.', 'and the ending — same text on a short turn, which is honest');
});

test('head and tail are the true ends of a long turn, not two views of the tail', () => {
  const long = `THE-OPENING ${'y'.repeat(9000)} THE-CONCLUSION`;
  const ex = parseExchanges(join(roots('long', [u('explain it'), a(long), u('ok')]), 'long.jsonl'));
  const m = toMoment(ex[1]);
  assert.ok(m.aiHead!.includes('THE-OPENING'), 'the head is the real start');
  assert.ok(m.aiTail!.includes('THE-CONCLUSION'), 'the tail is the real end');
  assert.ok(!m.aiHead!.includes('THE-CONCLUSION'), 'and they do not collapse into the same window');
});

test('a moment with no assistant text has neither head nor tail — an opener, a tool-only turn', () => {
  const ex = parseExchanges(join(roots('bare', [u('do the thing'), toolAsst('', ['Edit']), u('done?')]), 'bare.jsonl'));
  const opener = toMoment(ex[0]);
  assert.equal(opener.aiHead, undefined, 'the opener reacted to nothing');
  assert.equal(opener.aiTail, undefined);
  const toolOnly = toMoment(ex[1]);
  assert.equal(toolOnly.aiTail, undefined, 'the assistant only ran a tool — no words to record');
  assert.deepEqual(toolOnly.tools, ['Edit'], 'but what it was DOING is carried');
  assert.equal(toolOnly.aiTerms, undefined, 'the answer channel rides the same gate — silence has no subject');
  assert.equal(toolOnly.saidLen, undefined);
});

test('the answer channel reads the FULL answer — a mid-turn subject the card windows never see', () => {
  // The subject sits past the 300-char head and before the 300-char tail: invisible to aiHead and
  // aiTail, visible only because extraction ran on the uncapped text at collect.
  const long = `THE-OPENING ${'yyy '.repeat(300)}midturn-subject ${'zzz '.repeat(300)}THE-CONCLUSION`;
  const ex = parseExchanges(join(roots('terms', [u('explain it'), a(long), u('ok')]), 'terms.jsonl'));
  const m = toMoment(ex[1]);
  assert.ok(!m.aiHead!.includes('midturn-subject') && !m.aiTail!.includes('midturn-subject'), 'the windows missed it');
  assert.ok(m.aiTerms!.includes('midturn-subject'), 'the answer channel caught it');
  assert.equal(m.saidLen, long.length, 'and the true answer size is kept — the caps would hide it');
});

test('a shape bump re-derives the same keys — the rebuild cannot orphan a single assignment', () => {
  const rdir = roots('keys', [u('one'), a('an answer about caching'), u('two')]);
  const file = join(dir, 'keys.jsonl');
  buildMoments({ roots: [rdir], file });
  const before = new Set(loadMoments(file).map((m) => m.key));
  writeFileSync(`${file}.v`, '2\n'); // an old-shape pile, as every machine has on the day of the bump
  buildMoments({ roots: [rdir], file });
  const rebuilt = loadMoments(file);
  assert.deepEqual(new Set(rebuilt.map((m) => m.key)), before, 'identity is the content hash — the new fields sit outside it');
  assert.ok(rebuilt.some((m) => m.aiTerms?.includes('caching')), 'and the rebuilt pile carries the answer channel');
});

test('a refused tool is NAMED on the moment — denied travels from the raw denial to the pile', () => {
  const toolAsstIds = (text: string, uses: { id: string; name: string }[]) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-07-01T10:00:05Z',
      message: { content: [{ type: 'text', text }, ...uses.map(({ id, name }) => ({ type: 'tool_use', id, name, input: {} }))] },
    });
  const denyToolRec = (id: string) =>
    JSON.stringify({
      type: 'user',
      timestamp: '2026-07-01T10:00:07Z',
      toolDenialKind: 'user-rejected',
      message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'rejected' }] },
    });
  const ex = parseExchanges(
    join(
      roots('deny', [u('plan it'), toolAsstIds('entering plan mode', [{ id: 't1', name: 'EnterPlanMode' }]), denyToolRec('t1'), u('no, just do it')]),
      'deny.jsonl',
    ),
  );
  const m = toMoment(ex[1]);
  assert.equal(m.pile, 'decline', 'the recorded event still decides the pile');
  assert.deepEqual(m.denied, ['EnterPlanMode'], 'and the moment says WHICH tool was refused');
});

test('the pile is the recorded event: decline beats interrupt, a bare tool-use interrupt is ordinary', () => {
  const ex = (fields: Partial<Exchange>): Exchange => ({ reaction: 'r', hash: 'h', session: 's', ts: 't', prompt: 'p', said: '', ...fields });
  assert.equal(pileOf(ex({ interrupted: 'plain' })), 'interrupt');
  assert.equal(pileOf(ex({ declined: true })), 'decline');
  assert.equal(pileOf(ex({ declined: true, interrupted: 'plain' })), 'decline', 'an explicit rejection is the stronger signal');
  assert.equal(pileOf(ex({ interrupted: 'tool-use' })), 'ordinary', 'the tail of a permission flow is not a spontaneous correction');
  assert.equal(pileOf(ex({})), 'ordinary');
});

test('the reply is capped but replyLen tells the truth', () => {
  const wall = 'x'.repeat(2000);
  const ex = parseExchanges(join(roots('cap', [u('ask'), a('answer'), u(wall)]), 'cap.jsonl'));
  const m = toMoment(ex[1]);
  assert.ok(m.reply.length < wall.length, 'the stored reply is capped');
  assert.equal(m.replyLen, 2000, 'while the true length is kept — size is a signal the cap would hide');
});

// ── the store ─────────────────────────────────────────────────────────────────────────────────

test('buildMoments is idempotent — a second run with nothing new appends nothing', () => {
  const rdir = roots('idem', [u('first'), a('a1'), u('second'), a('a2'), u('third')]);
  const file = join(dir, 'idem.jsonl');
  const r1 = buildMoments({ roots: [rdir], file });
  assert.ok(r1.added > 0, 'the first run stores moments');
  const before = readFileSync(file, 'utf8');
  const r2 = buildMoments({ roots: [rdir], file });
  assert.equal(r2.added, 0, 'the second run adds nothing');
  assert.equal(readFileSync(file, 'utf8'), before, 'and does not rewrite the file');
});

test('appending is append — the second batch does not rewrite the first', () => {
  const file = join(dir, 'grow.jsonl');
  const r1 = roots('grow1', [u('one'), a('a'), u('two')]);
  buildMoments({ roots: [r1], file });
  const firstBatch = readFileSync(file, 'utf8');
  const r2 = roots('grow2', [u('three'), a('b'), u('four')]);
  buildMoments({ roots: [r1, r2], file });
  const grown = readFileSync(file, 'utf8');
  assert.ok(grown.startsWith(firstBatch), 'the original lines are untouched at the front');
  assert.ok(grown.length > firstBatch.length, 'the new batch is appended after them');
});

test('the result is the same whether pointed at one file or many — the seen-set decides, not the input', () => {
  const one = roots('multi1', [u('a1'), a('x'), u('b1')]);
  const two = roots('multi2', [u('a2'), a('y'), u('b2')]);
  const together = join(dir, 'together.jsonl');
  buildMoments({ roots: [one, two], file: together });
  const split = join(dir, 'split.jsonl');
  buildMoments({ roots: [one], file: split });
  buildMoments({ roots: [two], file: split });
  const keys = (f: string) => new Set(loadMoments(f).map((m) => m.key));
  assert.deepEqual([...keys(together)].sort(), [...keys(split)].sort(), 'same moments, whatever the walk order');
});

test('a torn last line is skipped on read and the moment re-derives — a crash mid-append self-heals', () => {
  const rdir = roots('torn', [u('first'), a('a1'), u('second')]);
  const file = join(dir, 'torn.jsonl');
  buildMoments({ roots: [rdir], file });
  const good = readFileSync(file, 'utf8').trimEnd();
  writeFileSync(file, good + '\n' + '{"key":"deadbeef","session":"s","ts":"t","pi'); // a torn append
  const loaded = loadMoments(file);
  assert.ok(!loaded.some((m) => m.key === 'deadbeef'), 'the torn line is not read as a moment');
  const r = buildMoments({ roots: [rdir], file });
  assert.equal(r.added, 0, 'nothing genuinely new — the real moments were all readable');
});

test('a replay does not duplicate — the same session under a live and an archived name is one pile', () => {
  // Two roots holding the SAME session content under DIFFERENT filenames — exactly the live-copy /
  // archived-copy shape. The content hash makes them one moment.
  const live = roots('sess-live', [u('ask'), a('answer'), u('react')]);
  const archived = roots('sess-arch', [u('ask'), a('answer'), u('react')]);
  const file = join(dir, 'replay.jsonl');
  const r = buildMoments({ roots: [live, archived], file });
  const keys = new Set(loadMoments(file).map((m) => m.key));
  // 2 exchanges per copy (opener + closed turn); deduped across the two copies to 2 distinct.
  assert.equal(keys.size, 2, 'the replay collapses to the distinct moments');
  assert.equal(r.added, keys.size);
});

test('a new session is found however its file sorts — no early stop can skip it', () => {
  // The bug an early-stop margin had: a new session whose file mtime sorts BEHIND many already-stored
  // sessions was silently skipped forever. Store several newer sessions, then add one with the OLDEST
  // mtime, deep behind them. It must still be picked up.
  const rdir = mkdtempSync(join(tmpdir(), 'stratless-order-'));
  const write = (name: string, tag: string, mtime: number) => {
    const p = join(rdir, `${name}.jsonl`);
    writeFileSync(p, [u(`ask ${tag}`), a(`ans ${tag}`), u(`react ${tag}`)].join('\n') + '\n');
    utimesSync(p, mtime, mtime);
  };
  const file = join(dir, 'order.jsonl');
  for (let i = 1; i <= 6; i++) write(`s${i}`, `t${i}`, 1000 * i); // 6 sessions, newest mtime 6000
  buildMoments({ roots: [rdir], file });
  write('late', 'LATE', 1); // brand new, oldest mtime — sorts dead last
  const r = buildMoments({ roots: [rdir], file });
  assert.ok(
    loadMoments(file).some((m) => m.reply.includes('LATE')),
    'the deep, old-mtime new session is stored — the walk reaches everything',
  );
  assert.equal(r.added, 2, 'its opener and closed turn, and nothing re-added from the others');
  rmSync(rdir, { recursive: true, force: true });
});

test('a MOMENTS_V mismatch rebuilds the pile instead of appending onto a stale shape', () => {
  const rdir = roots('ver', [u('one'), a('a'), u('two')]);
  const file = join(dir, 'ver.jsonl');
  buildMoments({ roots: [rdir], file });
  // Simulate an old-shape store: same file, but the version sidecar says something else.
  writeFileSync(`${file}.v`, '0\n');
  const stored = loadMoments(file).length;
  const r = buildMoments({ roots: [rdir], file });
  assert.equal(loadMoments(file).length, stored, 'the pile is the same size — rebuilt, not doubled');
  assert.equal(r.added, stored, 'every moment was re-derived, not appended to the old ones');
  assert.ok(existsSync(`${file}.v`), 'and the sidecar is stamped current');
});
