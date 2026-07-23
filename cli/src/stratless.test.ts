/**
 * The whole product is one claim: IT DOES NOT LIE.
 *
 * Every test below is a lie it actually told during development on 2026-07-14. They are not
 * hypotheticals — each one shipped, was caught by looking, and is pinned here so it can never
 * come back. A confidently-wrong answer, screenshotted by one stranger, ends this product.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';

import { parseSession, isRealPrompt } from './transcript.js';
import { runStreamBatch, SENTINEL_PREFIX } from './stream.js';
import { makePalette } from './palette.js';
import { shouldCheck, newerThan, dailyCheck, readNotify, writeNotify } from './notify.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseExchanges, loadRecentExchanges, findExchange, markFirstOfDay, projectOf, type Exchange } from './exchange.js';
import { atOf, didOf, ranOf, ranLine, contextLine, humanGap } from './facts.js';
import { injectProfile, removeProfile, ensureLoaded } from './sink.js';
import { readState, writeState, synthesisDue, readRenders, writeRender, readBuildCorpus, writeBuildCorpus } from './state.js';
import { readUsage, recordUsage } from './usage.js';
import { CorruptStoreError } from './atomic.js';
import { parseJsonResult } from './claude.js';
import { installStopHook, readSettings } from './init.js';
import { shuffleDeterministic, distractorsFor, buildTruthSet, renderSheet, renderSheetJson, scoreSheet, type Judgment } from './truth.js';

let dir: string;

/** A throwaway dir for fixtures. */
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'stratless-test-'));
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

// ── control actions: recorded facts, carried but never hashed ───────────────────────────────────

const interruptRec = (kind: 'plain' | 'tool-use' = 'plain') =>
  JSON.stringify({
    type: 'user',
    timestamp: '2026-07-01T10:00:03Z',
    message: { content: kind === 'tool-use' ? '[Request interrupted by user for tool use]' : '[Request interrupted by user]' },
  });
const denyRec = () =>
  JSON.stringify({ type: 'user', timestamp: '2026-07-01T10:00:03Z', toolDenialKind: 'user-rejected', message: { content: '' } });

// NOTE ON INDICES, and it applies to every fixture below. Since exchanges emit on the reaction
// alone, the FIRST human message of a transcript is itself an exchange — a session opener, with an
// empty prompt and an empty `said`. So `ex[0]` is the opener and the first CLOSED turn is `ex[1]`.
// Nothing about these tests changed except that arithmetic.

test('THE HASH IGNORES CONTROL ACTIONS — adding them must not orphan a cached judgment', () => {
  const plain = parseExchanges(writeTranscript('plain.jsonl', [u('why a queue?'), a('bursts outrun the worker'), u('ok that lands')].join('\n')));
  const withInt = parseExchanges(
    writeTranscript('withint.jsonl', [u('why a queue?'), a('bursts outrun the worker'), interruptRec(), u('ok that lands')].join('\n')),
  );
  assert.equal(plain.length, 2, 'the opener, then the closed turn');
  assert.equal(withInt.length, 2);
  assert.equal(withInt[1].hash, plain[1].hash, 'same words = same hash, whatever the person did with their hands');
  assert.equal(plain[1].interrupted, undefined);
  assert.equal(withInt[1].interrupted, 'plain', 'but the fact is carried');
});

test('the two interrupt kinds are distinguished, not merged', () => {
  const ex = parseExchanges(
    writeTranscript('kinds.jsonl', [u('run the deploy'), a('starting'), interruptRec('tool-use'), u('no, stop')].join('\n')),
  );
  assert.equal(ex[1].interrupted, 'tool-use', 'the permission-flow variant is not a spontaneous course correction');
});

test('a declined tool is recorded on the exchange it happened in', () => {
  const ex = parseExchanges(writeTranscript('deny.jsonl', [u('push it'), a('running git push'), denyRec(), u('not yet')].join('\n')));
  assert.equal(ex[1].declined, true);
});

test('control actions do not leak into the NEXT exchange', () => {
  const ex = parseExchanges(
    writeTranscript(
      'leak.jsonl',
      [u('first ask'), a('first answer'), interruptRec(), u('second ask'), a('second answer'), u('third')].join('\n'),
    ),
  );
  assert.equal(ex.length, 3, 'the opener plus two closed turns');
  assert.equal(ex[1].interrupted, 'plain', 'the interrupt belongs to the turn it happened in');
  assert.equal(ex[2].interrupted, undefined, 'and is cleared before the next one');
});

// ── THE FACTS: what the code knows for certain, carried as data (judge v2, 2026-07-20) ──────────
//
// Why these exist, measured: `interrupted` used to reach the judge ONLY as an English sentence in a
// "PERSON ALSO" line. Across the corpus, 140 exchanges carry a control action, 20 of them had been
// judged, and exactly ONE judgment mentions the fact — a 95% loss on the one signal in the product
// that is free, objective and certain. Facts now travel as fields. These tests pin that they do,
// and that adding one can never orphan a cached judgment.

const richUser = (text: string, ts: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'user', message: { content: text }, timestamp: ts, ...extra });

test('THE HASH IGNORES THE FACTS — project and branch must not orphan a cached judgment', () => {
  const words = ['why a queue?', 'bursts outrun the worker', 'ok that lands'];
  const bare = parseExchanges(
    writeTranscript('bare.jsonl', [u(words[0]), a(words[1]), u(words[2])].join('\n')),
  );
  const cwd = join(homedir(), 'stratless-mono', 'cli');
  const rich = parseExchanges(
    writeTranscript(
      'rich.jsonl',
      [
        richUser(words[0], '2026-07-01T10:00:00Z', { cwd, gitBranch: 'judge-v2' }),
        a(words[1]),
        richUser(words[2], '2026-07-01T10:00:09Z', { cwd, gitBranch: 'judge-v2' }),
      ].join('\n'),
    ),
  );
  assert.equal(rich[0].hash, bare[0].hash, 'same words = same hash, whatever we learned about the surroundings');
  assert.equal(rich[0].project, 'stratless-mono/cli', 'home-relative — the home directory never lands in the store');
  assert.equal(rich[0].branch, 'judge-v2');
  assert.equal(bare[0].project, undefined, 'and a transcript without them simply has none');
});

test('PROJECT LABELS MUST NOT COLLIDE — the basename version merged six directories into one', () => {
  const a1 = projectOf(join(homedir(), 'stratless-mono', 'cli', 'src'));
  const b1 = projectOf(join(homedir(), 'stratless', 'apps', 'web', 'src'));
  assert.notEqual(a1, b1, 'basename() called both of these "src" — a false grouping in the one field meant to group truly');
  assert.equal(projectOf(join(homedir(), 'a', 'b')), 'a/b');
  assert.equal(projectOf('/opt/elsewhere'), '/opt/elsewhere', 'a path outside HOME is kept whole rather than mangled');
});

test('position and rhythm are computed once the session is whole', () => {
  const ex = parseExchanges(
    writeTranscript(
      'pos.jsonl',
      [
        u('first ask', '2026-07-01T10:00:00Z'),
        a('first answer', '2026-07-01T10:00:05Z'),
        u('second ask', '2026-07-01T10:01:00Z'),
        a('second answer', '2026-07-01T10:01:05Z'),
        u('third ask', '2026-07-01T10:03:00Z'),
      ].join('\n'),
    ),
  );
  assert.equal(ex.length, 3, 'the opener plus two closed turns');
  assert.deepEqual(
    ex.map((e) => e.index),
    [0, 1, 2],
    'the judge could not tell the 1st exchange from the 259th; now it can',
  );
  assert.equal(ex[0].ofSession, 3);
  assert.equal(ex[0].gapSec, undefined, 'the first exchange has nothing to measure from — absent, never a fabricated 0');
  assert.equal(ex[1].gapSec, 60, 'a minute from the opener to the next reaction');
  assert.equal(ex[2].gapSec, 120, 'two minutes between one reaction and the next');
});

test('markFirstOfDay marks exactly one exchange per working day', () => {
  const list = [
    { ts: '2026-07-01T10:00:00Z' },
    { ts: '2026-07-01T12:00:00Z' },
    { ts: '2026-07-02T12:00:00Z' },
  ] as Exchange[];
  markFirstOfDay(list);
  assert.deepEqual(list.map((e) => e.firstOfDay), [true, undefined, true]);
});

test('the fact the judge dropped 19 times in 20 now travels as data, not prose', () => {
  const ex = parseExchanges(
    writeTranscript('fact.jsonl', [u('run the deploy'), a('starting'), interruptRec(), u('no, stop')].join('\n')),
  );
  assert.equal(didOf(ex[1])?.interrupted, 'plain', 'a field the model cannot decline to mention');
});

// ── SHOWING the facts to the judge (Block 2 piece 1) ────────────────────────────────────────────
//
// Recording a fact makes it unlosable; showing it makes the sentence better informed. Because the
// recording no longer depends on the model, this is purely additive — the tests below pin that an
// exchange which knows nothing renders EXACTLY as it always did, so nothing can regress.

test('the context line frames the moment: position, pause, project', () => {
  const ex = {
    ts: '2026-07-01T10:00:00Z',
    index: 39,
    ofSession: 118,
    gapSec: 264,
    project: 'stratless-mono/cli',
    branch: 'judge-v2',
  } as Exchange;
  assert.equal(contextLine(ex), 'exchange 40 of 118 · 4 min later · stratless-mono/cli (judge-v2)');
});

test('the start of a session says so instead of reporting a gap it does not have', () => {
  const ex = { ts: '2026-07-01T10:00:00Z', index: 0, ofSession: 12, firstOfDay: true } as Exchange;
  assert.equal(contextLine(ex), 'exchange 1 of 12 · start of the session · first of the day');
});

test('gaps are rounded to rhythm, not reported as false precision', () => {
  assert.equal(humanGap(45), '45s later');
  assert.equal(humanGap(264), '4 min later');
  assert.equal(humanGap(1982), '33 min later');
  assert.equal(humanGap(7200), '2 h later');
});

// ── THE ASSISTANT'S HANDS — the largest fact the judge was never given (57% of exchanges) ───────

const toolAsst = (text: string, tools: string[], ts = '2026-07-01T10:00:05Z') =>
  JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    message: { content: [{ type: 'text', text }, ...tools.map((name) => ({ type: 'tool_use', name, input: {} }))] },
  });

test('tools the assistant ran are carried, and do not change the hash', () => {
  const words = ['fix the parser', 'done', 'ok good'];
  const bare = parseExchanges(writeTranscript('notools.jsonl', [u(words[0]), a(words[1]), u(words[2])].join('\n')));
  const withTools = parseExchanges(
    writeTranscript('tools.jsonl', [u(words[0]), toolAsst(words[1], ['Edit', 'Bash', 'Edit']), u(words[2])].join('\n')),
  );
  assert.equal(withTools[1].hash, bare[1].hash, 'the facts never touch the cache key');
  assert.deepEqual(withTools[1].tools, ['Edit', 'Bash', 'Edit'], 'duplicates kept — they are the SIZE of the work');
  assert.equal(bare[1].tools, undefined);
  assert.deepEqual(ranOf(withTools[1]), { tools: ['Edit', 'Bash'], calls: 3 }, 'names deduped, calls counted');
  assert.equal(ranOf(bare[1]), undefined, 'a turn that only talked has no `ran` at all');
});

test('the assistant work line is neutral, and states size only when it adds something', () => {
  assert.equal(ranLine({ tools: ['Edit', 'Bash'], calls: 3 }), 'Edit · Bash (3 calls)');
  assert.equal(ranLine({ tools: ['Read'], calls: 1 }), 'Read', 'one call, one name — a count would be noise');
});

test('tools do not leak into the next exchange', () => {
  const ex = parseExchanges(
    writeTranscript(
      'toolleak.jsonl',
      [u('first'), toolAsst('a1', ['Edit']), u('second'), a('a2'), u('third')].join('\n'),
    ),
  );
  assert.equal(ex.length, 3, 'the opener plus two closed turns');
  assert.deepEqual(ex[1].tools, ['Edit']);
  assert.equal(ex[2].tools, undefined, 'reset with `said`, like every other per-turn fact');
});

test('empty facts are absent, never empty objects', () => {
  const bare = { prompt: 'p', said: 's', reaction: 'r', ts: '2026-07-01T10:00:00Z', session: 's', hash: 'h' } as Exchange;
  assert.equal(atOf(bare), undefined);
  assert.equal(didOf(bare), undefined, 'roughly 97% of exchanges carry no control action at all');
});

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
  // Three, not two: the SESSION OPENER now counts. It has no prompt and no assistant turn before
  // it, which used to disqualify it — but "how do i deploy" is a thing the person did, and setting
  // the agenda is one of the more informative things they do. The dangling last message is still
  // not an exchange: nothing closes it.
  assert.equal(ex.length, 3, 'two closed turns plus the opener; the dangling last message is not a fourth');
  assert.equal(ex[0].reaction, 'how do i deploy', 'the opener is a moment in its own right');
  assert.equal(ex[0].prompt, '', 'and it honestly has no prompt, rather than being dropped');
  assert.equal(ex[1].prompt, 'how do i deploy');
  assert.equal(ex[1].said, 'Push to main and it builds.');
  assert.equal(ex[1].reaction, 'wait what does that mean for us', 'the reaction carries the signal');
  assert.equal(ex[2].prompt, 'wait what does that mean for us', 'that same message opens the next turn');
});

test('a turn where the assistant only ran tools IS a moment — the person still did something', () => {
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
  // This test used to assert 0, on the judge's reasoning: no assistant words meant nothing
  // transferred, so there was nothing to judge. Discovery asks a different question — what did the
  // PERSON do — and a reply to work-in-progress is often the most informative moment there is.
  //
  // The loss was not evenly spread. Measured on the reference archive, the old condition dropped
  // 180 moments (3.7%) but 25 of 151 ANCHOR moments (16.6%): an interrupt is most likely to land
  // exactly while the assistant is mid-tool and has not spoken yet, so the filter was correlated
  // with the thing it was hiding.
  const ex = parseExchanges(p);
  assert.equal(ex.length, 2, 'the opener, and the reply to a turn that only ran tools');
  assert.equal(ex[1].reaction, 'did it work?');
  assert.equal(ex[1].said, '', 'said is honestly empty — the assistant had not spoken yet');
  assert.deepEqual(ex[1].tools, ['Edit'], 'and what it was DOING is carried instead');
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
  assert.equal(ex.length, 2, 'the opener, then one closed turn — the tool_result must not split it into two');
  assert.equal(ex[1].reaction, 'nice');
  assert.ok(ex[1].said.includes('Looking now') && ex[1].said.includes('off-by-one'), 'both assistant texts survive');
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
  // This asserted `length === 0` and passed for the WRONG REASON: the count was zero because no
  // assistant text survived the sidechain filter, so the old `prompt && saidText` condition
  // suppressed everything. It never actually checked that subagent chatter stays out.
  //
  // Both human messages ARE moments — the person really typed them. What must not happen is the
  // subagent's words appearing as something the assistant said to them.
  const ex = parseExchanges(p);
  assert.equal(ex.length, 2, 'the person spoke twice, and both are moments');
  for (const e of ex) assert.ok(!e.said.includes('subagent chatter'), 'a sidechain turn is not the person talking');
});

// The tail rule (0.2.4): the person reacts to the END of the assistant's turn, but a long turn used
// to be truncated from the head — so the judge read the preamble and then a reaction to a conclusion
// it never saw. Measured 2026-07-16: 83% of real turns exceeded the judge's view, 21% the parse cap.

test('a long assistant turn keeps its TAIL — the reaction pairs with the end of what was said', () => {
  const p = writeTranscript(
    'longsaid.jsonl',
    [u('explain the whole design'), a(`THE-OPENING ${'y'.repeat(8300)} THE-CONCLUSION`), u('got it')].join('\n'),
  );
  const ex = parseExchanges(p);
  assert.equal(ex.length, 2, 'the opener, then the closed turn');
  assert.ok(ex[1].said.includes('THE-CONCLUSION'), 'the end survives the cap');
  assert.ok(!ex[1].said.includes('THE-OPENING'), 'the head is what gets cut');
  assert.ok(ex[1].said.length <= 8000, 'the 0.3.0 identity cap holds (8k, raised inside the v2 bump)');
});

// ── the notifier: nothing ambient without consent — and the boundary is PROVABLE ───────────────

test('shouldCheck: the once-daily rule, pure, no network anywhere near it', () => {
  const now = new Date('2026-07-17T12:00:00Z');
  assert.equal(shouldCheck({}, now), true, 'never checked = check');
  assert.equal(shouldCheck({ checkedAt: '2026-07-17T02:00:00Z' }, now), false, '10 hours old = fresh, no check');
  assert.equal(shouldCheck({ checkedAt: '2026-07-16T02:00:00Z' }, now), true, '34 hours old = stale');
  assert.equal(shouldCheck({ checkedAt: 'garbage' }, now), true, 'unparseable = check (fail open, one lookup)');
});

test('newerThan: numeric dotted compare; unknowns are never newer', () => {
  assert.equal(newerThan('0.3.3', '0.3.2'), true);
  assert.equal(newerThan('0.3.2', '0.3.2'), false);
  assert.equal(newerThan('0.3.1', '0.3.2'), false, 'older is not newer');
  assert.equal(newerThan('0.10.0', '0.9.9'), true, 'numeric, not lexicographic');
  assert.equal(newerThan(undefined, '0.3.2'), false, 'no answer = no nag');
  assert.equal(newerThan('not-a-version', '0.3.2'), false, 'garbage = no nag');
});

test('THE CONSENT BOUNDARY: unarmed dailyCheck never touches the network — provably', async () => {
  const f = join(dir, 'notify-unarmed.json');
  const tripwire = () => {
    throw new Error('NETWORK CALL ON THE UNARMED PATH — the posture is broken');
  };
  const out = await dailyCheck('0.3.2', false, { fetcher: tripwire as never, file: f });
  assert.equal(out, undefined, 'unarmed = nothing, instantly');
  assert.deepEqual(readNotify(f), {}, 'and not even a cache write happened');
});

test('armed dailyCheck: fetches once a day, serves from cache between, nags only when newer', async () => {
  const f = join(dir, 'notify-armed.json');
  const now = new Date('2026-07-17T12:00:00Z');
  let fetches = 0;
  const fetcher = (async () => {
    fetches++;
    return { ok: true, json: async () => ({ version: '0.9.0' }) };
  }) as never;

  const first = await dailyCheck('0.3.2', true, { now, fetcher, file: f });
  assert.equal(first, '0.9.0', 'stale cache = fetch, and 0.9.0 > 0.3.2 nags');
  assert.equal(fetches, 1);

  const second = await dailyCheck('0.3.2', true, { now: new Date('2026-07-17T13:00:00Z'), fetcher, file: f });
  assert.equal(second, '0.9.0', 'within the day = served from cache');
  assert.equal(fetches, 1, 'NO second fetch — once daily means once daily');

  const upToDate = await dailyCheck('0.9.0', true, { now: new Date('2026-07-17T14:00:00Z'), fetcher, file: f });
  assert.equal(upToDate, undefined, 'already on latest = silence');
});

// ── the receipt machinery: prove any claim from its raw exchanges (the polish release) ─────────

test('findExchange dereferences a receipt session-targeted; a reaped transcript returns undefined', () => {
  const root = mkdtempSync(join(tmpdir(), 'stratless-receipt-'));
  const p = join(root, 'sess-abc123.jsonl');
  writeFileSync(p, `${[u('why a queue?'), a('because bursts arrive faster than the worker drains'), u('ok that lands')].join('\n')}\n`);
  const ex = parseExchanges(p)[1]; // [0] is the session opener
  assert.ok(ex, 'fixture parsed');
  const found = findExchange('sess-abc123', ex.hash, [root]);
  assert.equal(found?.reaction, 'ok that lands', 'the raw exchange comes back readable');
  assert.equal(findExchange('sess-abc123', 'not-a-real-hash', [root]), undefined, 'wrong hash = nothing invented');
  assert.equal(findExchange('reaped-session', ex.hash, [root]), undefined, 'missing transcript = the honest-failure path');
  rmSync(root, { recursive: true, force: true });
});

// ── looking is free: the render sidecar and the pre-spend count (the polish release) ───────────

test('renders sidecar: round-trips build facts; missing/corrupt = build path, never a fake header', () => {
  const f = join(dir, 'renders.json');
  assert.deepEqual(readRenders(f), {}, 'missing = no cached renderings');
  writeFileSync(f, 'junk {');
  assert.deepEqual(readRenders(f), {}, 'corrupt = no cached renderings, never a throw');
  writeRender('profile', { builtAt: '2026-07-17T10:00:00Z', sessions: 6, exchanges: 119 }, f);
  writeRender('report', { builtAt: '2026-07-17T11:00:00Z', sessions: 6, exchanges: 120 }, f);
  const r = readRenders(f);
  assert.equal(r.profile?.exchanges, 119, "the header's numbers come from the BUILD, stored not recomputed");
  assert.equal(r.report?.builtAt, '2026-07-17T11:00:00Z', 'each rendering keeps its own build facts');
});

test('renders history: profile builds accumulate newest-first, dedupe by stamp, cap at 5; categories round-trip', () => {
  const f = join(dir, 'history-renders.json');
  for (let i = 1; i <= 6; i++)
    writeRender('profile', { builtAt: `2026-07-2${i}T10:00:00Z`, sessions: 100 + i, exchanges: 5000 + i, categories: 20 + i }, f);
  writeRender('profile', { builtAt: '2026-07-26T10:00:00Z', sessions: 200, exchanges: 9999, categories: 30 }, f); // same stamp as i=6 → replace, not stack
  const h = readRenders(f).history ?? [];
  assert.equal(h.length, 5, 'capped at the five most recent builds');
  assert.equal(h[0].builtAt, '2026-07-26T10:00:00Z', 'newest first');
  assert.equal(h[0].exchanges, 9999, 'a same-stamp rebuild replaces the entry, never a duplicate');
  assert.equal(h[0].categories, 30, 'the category count rides along for the trajectory');
  assert.equal(h.filter((b) => b.builtAt === '2026-07-26T10:00:00Z').length, 1, 'deduped by stamp');
  assert.ok(!h.some((b) => b.builtAt === '2026-07-21T10:00:00Z'), 'the oldest build fell off the cap');
});

test('build corpus: the frozen corpus round-trips; the build stamp is the staleness key', () => {
  const f = join(dir, 'build.json');
  assert.equal(readBuildCorpus(f), undefined, 'missing = no frozen corpus (so `--read` guides to a build, never guesses)');
  writeFileSync(f, '{ not json');
  assert.equal(readBuildCorpus(f), undefined, 'corrupt = none, never a throw');
  const b = {
    builtAt: '2026-07-18T03:00:00Z',
    corpus: { sessions: 5, exchanges: 164, topics: ['deploys'], from: '2026-07-15', to: '2026-07-18' },
    signalHashes: ['aa', 'bb', 'cc'],
  };
  writeBuildCorpus(b, f);
  const got = readBuildCorpus(f);
  assert.equal(got?.builtAt, b.builtAt, 'the build stamp survives — `--read` is fresh iff it matches the profile build');
  assert.equal(got?.corpus.exchanges, 164, 'the corpus the read renders over is frozen, not recomputed');
  assert.deepEqual(got?.signalHashes, ['aa', 'bb', 'cc'], 'the exact signal membership round-trips (reloaded by hash, never re-judged)');
  writeFileSync(f, JSON.stringify({ builtAt: 'x', corpus: { sessions: 1 } }));
  assert.equal(readBuildCorpus(f), undefined, 'a corpus missing its counts or its hashes reads as none, never a half-truth');
});

// ── the palette: escapes only when a human eye is watching (clig + the NO_COLOR spec) ──────────

test('palette: per-stream TTY, NO_COLOR set-and-non-empty, TERM=dumb — bold/dim stripped too', () => {
  const clean = {} as NodeJS.ProcessEnv;
  assert.equal(makePalette({ isTTY: true }, clean).b('x'), '\x1b[1mx\x1b[0m', 'TTY + clean env = styled');
  assert.equal(makePalette({ isTTY: false }, clean).b('x'), 'x', 'piped = plain — bold stripped too (documented deviation)');
  assert.equal(makePalette({ isTTY: true }, { NO_COLOR: '1' }).dim('x'), 'x', 'NO_COLOR set-and-non-empty = plain');
  assert.equal(makePalette({ isTTY: true }, { NO_COLOR: '' }).b('x'), '\x1b[1mx\x1b[0m', 'NO_COLOR="" does NOT disable (spec nuance)');
  assert.equal(makePalette({ isTTY: true }, { TERM: 'dumb' }).ok('x'), 'x', 'TERM=dumb = plain');
});

test('a piped `status` run emits zero escape bytes (the audit gap, closed for real)', () => {
  const bin = fileURLToPath(new URL('./index.js', import.meta.url));
  const out = execFileSync('node', [bin, 'status'], { encoding: 'utf8' });
  assert.ok(!out.includes('\x1b'), 'stdout through a pipe carries no escape codes');
  assert.ok(out.includes('stratless status'), 'and the content itself still arrives');
});

// ── the streaming Brain (0.3.1): one harness, many verdicts — and never its own exhaust ────────

test('the exhaust sentinel: streamed prompts are invisible to the exchange parser', () => {
  assert.equal(isRealPrompt(`${SENTINEL_PREFIX}judge>\nPERSON ASKED: x`), false, 'a streamed judge turn is not the human');
  assert.equal(isRealPrompt(`${SENTINEL_PREFIX}audit>\nSTATEMENT: y`), false, 'a streamed audit turn is not the human');
  assert.equal(isRealPrompt('why do we need a queue?'), true, 'real prompts still pass');
});

/** A fake `claude` that speaks the stream-json protocol — executable, shebang'd, argv-ignoring. */
const mockBrain = (name: string, dieAfter = -1): string => {
  const p = join(dir, name);
  writeFileSync(
    p,
    `#!/usr/bin/env node
let buf = ''; let turn = 0;
process.stdin.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    turn++;
    if (${dieAfter} > 0 && turn > ${dieAfter}) process.exit(1);
    const msg = JSON.parse(line);
    if (!msg.message.content[0].text.startsWith('<stratless-')) process.exit(2); // sentinel enforced
    process.stdout.write(JSON.stringify({
      type: 'result', subtype: 'success',
      result: JSON.stringify({ verdict: 'none', topic: 'topic' + turn, behavior: 'behavior' + turn }),
      total_cost_usd: 0.001 * turn,
      usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 5, cache_read_input_tokens: 100 },
      modelUsage: { 'mock-model': { inputTokens: 10, outputTokens: 20, costUSD: 0.001 } },
    }) + '\\n');
  }
});
process.stdin.on('end', () => process.exit(0));
`,
  );
  chmodSync(p, 0o755);
  return p;
};

test('runStreamBatch: lockstep turns, per-session receipts, and rotation', async () => {
  const usageFile = join(dir, 'stream-usage.json');
  process.env.STRATLESS_USAGE = usageFile;
  try {
    const bin = mockBrain('mock-ok.js');
    const items = Array.from({ length: 5 }, (_, k) => ({ id: `h${k}`, prompt: `PERSON ASKED: q${k}` }));
    const out = await runStreamBatch(bin, {
      systemPrompt: 'rules',
      role: 'judge',
      feature: 'judge',
      items,
      maxTurnsPerSession: 3,
      turnTimeoutMs: 5000,
    });
    assert.equal(out.completed, 5, 'all turns complete across a rotation (3 + 2)');
    assert.equal(out.remaining.length, 0, 'nothing left for the fallback');
    assert.ok(out.results.get('h0')?.includes('topic1'), 'turn 1 answer routed to item 1');
    assert.ok(out.results.get('h4')?.includes('topic2'), 'rotation resets the mock — session 2 turn 2 routed to item 5');
    const u = readUsage(usageFile);
    assert.equal(u.calls, 2, 'two sessions = two meter entries (a session is one borrowed process)');
    assert.ok(u.cacheReadTokens > 0, 'stream receipts carry cache tokens');
    assert.ok(u.byModel['mock-model'], 'per-model truth survives streaming');
  } finally {
    delete process.env.STRATLESS_USAGE;
  }
});

test('runStreamBatch: a dying session hands the remainder to the fallback ladder', async () => {
  const usageFile = join(dir, 'stream-usage-2.json');
  process.env.STRATLESS_USAGE = usageFile;
  try {
    const bin = mockBrain('mock-die.js', 2);
    const items = Array.from({ length: 5 }, (_, k) => ({ id: `h${k}`, prompt: `q${k}` }));
    const out = await runStreamBatch(bin, {
      systemPrompt: 'rules',
      role: 'judge',
      feature: 'judge',
      items,
      maxTurnsPerSession: 10,
      turnTimeoutMs: 3000,
    });
    assert.equal(out.completed, 2, 'the two completed turns survive the crash');
    assert.equal(out.remaining.length, 3, 'the remainder goes to the per-call fallback — never lost, never guessed');
    assert.ok(out.streamed, 'partial success still counts as streamed');
  } finally {
    delete process.env.STRATLESS_USAGE;
  }
});

// ── the miner's code half: THE MODEL NAMES, THE CODE COUNTS ───────────────────────────────────
//
// Everything numeric or temporal on a Pattern comes from aggregate() and only from there — the
// model never touches a number it could hallucinate. Receipts are Law 2 made a field: evidence
// that doesn't resolve to a real judgment is dropped where receipts are born.

// ── the grader (0.3.2): every pattern is a dated prediction; misses are the best signal ────────

test('HUMAN.md carries the person-layer schema marker (0.3.1: the sectioned protocol)', () => {
  const humanMd = join(dir, 'HUMAN-schema.md');
  const claudeMd = join(dir, 'CLAUDE-schema.md');
  injectProfile('WHAT THEY KNOW\nbackend architecture', humanMd, claudeMd);
  assert.ok(readFileSync(humanMd, 'utf8').includes('<!-- humanmd/v1 -->'), 'the protocol version is declared in the artifact');
});

// ── the promise layer: a wrong frequency is a lie wearing precision ───────────────────────────

// ── sink: the load step ─────────────────────────────────────────────────────────────────────
//
// The load writes the profile to the canonical HUMAN.md and points CLAUDE.md at it with an @import.
// It owns ONLY the text between its two markers in CLAUDE.md — a wrong upsert would silently eat
// someone's real instructions — and it must never inline the profile back into CLAUDE.md.

test("injectProfile writes HUMAN.md and points CLAUDE.md at it, leaving the person's content untouched", () => {
  const humanMd = join(dir, 'HUMAN.md');
  const claudeMd = join(dir, 'CLAUDE.md');
  writeFileSync(claudeMd, '# My own notes\nkeep this line\n');

  injectProfile('first profile', humanMd, claudeMd);

  assert.ok(readFileSync(humanMd, 'utf8').includes('first profile'), 'the profile lands in HUMAN.md');
  const doc = readFileSync(claudeMd, 'utf8');
  assert.ok(doc.includes('# My own notes') && doc.includes('keep this line'), "the person's content survives");
  assert.ok(doc.includes('stratless:start'), 'our managed block is added');
  assert.ok(/@\S*HUMAN\.md/.test(doc), 'CLAUDE.md points at HUMAN.md via @import');
  assert.ok(!doc.includes('first profile'), 'the profile is NOT inlined into CLAUDE.md — it is a redirect');
});

test('injectProfile stamps a readable UTC build time into HUMAN.md so a reader can tell the version', () => {
  const humanMd = join(dir, 'HUMAN-stamp.md');
  const claudeMd = join(dir, 'CLAUDE-stamp.md');
  injectProfile('stamped profile', humanMd, claudeMd, '2026-07-23T12:28:56.777Z');
  const human = readFileSync(humanMd, 'utf8');
  assert.ok(human.includes('# built 2026-07-23 12:28 UTC'), 'the header carries a globalized UTC version stamp');
  assert.ok(human.indexOf('# built') < human.indexOf('stamped profile'), 'the stamp sits in the header, above the body');
});

test('re-running injectProfile rewrites HUMAN.md and keeps exactly one CLAUDE.md block', () => {
  const humanMd = join(dir, 'HUMAN-2.md');
  const claudeMd = join(dir, 'CLAUDE-2.md');
  writeFileSync(claudeMd, '# mine\n');

  injectProfile('the-first-profile', humanMd, claudeMd);
  injectProfile('the-second-profile', humanMd, claudeMd);

  const human = readFileSync(humanMd, 'utf8');
  assert.ok(human.includes('the-second-profile') && !human.includes('the-first-profile'), 'HUMAN.md is replaced, not stacked');
  const doc = readFileSync(claudeMd, 'utf8');
  assert.ok(doc.includes('# mine'), 'their content still survives the update');
  assert.equal(doc.match(/stratless:start/g)?.length, 1, 'exactly one managed block, ever');
});

test('injectProfile creates both files (and parent dirs) if absent', () => {
  const humanMd = join(dir, 'nested', 'HUMAN.md');
  const claudeMd = join(dir, 'nested', 'CLAUDE.md');
  injectProfile('hello', humanMd, claudeMd);
  assert.ok(readFileSync(humanMd, 'utf8').includes('hello'), 'HUMAN.md created');
  assert.ok(/@\S*HUMAN\.md/.test(readFileSync(claudeMd, 'utf8')), 'CLAUDE.md created with the redirect');
});

// `stop` must be a true off-switch: unload the profile from CLAUDE.md, but never eat the person's own
// content, and never touch HUMAN.md (their data is theirs to keep).

test('removeProfile strips only our block and keeps the person\'s content', () => {
  const humanMd = join(dir, 'HUMAN-rm.md');
  const claudeMd = join(dir, 'CLAUDE-rm.md');
  writeFileSync(claudeMd, '# mine\nkeep me\n');
  injectProfile('a profile', humanMd, claudeMd);
  assert.ok(readFileSync(claudeMd, 'utf8').includes('stratless:start'), 'precondition: block present');

  assert.equal(removeProfile(claudeMd), true, 'reports the removal');
  const doc = readFileSync(claudeMd, 'utf8');
  assert.ok(doc.includes('# mine') && doc.includes('keep me'), 'the person\'s content survives');
  assert.ok(!doc.includes('stratless:start') && !doc.includes('stratless:end'), 'the block is gone');
});

test('removeProfile leaves HUMAN.md untouched', () => {
  const humanMd = join(dir, 'HUMAN-keep.md');
  const claudeMd = join(dir, 'CLAUDE-keep.md');
  injectProfile('keep this profile', humanMd, claudeMd);
  removeProfile(claudeMd);
  assert.ok(readFileSync(humanMd, 'utf8').includes('keep this profile'), 'HUMAN.md still holds the profile');
});

test('removeProfile is a safe no-op with no block (or no file)', () => {
  const claudeMd = join(dir, 'CLAUDE-noblock.md');
  writeFileSync(claudeMd, '# just mine\n');
  assert.equal(removeProfile(claudeMd), false, 'nothing to remove');
  assert.equal(readFileSync(claudeMd, 'utf8'), '# just mine\n', 'file left untouched');
  assert.equal(removeProfile(join(dir, 'does-not-exist.md')), false, 'missing file is a no-op');
});

// ── the synthesis gate: sessions accumulate, the profile consumes in batches ──────────────────
//
// The synthesis is the expensive read (~32 judge calls' worth, measured 2026-07-16). The gate is
// what keeps the after-session hook cheap: due on K new judgments, on the staleness backstop, on a
// cache reset, or on first build. Missing/corrupt state fails OPEN — one extra synthesis, never a
// stuck-stale profile.

test('ensureLoaded re-points CLAUDE.md at an existing HUMAN.md without rewriting it', () => {
  const humanMd = join(dir, 'HUMAN-ens.md');
  const claudeMd = join(dir, 'CLAUDE-ens.md');
  injectProfile('the profile', humanMd, claudeMd);
  removeProfile(claudeMd); // `stop` unloads
  const before = readFileSync(humanMd, 'utf8');

  assert.equal(ensureLoaded(humanMd, claudeMd), true, 'an existing HUMAN.md can be re-pointed');
  assert.ok(readFileSync(claudeMd, 'utf8').includes('stratless:start'), 'the block is back');
  assert.equal(readFileSync(humanMd, 'utf8'), before, 'HUMAN.md untouched — no synthesis spent');

  assert.equal(ensureLoaded(join(dir, 'HUMAN-missing.md'), claudeMd), false, 'no HUMAN.md = nothing to load');
});

// ── usage + status: the "least wasteful" claim must be checkable ──────────────────────────────
//
// `status` shows what the borrowed `claude` has cost. If the tally lied — over-counted, or crashed
// on a corrupt file mid-judge — the one number that backs the whole "least wasteful" pitch is worse
// than useless. Recording must accumulate honestly and must NEVER throw into a judge call.

const ZERO_USAGE = {
  calls: 0,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  unmeteredCalls: 0,
  pinEscapedCalls: 0,
  byFeature: {},
  byModel: {},
};

test('recordUsage accumulates calls, cost, and tokens; a missing file reads as zero', () => {
  const f = join(dir, 'usage.json');
  assert.deepEqual(readUsage(f), ZERO_USAGE, 'missing = zero');
  recordUsage({ costUsd: 0.01, inputTokens: 100, outputTokens: 20 }, f);
  recordUsage({ costUsd: 0.02, inputTokens: 50, outputTokens: 10 }, f);
  const t = readUsage(f);
  assert.equal(t.calls, 2, 'one increment per call');
  assert.ok(Math.abs(t.costUsd - 0.03) < 1e-9, 'cost sums');
  assert.equal(t.inputTokens, 150);
  assert.equal(t.outputTokens, 30);
});

test('readUsage on a corrupt file reads as zero and never throws', () => {
  const f = join(dir, 'usage-corrupt.json');
  writeFileSync(f, 'not json {');
  assert.deepEqual(readUsage(f), ZERO_USAGE);
});

// v2 (0.2.4): the meter must count the WHOLE story. The harness overhead every borrowed call
// carries (~17–24k tokens) arrives as cache tokens — v1 dropped them, so the ledger showed 484
// input tokens where reality was over a million. And without the judge/synthesis split, the
// discovery that one synthesis costs ~32 judge calls was invisible to our own meter.

test('the meter counts cache tokens and keeps per-feature and per-model buckets', () => {
  const f = join(dir, 'usage-v2.json');
  recordUsage(
    {
      costUsd: 0.02,
      inputTokens: 10,
      cacheCreationTokens: 7000,
      cacheReadTokens: 17000,
      feature: 'judge',
      byModel: { 'claude-haiku-4-5': { costUsd: 0.02, inputTokens: 10, cacheCreationTokens: 7000, cacheReadTokens: 17000 } },
    },
    f,
  );
  recordUsage(
    {
      costUsd: 0.12,
      outputTokens: 5000,
      feature: 'synthesis',
      byModel: { 'claude-sonnet-5': { costUsd: 0.12, outputTokens: 5000 } },
    },
    f,
  );
  const t = readUsage(f);
  assert.equal(t.cacheCreationTokens, 7000, 'cache-creation counted — the harness overhead is real consumption');
  assert.equal(t.cacheReadTokens, 17000, 'cache-read counted');
  assert.equal(t.byFeature.judge.calls, 1, 'the judge bucket exists');
  assert.ok(Math.abs(t.byFeature.synthesis.costUsd - 0.12) < 1e-9, 'the judge/synthesis split is visible');
  assert.equal(t.byModel['claude-haiku-4-5'].cacheReadTokens, 17000, 'per-model truth survives');
  assert.equal(t.byModel['claude-sonnet-5'].outputTokens, 5000);
});

test('a v1 usage.json (0.2.3) upgrades in place — the old tally is never lost', () => {
  const f = join(dir, 'usage-v1.json');
  writeFileSync(f, JSON.stringify({ calls: 50, costUsd: 2.06, inputTokens: 484, outputTokens: 53170 }));
  const t = readUsage(f);
  assert.equal(t.calls, 50, 'v1 totals survive');
  assert.equal(t.cacheCreationTokens, 0, 'missing v1 fields read as zero, never NaN');
  assert.deepEqual(t.byFeature, {}, 'no buckets yet');
  recordUsage({ costUsd: 0.02, cacheReadTokens: 17000, feature: 'judge' }, f);
  const t2 = readUsage(f);
  assert.equal(t2.calls, 51, 'recording on top of a v1 file just works');
  assert.equal(t2.byFeature.judge.cacheReadTokens, 17000);
});

test('parseJsonResult reads the full receipt: cache tokens and the per-model truth', () => {
  // The shape below is a real `claude -p --output-format json` receipt (measured 2026-07-16).
  const raw = JSON.stringify({
    result: 'transferred — batching — acknowledged and moved on',
    total_cost_usd: 0.0195,
    usage: { input_tokens: 10, output_tokens: 272, cache_creation_input_tokens: 7727, cache_read_input_tokens: 17370 },
    modelUsage: {
      'claude-haiku-4-5-20251001': {
        inputTokens: 923,
        outputTokens: 286,
        cacheReadInputTokens: 17370,
        cacheCreationInputTokens: 7727,
        costUSD: 0.019544,
      },
    },
  });
  const p = parseJsonResult(raw);
  assert.ok(p, 'a well-formed receipt parses');
  assert.equal(p.usage.cacheCreationTokens, 7727, 'cache-creation extracted — v1 dropped this');
  assert.equal(p.usage.cacheReadTokens, 17370, 'cache-read extracted');
  assert.equal(p.usage.byModel?.['claude-haiku-4-5-20251001']?.cacheReadTokens, 17370, 'the model that ACTUALLY ran');
  assert.ok(Math.abs((p.usage.byModel?.['claude-haiku-4-5-20251001']?.costUsd ?? 0) - 0.019544) < 1e-9);
});

test('recordUsage tolerates missing fields — a JSON payload without usage still counts the call', () => {
  const f = join(dir, 'usage-partial.json');
  recordUsage({}, f); // e.g. plain-text fallback: we know a call happened, nothing else
  const t = readUsage(f);
  assert.equal(t.calls, 1);
  assert.equal(t.costUsd, 0);
});


// ── judgment v2: strict FORM guaranteed in code, free VOCABULARY in the fields ─────────────────

// ── the recent-window loader: it must NOT read the whole history ──────────────────────────────
//
// 0.2.2 hung machines because the load read+parsed the ENTIRE archive (gigabytes) into memory before
// keeping only the last 200. `loadRecentExchanges` reads newest transcripts first and stops. These pin
// both halves: it returns the correct recent window, AND it stops early instead of touching the corpus.

test('loadRecentExchanges returns the newest `want` exchanges, oldest-first, windowed', () => {
  const rdir = mkdtempSync(join(tmpdir(), 'stratless-recent-'));
  const session = (name: string, tag: string, ts: string, mtime: number) => {
    const p = join(rdir, name);
    writeFileSync(p, `${[u(`ask ${tag}`, ts), a(`answer ${tag}`, ts), u(`react ${tag}`, ts)].join('\n')}\n`);
    utimesSync(p, mtime, mtime); // control the newest-first (mtime) order
  };
  session('s1.jsonl', 'one', '2026-07-01T10:00:00Z', 1000);
  session('s2.jsonl', 'two', '2026-07-02T10:00:00Z', 2000);
  session('s3.jsonl', 'three', '2026-07-03T10:00:00Z', 3000);
  session('s4.jsonl', 'four', '2026-07-04T10:00:00Z', 4000);

  // Each session now yields TWO exchanges — its opener (`ask N`) and its closed turn (`react N`) —
  // so a window of 4 spans the two newest sessions rather than four.
  const got = loadRecentExchanges(4, [rdir]);
  assert.equal(got.length, 4, 'windowed to `want`, not the whole archive');
  assert.equal(got[0].reaction, 'ask three', 'oldest of the window comes first');
  assert.equal(got[3].reaction, 'react four', 'newest last');
  assert.ok(!got.some((e) => e.reaction === 'react one'), 'the older sessions are dropped');
  rmSync(rdir, { recursive: true, force: true });
});

test('loadRecentExchanges STOPS at the recent window — it never opens the archive tail', () => {
  const rdir = mkdtempSync(join(tmpdir(), 'stratless-stop-'));
  const session = (name: string, tag: string, mtime: number) => {
    const p = join(rdir, name);
    writeFileSync(p, `${[u(`ask ${tag}`), a(`answer ${tag}`), u(`react ${tag}`)].join('\n')}\n`);
    utimesSync(p, mtime, mtime);
  };
  session('new1.jsonl', 'new1', 9000); // newest by mtime — these fill the window
  session('new2.jsonl', 'new2', 8000);
  // OLD by mtime but with a FUTURE ts: a whole-archive read would pull it in; because the loader
  // stops at the recent window (margin 0 here), it never even opens this file.
  const old = join(rdir, 'ancient.jsonl');
  writeFileSync(old, `${[u('ask sneaky', '2099-01-01T00:00:00Z'), a('answer sneaky', '2099-01-01T00:00:00Z'), u('react sneaky', '2099-01-01T00:00:00Z')].join('\n')}\n`);
  utimesSync(old, 1, 1); // oldest mtime

  const got = loadRecentExchanges(2, [rdir], { fileMargin: 0 });
  assert.equal(got.length, 2);
  assert.ok(!got.some((e) => e.reaction === 'react sneaky'), 'stopped at the window — the old-mtime file was never read');
  rmSync(rdir, { recursive: true, force: true });
});

// ── install = alive: `init` arms the after-session hook. It must add the hook exactly once (never a
//    duplicate) in the form `status`/`stop` detect, and never clobber a hand-edited settings.json. ──

test('installStopHook adds the refresh once, idempotently, in the form `status`/`stop` detect', () => {
  const settings: { hooks?: { Stop?: unknown[] } } = {};
  assert.equal(installStopHook(settings), true, 'first call installs it');
  assert.ok(JSON.stringify(settings.hooks?.Stop).includes('stratless update'), 'the hook runs `stratless update`');
  assert.equal(installStopHook(settings), false, 'second call is a no-op — never a duplicate');
  assert.equal(settings.hooks?.Stop?.length, 1, 'exactly one Stop group, ever');
});

// ── a hand-edited settings.json must never crash init, and must NEVER be silently overwritten ──

test('readSettings: a malformed settings.json reads as not-ok, never a throw', () => {
  const p = join(dir, 'settings-broken.json');
  writeFileSync(p, '{ "cleanupPeriodDays": 30, }'); // the classic hand-edit: a trailing comma
  const read = readSettings(p);
  assert.equal(read.ok, false, 'malformed JSON is reported, not thrown');
  assert.equal(read.settings, undefined, 'no half-parsed settings to accidentally write back');
});

test('readSettings: a missing settings.json is ok and empty — first run on a fresh machine', () => {
  const read = readSettings(join(dir, 'settings-nowhere.json'));
  assert.equal(read.ok, true);
  assert.deepEqual(read.settings, {});
});

test('readSettings: a valid settings.json comes back parsed, untouched', () => {
  const p = join(dir, 'settings-good.json');
  writeFileSync(p, JSON.stringify({ cleanupPeriodDays: 30, hooks: { Stop: [] } }));
  const read = readSettings(p);
  assert.equal(read.ok, true);
  assert.equal(read.settings.cleanupPeriodDays, 30);
});


// ── THE TRUTH TEST — the first instrument that asks whether a judgment is RIGHT ─────────────────
//
// Everything else measures whether the machinery works. These pin the properties that make a SCORE
// mean something: a rigged sheet, an unreproducible shuffle, or a decoy from the same conversation
// would each produce a number that looks like evidence and is not.

const jm = (o: Partial<Judgment> & { hash: string }): Judgment =>
  ({ ts: '2026-07-01T10:00:00Z', session: 's1', behavior: `did thing ${o.hash}`, ...o }) as Judgment;

test('the shuffle is reproducible, and differs between items', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(shuffleDeterministic(items, 'seed-1'), shuffleDeterministic(items, 'seed-1'), 'same seed = same sheet, so a score can be re-checked');
  assert.notDeepEqual(shuffleDeterministic(items, 'seed-1'), shuffleDeterministic(items, 'seed-2'), 'different items must not share an ordering');
  assert.deepEqual([...shuffleDeterministic(items, 'x')].sort(), items, 'nothing is lost or invented');
});

test('DECOYS NEVER COME FROM THE TARGET\'S OWN SESSION', () => {
  const target = jm({ hash: 't', session: 'same', at: { project: 'p' } });
  const pool = [
    target,
    jm({ hash: 'x1', session: 'same', at: { project: 'p' } }),
    jm({ hash: 'x2', session: 'same', at: { project: 'p' } }),
    jm({ hash: 'ok1', session: 'other', at: { project: 'p' } }),
    jm({ hash: 'ok2', session: 'other2', at: { project: 'p' } }),
  ];
  const d = distractorsFor(target, pool);
  assert.equal(d.length, 2);
  assert.ok(d.every((j) => j.session !== 'same'), 'a judgment from the same conversation may describe the SAME act — a wrong answer could be right');
  assert.ok(d.every((j) => j.hash !== 't'), 'and never the target itself');
});

test('decoys prefer the same project, so subject matter cannot give the answer away', () => {
  const target = jm({ hash: 't', session: 's1', at: { project: 'stratless-mono/cli' } });
  const pool = [
    target,
    jm({ hash: 'near1', session: 's2', at: { project: 'stratless-mono/cli' } }),
    jm({ hash: 'near2', session: 's3', at: { project: 'stratless-mono/cli' } }),
    jm({ hash: 'far1', session: 's4', at: { project: 'some-other-repo' } }),
  ];
  assert.deepEqual(distractorsFor(target, pool).map((j) => j.hash).sort(), ['near1', 'near2']);
});

test('a question that cannot get two decoys is DROPPED, not shipped with a different baseline', () => {
  const ex = () => ({ prompt: 'p', said: 's', reaction: 'r' });
  const thin = [jm({ hash: 'a', session: 's1' }), jm({ hash: 'b', session: 's1' })]; // same session: no legal decoys
  assert.equal(buildTruthSet(thin, ex, { n: 2 }).length, 0, 'a 2-way question has a 50% baseline and would corrupt the arithmetic');
});

test('THE SHEET NEVER LEAKS THE ANSWER', () => {
  const pool = Array.from({ length: 9 }, (_, i) => jm({ hash: `h${i}`, session: `s${i}`, at: { project: 'p' }, behavior: `behavior number ${i}` }));
  const items = buildTruthSet(pool, () => ({ prompt: 'what about X', said: 'a long answer', reaction: 'go' }), { n: 3 });
  assert.ok(items.length >= 1);
  const sheet = renderSheet(items);
  for (const it of items) {
    assert.ok(!sheet.includes(it.hash), 'no hash in the sheet');
    assert.ok(sheet.includes(it.candidates[it.answer]), 'the true sentence is present…');
    assert.equal(sheet.includes(`**${'ABC'[it.answer]}.** ${it.candidates[it.answer]}\n\n**Answer:** ${'ABC'[it.answer]}`), false, '…but never pre-filled');
  }
  assert.ok(!/answer[^:]*:\s*[ABC]\b/i.test(sheet.replace(/\*\*Answer:\*\* $/gm, '')), 'no answer key anywhere in the rendered sheet');
});

test('QUOTES ARE MASKED IN EVERY CANDIDATE — the first dry run was solvable by string matching', () => {
  const pool = [
    jm({ hash: 't', session: 's1', at: { project: 'p' }, behavior: `said 'yes go check the container limits' and escalated` }),
    jm({ hash: 'd1', session: 's2', at: { project: 'p' }, behavior: `asked "what about the schema" first` }),
    jm({ hash: 'd2', session: 's3', at: { project: 'p' }, behavior: 'redirected to the parser without quoting anything' }),
  ];
  const [item] = buildTruthSet(pool, () => ({ prompt: 'containers for ffmpeg?', said: 'yes', reaction: 'yes go check the container limits' }), { n: 1 });
  assert.ok(item, 'a question was built');
  assert.ok(!item.candidates.some((c) => c.includes('yes go check the container limits')), 'the reaction is never repeated back inside a candidate');
  assert.ok(item.candidates.some((c) => c.includes("'…'")), 'the leaky quote is masked…');
  assert.ok(item.candidates.some((c) => c.includes('"…"')), '…and so is a DECOY\'s quote, so the mask is not itself a tell');
});

test('the fillable JSON carries no key and ships the answer field EMPTY', () => {
  const pool = Array.from({ length: 9 }, (_, i) => jm({ hash: `j${i}`, session: `s${i}`, at: { project: 'p' }, behavior: `behavior ${i}` }));
  const items = buildTruthSet(pool, () => ({ prompt: 'q', said: 'a', reaction: 'r' }), { n: 3 });
  const parsed = JSON.parse(renderSheetJson(items)) as { questions: Record<string, string>[] };
  assert.equal(parsed.questions.length, items.length);
  for (const q of parsed.questions) assert.equal(q.answer, '', 'a pre-filled answer would be an invitation to agree');
  for (const it of items) assert.ok(!renderSheetJson(items).includes(it.hash), 'no hash, so the key cannot be re-derived from the sheet');
  assert.equal(JSON.stringify(parsed).includes('"answerIndex"') || JSON.stringify(parsed).includes('"distractorHashes"'), false, 'no key fields leak into the fillable shape');
});

test('scoring: accuracy is against ANSWERED items, and "none of these" is counted apart', () => {
  const items = [
    { hash: 'a', prompt: '', said: '', reaction: '', candidates: ['x', 'y', 'z'], answer: 0, distractorHashes: [] },
    { hash: 'b', prompt: '', said: '', reaction: '', candidates: ['x', 'y', 'z'], answer: 1, distractorHashes: [] },
    { hash: 'c', prompt: '', said: '', reaction: '', candidates: ['x', 'y', 'z'], answer: 2, distractorHashes: [] },
    { hash: 'd', prompt: '', said: '', reaction: '', candidates: ['x', 'y', 'z'], answer: 0, distractorHashes: [] },
  ];
  const s = scoreSheet(items, ['A', 'B', 'A', '-']);
  assert.equal(s.correct, 2, 'A and B land; the third picked A where C was right');
  assert.equal(s.none, 1, '"none of these fit" is a MISCHARACTERISATION signal, not a wrong guess');
  assert.equal(s.answered, 3, 'and it is excluded from the denominator');
  assert.ok(Math.abs(s.accuracy - 2 / 3) < 1e-9);
  assert.ok(Math.abs(s.chance - 1 / 3) < 1e-9, 'the baseline the score must beat to mean anything');
});

// ── SHAPE + lastOfSession: the fact the truth test asked for ────────────────────────────────────
//
// Sun, 2026-07-20, on why he asks for a double-check: "(1) im lazy to review the code because the
// task is too complex, i could not follow, so i just blindly trust AI to do the work AND review
// it. (2) or when the work done has doubts." Identical words, opposite states, opposite correct
// responses. The judge recorded every one as (2). Shape is the observable difference — and unlike
// the state itself it is arithmetic, so no model is asked to guess.

test('shape records TRUE lengths, taken before the 8k cap', () => {
  const big = 'x'.repeat(9000);
  const ex = parseExchanges(writeTranscript('shape.jsonl', [u('short ask'), a(big), u('go')].join('\n')));
  assert.equal(ex[1].shape?.ask, 9, 'the ask');
  assert.equal(ex[1].shape?.said, 9000, 'the real size of the answer, not the capped 8000');
  assert.equal(ex[1].shape?.reply, 2, 'and the reply');
  assert.equal(ex[1].said.length, 8000, 'while the TEXT is still capped for the hash and the view');
});

test('the generic-ask-after-a-long-answer shape is visible in the data', () => {
  const ex = parseExchanges(
    writeTranscript('states.jsonl', [
      u('fix the parser'),
      a('x'.repeat(4000)),
      u('double check the work done'),
      a('verified'),
      u('double check the token expiry in auth.ts, i think it is wrong'),
    ].join('\n')),
  );
  assert.equal(ex.length, 3, 'the opener plus the two closed turns');
  const [, lost, doubting] = ex;
  assert.ok(lost.shape!.said / lost.shape!.reply > 100, 'a long answer met with a short generic ask');
  assert.ok(doubting.shape!.reply > lost.shape!.reply, 'versus a longer, specific one');
});

test('lastOfSession marks the closing act, and only it', () => {
  const ex = parseExchanges(
    writeTranscript('close.jsonl', [u('first'), a('a1'), u('second'), a('a2'), u('third')].join('\n')),
  );
  assert.equal(ex.length, 3, 'the opener plus two closed turns');
  assert.equal(ex[0].lastOfSession, undefined);
  assert.equal(ex[1].lastOfSession, undefined);
  assert.equal(ex[2].lastOfSession, true, '"ended it here" was invisible before this');
  assert.equal(atOf(ex[2])?.lastOfSession, true, 'and it reaches the judgment');
});

test('shape and lastOfSession do not change the hash', () => {
  const words = [u('why a queue?'), a('bursts outrun the worker'), u('ok')].join('\n');
  const one = parseExchanges(writeTranscript('h1.jsonl', words));
  const two = parseExchanges(writeTranscript('h2.jsonl', words));
  assert.ok(one[0].shape, 'shape is present');
  assert.equal(one[0].hash, two[0].hash, 'same words = same hash, facts and all');
});
