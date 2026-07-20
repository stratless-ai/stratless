/**
 * The whole product is one claim: IT DOES NOT LIE.
 *
 * Every test below is a lie it actually told during development on 2026-07-14. They are not
 * hypotheticals — each one shipped, was caught by looking, and is pinned here so it can never
 * come back. A confidently-wrong answer, screenshotted by one stranger, ends this product.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';

import { parseSession, isRealPrompt } from './transcript.js';
import { runStreamBatch, SENTINEL_PREFIX } from './stream.js';
import { makePalette } from './palette.js';
import { shouldCheck, newerThan, dailyCheck, readNotify, writeNotify } from './notify.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseExchanges, loadRecentExchanges, findExchange } from './exchange.js';
import { injectProfile, removeProfile, ensureLoaded } from './sink.js';
import { readState, writeState, synthesisDue, readRenders, writeRender, readBuildCorpus, writeBuildCorpus } from './state.js';
import { pendingCount, PIPELINE_V as PV } from './judge.js';
import {
  aggregate,
  computeTrend,
  computeStability,
  loadPatterns,
  savePatterns,
  parseMineOutput,
  parseAuditOutput,
  parseGradeOutput,
  classifyGrade,
  shouldFlag,
  timeTag,
  displayOrder,
  matchReceiptPrefix,
  type GradeRecord,
  type PatternStore,
} from './miner.js';
import { readUsage, recordUsage } from './usage.js';
import { CorruptStoreError } from './atomic.js';
import { parseJsonResult } from './claude.js';
import { inventedNumbers, renderPatternSheet, renderSurprises, stripPreamble } from './synthesize.js';
import {
  cachedCount,
  cacheHealth,
  judgeInput,
  judgeTurnBody,
  parseJudgeOutput,
  currentJudgment,
  fitAperture,
  PIPELINE_V,
} from './judge.js';
import { installStopHook, readSettings } from './init.js';

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

test('THE HASH IGNORES CONTROL ACTIONS — adding them must not orphan a cached judgment', () => {
  const plain = parseExchanges(writeTranscript('plain.jsonl', [u('why a queue?'), a('bursts outrun the worker'), u('ok that lands')].join('\n')));
  const withInt = parseExchanges(
    writeTranscript('withint.jsonl', [u('why a queue?'), a('bursts outrun the worker'), interruptRec(), u('ok that lands')].join('\n')),
  );
  assert.equal(plain.length, 1);
  assert.equal(withInt.length, 1);
  assert.equal(withInt[0].hash, plain[0].hash, 'same words = same hash, whatever the person did with their hands');
  assert.equal(plain[0].interrupted, undefined);
  assert.equal(withInt[0].interrupted, 'plain', 'but the fact is carried');
});

test('the two interrupt kinds are distinguished, not merged', () => {
  const ex = parseExchanges(
    writeTranscript('kinds.jsonl', [u('run the deploy'), a('starting'), interruptRec('tool-use'), u('no, stop')].join('\n')),
  );
  assert.equal(ex[0].interrupted, 'tool-use', 'the permission-flow variant is not a spontaneous course correction');
});

test('a declined tool is recorded on the exchange it happened in', () => {
  const ex = parseExchanges(writeTranscript('deny.jsonl', [u('push it'), a('running git push'), denyRec(), u('not yet')].join('\n')));
  assert.equal(ex[0].declined, true);
});

test('control actions do not leak into the NEXT exchange', () => {
  const ex = parseExchanges(
    writeTranscript(
      'leak.jsonl',
      [u('first ask'), a('first answer'), interruptRec(), u('second ask'), a('second answer'), u('third')].join('\n'),
    ),
  );
  assert.equal(ex.length, 2);
  assert.equal(ex[0].interrupted, 'plain', 'the interrupt belongs to the turn it happened in');
  assert.equal(ex[1].interrupted, undefined, 'and is cleared before the next one');
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

// The tail rule (0.2.4): the person reacts to the END of the assistant's turn, but a long turn used
// to be truncated from the head — so the judge read the preamble and then a reaction to a conclusion
// it never saw. Measured 2026-07-16: 83% of real turns exceeded the judge's view, 21% the parse cap.

test('a long assistant turn keeps its TAIL — the reaction pairs with the end of what was said', () => {
  const p = writeTranscript(
    'longsaid.jsonl',
    [u('explain the whole design'), a(`THE-OPENING ${'y'.repeat(8300)} THE-CONCLUSION`), u('got it')].join('\n'),
  );
  const ex = parseExchanges(p);
  assert.equal(ex.length, 1);
  assert.ok(ex[0].said.includes('THE-CONCLUSION'), 'the end survives the cap');
  assert.ok(!ex[0].said.includes('THE-OPENING'), 'the head is what gets cut');
  assert.ok(ex[0].said.length <= 8000, 'the 0.3.0 identity cap holds (8k, raised inside the v2 bump)');
});

test('the judge reads HEAD and TAIL of a long turn — the plan and the conclusion — with the cut marked', () => {
  const ex = {
    prompt: 'why a queue?',
    said: `THE-PLAN ${'x'.repeat(4000)} THE-CONCLUSION`,
    reaction: 'ok makes sense',
    ts: '2026-07-01T10:00:00Z',
    session: 's',
    hash: 'h',
  };
  const input = judgeInput(ex);
  assert.ok(input.includes('THE-CONCLUSION'), 'the conclusion the person reacted to survives (tail 80%)');
  assert.ok(input.includes('THE-PLAN'), 'what it set out to do survives too (head 20%)');
  assert.ok(input.includes('…'), 'the middle cut is marked so the model knows it reads elided text');
  assert.ok(!input.includes('x'.repeat(3000)), 'the middle is what gets cut');
  assert.ok(input.includes('why a queue?'), 'a short prompt passes through whole');
});

test('fitAperture sizes the view from the user\'s own window — p90 × 1.2, clamped', () => {
  assert.deepEqual(fitAperture([]), { prompt: 800, said: 1500, reaction: 800 }, 'no window = the 0.2.4 floors');

  const ex = (prompt: string, said: string, reaction: string) => ({ prompt, said, reaction, ts: '', session: 's', hash: 'h' });
  const terse = Array.from({ length: 20 }, () => ex('short ask', 'a'.repeat(2000), 'ok'));
  const t = fitAperture(terse);
  assert.equal(t.prompt, 800, 'floors hold for terse fields — never smaller than the 0.2.4 views');
  assert.equal(t.said, 2400, 'p90(2000) × 1.2 = 2400 — the view grows to fit the user');
  assert.equal(t.reaction, 800, 'reaction floor holds');

  const paster = Array.from({ length: 20 }, () => ex('p'.repeat(7000), 's'.repeat(7000), 'ok'));
  const pf = fitAperture(paster);
  assert.equal(pf.prompt, 2400, 'the ceiling clamps a log-paster — worst case stays publishable');
  assert.equal(pf.said, 3500, 'said ceiling holds too');
});

test('stripPreamble: task meta-chatter never reaches the artifact (caught live, 2026-07-17)', () => {
  assert.equal(
    stripPreamble("Good, exactly 350. Here's the profile:\n\nWHAT THEY KNOW\nbackend"),
    'WHAT THEY KNOW\nbackend',
    'the literal leak from the dogfood is stripped',
  );
  assert.equal(stripPreamble('WHAT THEY KNOW\nbackend'), 'WHAT THEY KNOW\nbackend', 'clean output untouched');
  assert.equal(
    stripPreamble('Here is what matters most about them: they verify claims.\nMore prose.'),
    'Here is what matters most about them: they verify claims.\nMore prose.',
    'a real first sentence ending mid-line is never stripped — narrow on purpose',
  );
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
  const [ex] = parseExchanges(p);
  assert.ok(ex, 'fixture parsed');
  const found = findExchange('sess-abc123', ex.hash, [root]);
  assert.equal(found?.reaction, 'ok that lands', 'the raw exchange comes back readable');
  assert.equal(findExchange('sess-abc123', 'not-a-real-hash', [root]), undefined, 'wrong hash = nothing invented');
  assert.equal(findExchange('reaped-session', ex.hash, [root]), undefined, 'missing transcript = the honest-failure path');
  rmSync(root, { recursive: true, force: true });
});

test('displayOrder + matchReceiptPrefix: one numbering shared by patterns and receipt, git-style prefixes', () => {
  const pat = (id: string, kind: string, receipts: string[]) => ({
    id,
    statement: `claim ${id}`,
    kind: kind as never,
    count: receipts.length,
    window: { from: '2026-07-01', to: '2026-07-17' },
    trend: 'steady' as const,
    stability: 'slow' as const,
    receipts,
    confidence: 'moderate' as const,
  });
  const store: PatternStore = {
    v: 1,
    patterns: [pat('t1', 'think', ['aaa111', 'bbb222']), pat('k1', 'know', ['aaa999'])],
    candidates: [],
    assignments: {},
    audited: {},
    graded: {},
  };
  const order = displayOrder(store);
  assert.deepEqual(order.map((p) => p.id), ['k1', 't1'], 'kind order rules the numbering: know before think');
  assert.deepEqual(matchReceiptPrefix(store, 'bbb'), [{ hash: 'bbb222', claims: [2] }], 'a unique prefix resolves with its claim number');
  assert.equal(matchReceiptPrefix(store, 'aaa').length, 2, 'an ambiguous prefix lists every match');
  assert.equal(matchReceiptPrefix(store, 'zzz').length, 0, 'no match = no invention');
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

test('pendingCount: the pre-spend disclosure counts the cache diff, bounded by the budget', () => {
  const f = join(dir, 'pending-cache.json');
  process.env.STRATLESS_CACHE = f;
  try {
    const ex = (h: string) => ({ prompt: 'p', said: 's', reaction: 'r', ts: '2026-07-01T10:00:00Z', session: 'x', hash: h });
    writeFileSync(f, JSON.stringify({ h1: { ...j2('none'), hash: 'h1', v: PV } }));
    assert.equal(pendingCount([ex('h1'), ex('h2'), ex('h3')], 50), 2, 'cached h1 is free; h2+h3 would spend');
    assert.equal(pendingCount([ex('h1'), ex('h2'), ex('h3')], 1), 1, 'the budget bounds the disclosure');
    assert.equal(pendingCount([ex('h1')], 50), 0, 'nothing fresh = no pre-spend line at all');
  } finally {
    delete process.env.STRATLESS_CACHE;
  }
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

test('judgeTurnBody carries no rules — the rules ride the system prompt, once per session', () => {
  const ex = { prompt: 'why?', said: 'because', reaction: 'ok', ts: '', session: 's', hash: 'h' };
  const body = judgeTurnBody(ex);
  assert.ok(body.includes('PERSON ASKED'), 'the exchange rendering is there');
  assert.ok(!body.includes('THE SUBJECT OF THAT SENTENCE'), 'no instructions inside the turn body');
  assert.ok(judgeInput(ex).includes('THE SUBJECT OF THAT SENTENCE'), 'the one-shot fallback still carries the rules');
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

test('computeTrend: rising, fading, steady, and gone-quiet — all from dates, in code', () => {
  const now = new Date('2026-07-16T12:00:00Z');
  const d = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  assert.equal(computeTrend([d(1), d(3), d(5), d(40)], now), 'rising', '3 recent vs 1 prior = rising');
  assert.equal(computeTrend([d(40), d(45), d(50)], now), 'fading', 'all prior, none recent = fading');
  assert.equal(computeTrend([d(2), d(35)], now), 'steady', '1 vs 1 = steady, not noise');
  assert.equal(computeTrend([d(100), d(120)], now), 'fading', 'nothing in 56 days = fading by definition');
  assert.equal(computeTrend([], now), 'steady', 'no dates = degenerate steady');
});

test('computeStability: which clock a pattern lives on', () => {
  assert.equal(computeStability({ from: '2026-07-10', to: '2026-07-15' }, 'steady'), 'volatile', 'two weeks = volatile');
  assert.equal(computeStability({ from: '2026-05-01', to: '2026-07-15' }, 'steady'), 'bedrock', 'two months + not fading = lean on it');
  assert.equal(computeStability({ from: '2026-05-01', to: '2026-07-15' }, 'fading'), 'slow', 'a fading pattern is never bedrock');
  assert.equal(computeStability({ from: '2026-06-20', to: '2026-07-15' }, 'steady'), 'slow', 'in between = slow');
});

test('aggregate: the code computes every number; admission splits patterns from candidates', () => {
  const now = new Date('2026-07-16T12:00:00Z');
  const pile = new Map<string, ReturnType<typeof j2>>();
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  for (let i = 0; i < 8; i++) pile.set(`h${i}`, { ...j2('partial'), hash: `h${i}`, ts: day(i * 5) });

  const { patterns, candidates } = aggregate(
    [
      {
        statement: 'accepts the reasoning verbally then pivots to implementation',
        kind: 'think',
        receipts: ['h0', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'PHANTOM'],
      },
      { statement: 'a two-receipt anecdote', kind: 'work', receipts: ['h0', 'h1'] },
      { statement: 'fits no kind at all', kind: 'quantum-vibes', receipts: ['h0', 'h1', 'h2', 'h3', 'h4'] },
    ],
    pile,
    now,
  );

  assert.equal(patterns.length, 2, 'admitted: the 8-receipt pattern and the 5-receipt unsorted one');
  const main = patterns.find((p) => p.kind === 'think');
  assert.ok(main, 'the think pattern was admitted');
  assert.equal(main.count, 8, 'count = resolving receipts — the PHANTOM was dropped at the source');
  assert.ok(!main.receipts.includes('PHANTOM'), 'phantom evidence never survives (receipts-lint at birth)');
  assert.equal(main.window.from, day(35).slice(0, 10), 'window from the earliest receipt, in code');
  assert.equal(main.confidence, 'moderate', '8 receipts = moderate');
  assert.equal(patterns.find((p) => p.statement === 'fits no kind at all')?.kind, 'unsorted', 'unknown kind is never forced — unsorted');
  assert.equal(candidates.length, 1, 'the anecdote is a candidate, not a pattern');
  assert.equal(candidates[0].count, 2, 'below MIN_RECEIPTS — never reaches the writer');
});

test('parseMineOutput: the model cannot mint evidence — hashes outside the offered batch are dropped', () => {
  const offered = new Set(['h1', 'h2', 'h3']);
  const out = parseMineOutput(
    `Sure! Here is the analysis:
{"patterns":[
  {"id":"accepts-then-pivots","kind":"think","new_receipts":["h1","h2","PHANTOM","h2"]},
  {"id":"NEW brand new thing","statement":"redirects to cost whenever infra comes up","kind":"triggers","new_receipts":["h3"]},
  {"id":"","kind":"work","new_receipts":["h1"]},
  "garbage entry"
]}`,
    offered,
  );
  assert.ok(out, 'prose around nested JSON still parses (greedy match)');
  assert.equal(out.length, 2, 'the empty-id and garbage entries are dropped');
  assert.deepEqual(out[0].newReceipts, ['h1', 'h2'], 'phantom dropped, duplicate deduped');
  assert.equal(out[1].id, 'new-brand-new-thing', 'proposed ids are slugified in code');
  assert.equal(out[1].statement, 'redirects to cost whenever infra comes up');
  assert.equal(parseMineOutput('no json here at all', offered), undefined, 'unparseable = refuse the whole pass');
});

test('parseAuditOutput: the auditor may only remove what it explicitly rejected', () => {
  const offered = new Set(['h1', 'h2', 'h3']);
  const v = parseAuditOutput('{"keep":["h1"],"evict":["h2","OUTSIDER"]}', offered);
  assert.ok(v, 'well-formed audit parses');
  assert.ok(v.evict.has('h2'), 'an explicit eviction lands');
  assert.ok(!v.evict.has('OUTSIDER'), 'a hash outside the offered set is ignored');
  assert.ok(!v.evict.has('h3'), 'a hash the model forgot to mention is KEPT — sloppiness never destroys evidence');
  assert.equal(parseAuditOutput('no json', offered), undefined, 'unparseable = refuse; receipts stay unaudited');
  const both = parseAuditOutput('{"keep":["h1"],"evict":["h1"]}', offered);
  assert.ok(both?.evict.has('h1'), 'listed in both = evicted — uncertain means evict');
});

// ── the grader (0.3.2): every pattern is a dated prediction; misses are the best signal ────────

test('parseGradeOutput: the grader cannot mint contradictions', () => {
  const offered = new Set(['h1', 'h2']);
  const cited = parseGradeOutput('{"contradicts":["h1","PHANTOM"]}', offered);
  assert.ok(cited?.has('h1'), 'a real contradiction lands');
  assert.ok(!cited?.has('PHANTOM'), 'a hash outside the offered evidence is dropped');
  assert.equal(parseGradeOutput('{"contradicts":[]}', offered)?.size, 0, 'an empty list is honest work');
  assert.equal(parseGradeOutput('no json', offered), undefined, 'unparseable = refuse; re-grades next gate');
});

test('classifyGrade: surprised beats confirmed; silence is never a miss; own receipts never contradict', () => {
  const batch = ['h1', 'h2', 'h3'];
  assert.equal(classifyGrade(new Set(['h3']), batch, ['h1']).verdict, 'surprised', 'a contradiction outranks everything');
  assert.equal(classifyGrade(new Set(), batch, ['h1']).verdict, 'confirmed', 'new receipts landed = reality agreed');
  assert.equal(classifyGrade(new Set(), batch, ['h9']).verdict, 'silent', 'topic never came up = costs nothing');
  assert.equal(classifyGrade(new Set(['h1']), batch, ['h1']).verdict, 'confirmed', "citing the pattern's OWN receipt is the auditor's domain, not a surprise");
  assert.deepEqual(classifyGrade(new Set(['h3']), batch, ['h1']).evidence, ['h3'], 'the mistake carries receipts too');
});

test('shouldFlag: balanced demotion — two surprises inside 14 days, one anomaly never', () => {
  const now = new Date('2026-07-17T12:00:00Z');
  const rec = (ats: string[]): GradeRecord => ({
    confirmed: 0,
    silent: 0,
    surprised: ats.length,
    surprises: ats.map((at) => ({ at, evidence: ['x'] })),
  });
  assert.equal(shouldFlag(rec(['2026-07-16T12:00:00Z']), now), false, 'one weird Tuesday costs confidence, not standing');
  assert.equal(shouldFlag(rec(['2026-07-10T12:00:00Z', '2026-07-16T12:00:00Z']), now), true, 'a repeat inside the window = the model of the person is wrong there');
  assert.equal(shouldFlag(rec(['2026-06-01T12:00:00Z', '2026-07-16T12:00:00Z']), now), false, 'an old surprise aged out — only the window counts');
});

test('timeTag: code hands the model structured local time, never a raw timestamp', () => {
  assert.equal(timeTag('2026-07-17T09:14:00'), '[Fri 09:14] ', 'weekday + wall clock, computed in code');
  assert.equal(timeTag('garbage'), '', 'an unparseable ts yields no tag, never a crash');
});

test('HUMAN.md carries the person-layer schema marker (0.3.1: the sectioned protocol)', () => {
  const humanMd = join(dir, 'HUMAN-schema.md');
  const claudeMd = join(dir, 'CLAUDE-schema.md');
  injectProfile('WHAT THEY KNOW\nbackend architecture', humanMd, claudeMd);
  assert.ok(readFileSync(humanMd, 'utf8').includes('<!-- humanmd/v1 -->'), 'the protocol version is declared in the artifact');
});

test('loadPatterns: missing or version-mismatched reads as empty; a DAMAGED store refuses loudly (C2)', () => {
  const f = join(dir, 'patterns.json');
  assert.deepEqual(loadPatterns(f).patterns, [], 'missing = empty');
  writeFileSync(f, 'garbage {');
  // 0.3.4 (C2): corrupt no longer reads as empty — that was a silent re-mine of the whole pile.
  assert.throws(() => loadPatterns(f), CorruptStoreError, 'corrupt = refusal, never a silent re-bill');
  writeFileSync(f, JSON.stringify({ v: 999, patterns: [{ id: 'x' }] }));
  assert.deepEqual(loadPatterns(f).patterns, [], 'a foreign MINER_V = re-mine; the judgment pile is the permanent layer');
  savePatterns({ v: 1, patterns: [], candidates: [], assignments: { abc: ['p1'] }, audited: {}, graded: {} }, f);
  assert.deepEqual(loadPatterns(f).assignments, { abc: ['p1'] }, 'a current store round-trips');
});

// ── the promise layer: a wrong frequency is a lie wearing precision ───────────────────────────

test('inventedNumbers: every numeral in the output must already exist in the input', () => {
  const input = 'CORPUS: 8 sessions · 190 judged\n[think · 24x · 2026-06-09 → 2026-07-16 · fading] pivots';
  assert.deepEqual(inventedNumbers('seen 24 times since June, across 8 sessions', input), [], 'sheet numbers pass');
  assert.deepEqual(inventedNumbers('roughly 40 times', input), ['40'], 'a rounded/invented count is caught');
  assert.deepEqual(inventedNumbers('by 2026 standards, 16 of them', input), [], 'date components count as shown');
  assert.deepEqual(inventedNumbers('no numbers at all here', input), [], 'prose without numerals always passes');
});

test('renderPatternSheet shows the model exactly the numbers the lint will allow', () => {
  const sheet = renderPatternSheet([
    {
      id: 'accepts-then-pivots',
      statement: 'accepts the reasoning verbally then pivots to implementation',
      kind: 'think',
      count: 24,
      window: { from: '2026-06-09', to: '2026-07-16' },
      trend: 'fading',
      stability: 'slow',
      receipts: [],
      confidence: 'strong',
      audit: { kept: 22, evicted: 2, at: '2026-07-16T12:00:00Z' },
    },
  ]);
  assert.ok(sheet.includes('24x'), 'the count is shown');
  assert.ok(sheet.includes('audited 22/24'), 'the audit tally is shown as kept/total');
  assert.ok(sheet.includes('fading'), 'the trend rides along');
  assert.deepEqual(inventedNumbers('24 times, 22 of 24 audited, since 2026-06-09', sheet), [], 'sheet and lint agree by construction');
});

test('renderSurprises: the diary is for the report; recency-windowed; flags shown as revisions', () => {
  const now = new Date('2026-07-17T12:00:00Z');
  const p = (statement: string, ats: string[], flagged?: boolean) => ({
    id: 'x',
    statement,
    kind: 'work' as const,
    count: 6,
    window: { from: '2026-07-01', to: '2026-07-16' },
    trend: 'steady' as const,
    stability: 'slow' as const,
    receipts: [],
    confidence: 'moderate' as const,
    record: { confirmed: 1, silent: 2, surprised: ats.length, surprises: ats.map((at) => ({ at, evidence: ['h'] })) },
    flagged,
  });
  const out = renderSurprises([p('always says go', ['2026-07-16T09:00:00Z'], true)], now);
  assert.ok(out.includes('always says go'), 'the wrong claim is named');
  assert.ok(out.includes('now under revision'), 'a flagged claim says so');
  assert.equal(renderSurprises([p('old miss', ['2026-06-01T09:00:00Z'])], now), '', 'old surprises age out of the diary');
});

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

test('synthesisDue: first build, K accumulation, the backstop, and cache reset', () => {
  const now = new Date('2026-07-16T12:00:00Z');
  assert.equal(synthesisDue({}, 40, now).due, true, 'never synthesized = first build = due');

  const fresh = { lastSynthesisAt: '2026-07-15T12:00:00Z', judgmentsAtLastSynthesis: 100 };
  assert.equal(synthesisDue(fresh, 110, now).due, false, '10 of 25 accumulated — not yet');
  assert.equal(synthesisDue(fresh, 110, now).newSince, 10, 'progress is reported honestly');
  assert.equal(synthesisDue(fresh, 125, now).due, true, 'K reached = due');

  const stale = { lastSynthesisAt: '2026-07-01T12:00:00Z', judgmentsAtLastSynthesis: 100 };
  assert.equal(synthesisDue(stale, 101, now).due, true, 'past the backstop + anything new = due');
  assert.equal(synthesisDue(stale, 100, now).due, false, 'stale but NOTHING new = same pile, same profile, skip');

  assert.equal(synthesisDue(fresh, 50, now).due, true, 'count went backwards = cache was reset = rebuild');
});

test('state: missing or corrupt reads as never-synthesized (fails open), and round-trips', () => {
  const f = join(dir, 'state.json');
  assert.deepEqual(readState(f), {}, 'missing = never synthesized');
  writeFileSync(f, 'garbage {');
  assert.deepEqual(readState(f), {}, 'corrupt = never synthesized, never a throw');
  writeState({ lastSynthesisAt: '2026-07-16T12:00:00Z', judgmentsAtLastSynthesis: 190 }, f);
  const s = readState(f);
  assert.equal(s.lastSynthesisAt, '2026-07-16T12:00:00Z');
  assert.equal(s.judgmentsAtLastSynthesis, 190);
});

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

const j2 = (topic = 'a topic', behavior = 'what they did') => ({
  hash: 'x',
  ts: '2026-07-01T10:00:00Z',
  session: 's',
  v: PIPELINE_V,
  topic,
  behavior,
  line: `${topic} — ${behavior}`,
});

test('EVERY judgment reaches the writer — the `none` gate is gone with the verdict', () => {
  // The gate dropped 11% of evidence, including "gave explicit go-ahead to merge" and "executed the
  // manual steps and reported completion" — exactly what HOW THEY WORK is built from.
  assert.ok(currentJudgment(j2()), 'a judgment with no verdict field is valid');
  assert.equal(currentJudgment({ ...j2(), v: 1 }), false, 'a v1 entry is still stale');
  assert.equal(currentJudgment({ ...j2(), behavior: undefined } as never), false, 'behavior is required');
});

// ── judgment v2: strict FORM guaranteed in code, free VOCABULARY in the fields ─────────────────

test('parseJudgeOutput: valid JSON parses into validated fields', () => {
  const p = parseJudgeOutput('{"topic":"the deploy step","behavior":"accepted but pivoted to cost"}');
  assert.ok(p, 'well-formed output parses');
  assert.equal(p.topic, 'the deploy step');
  assert.equal(p.behavior, 'accepted but pivoted to cost');
});

test('parseJudgeOutput: tolerates prose and stale fields, refuses a missing one', () => {
  assert.ok(
    parseJudgeOutput('Here is my judgment: {"topic":"JWT expiry","behavior":"re-asked"} hope that helps'),
    'the first {...} block wins even when the model chats',
  );
  assert.ok(
    parseJudgeOutput('{"verdict":"maybe","topic":"x","behavior":"y"}'),
    'a leftover verdict field is ignored, never a reason to refuse — the old shape is a superset',
  );
  assert.equal(parseJudgeOutput('{"topic":"x"}'), undefined, 'missing behavior = refuse');
  assert.equal(parseJudgeOutput('{"behavior":"y"}'), undefined, 'missing topic = refuse');
  assert.equal(parseJudgeOutput('transferred — an old v1 line — moved on'), undefined, 'no JSON = refuse, re-judge');
});

test('parseJudgeOutput: an over-long field is cut at a word boundary, never mid-word', () => {
  // Measured 2026-07-19: 16% of behaviors hit the cap and were amputated mid-word ("…based on
  // act"). Behavior text is what the miner mines, so half a word is damaged evidence.
  const long = `${'alpha bravo charlie delta echo foxtrot golf hotel '.repeat(8)}terminus`;
  const p = parseJudgeOutput(`{"verdict":"no","topic":"t","behavior":"${long}"}`);
  assert.ok(p, 'an over-long behavior still parses');
  assert.ok(p.behavior.length <= 240, 'still bounded by the backstop cap');
  assert.ok(!/\s$/.test(p.behavior), 'no trailing whitespace at the cut');
  assert.ok(
    long.startsWith(p.behavior),
    'the kept text is a genuine prefix of what the model said — never re-worded',
  );
  const lastWord = p.behavior.slice(p.behavior.lastIndexOf(' ') + 1);
  assert.ok(
    ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'].includes(lastWord),
    `cut landed on a whole word, got "${lastWord}"`,
  );
});

test('parseJudgeOutput: a dangling quote is dropped, a matched pair is kept', () => {
  // Observed 2026-07-19: behaviors arriving as `…moved on"` — one quote, no opener. But the model
  // quotes the person legitimately and often, so the test is PARITY, not "strip quotes".
  const dangling = parseJudgeOutput('{"verdict":"none","topic":"t","behavior":"confirmed and moved on\\""}');
  assert.equal(dangling?.behavior, 'confirmed and moved on', 'an unmatched trailing quote is noise');

  const paired = parseJudgeOutput('{"verdict":"no","topic":"t","behavior":"pushed back with \\"not like that\\""}');
  assert.equal(paired?.behavior, 'pushed back with "not like that"', 'a matched pair is the person\'s own words — keep it');

  const apostrophe = parseJudgeOutput('{"verdict":"none","topic":"t","behavior":"said it was the team\'s call"}');
  assert.equal(apostrophe?.behavior, "said it was the team's call", 'a mid-string apostrophe is untouched');
});

test('parseJudgeOutput: a field that fits is left exactly alone', () => {
  const p = parseJudgeOutput('{"verdict":"partial","topic":"the deploy step","behavior":"accepted, then pivoted to cost"}');
  assert.equal(p?.behavior, 'accepted, then pivoted to cost', 'no cut, no reflow, byte-identical');
});

test('a v1 cache entry is stale — currentJudgment gates the pipeline version', () => {
  assert.equal(currentJudgment({ hash: 'x', ts: 't', session: 's', line: 'transferred — a — b' }), false, 'v1 entry (no v, no fields) re-judges under the budget');
  assert.equal(currentJudgment(undefined), false, 'missing entry is not current');
  assert.equal(currentJudgment(j2('partial')), true, 'a current-version entry is served free');
});

test('cachedCount counts judgments; a DAMAGED cache refuses loudly, and cacheHealth labels it (C2)', () => {
  const f = join(dir, 'judgments.json');
  assert.equal(cachedCount(f), 0, 'no cache yet');
  writeFileSync(f, JSON.stringify({ a: {}, b: {}, c: {} }));
  assert.equal(cachedCount(f), 3, 'one per cached exchange');
  assert.deepEqual(cacheHealth(f), { ok: true, count: 3, file: f }, 'healthy cache reports its count');
  writeFileSync(f, 'broken {');
  // 0.3.4 (C2): corrupt no longer reads as zero — the gate would mistake it for an empty pile
  // and re-bill the whole history. Spending paths refuse; status labels via cacheHealth.
  assert.throws(() => cachedCount(f), CorruptStoreError, 'corrupt = refusal, never a confident zero');
  const health = cacheHealth(f);
  assert.equal(health.ok, false, 'status sees "unreadable", not 0');
  assert.equal(health.file, f, 'and knows which file to name');
});

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

  const got = loadRecentExchanges(2, [rdir]);
  assert.equal(got.length, 2, 'windowed to `want`, not the whole archive');
  assert.equal(got[0].reaction, 'react three', 'oldest of the window comes first');
  assert.equal(got[1].reaction, 'react four', 'newest last');
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

// ── the after-session hook is OPT-IN: `init` must not silently arm it (0.2.2 hung machines this way) ──

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

