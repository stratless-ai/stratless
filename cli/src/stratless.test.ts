/**
 * The whole product is one claim: IT DOES NOT LIE.
 *
 * Every test below is a lie it actually told during development on 2026-07-14. They are not
 * hypotheticals — each one shipped, was caught by looking, and is pinned here so it can never
 * come back. A confidently-wrong answer, screenshotted by one stranger, ends this product.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';

import { parseSession } from './transcript.js';
import { parseExchanges, loadRecentExchanges } from './exchange.js';
import { injectProfile, removeProfile, ensureLoaded } from './sink.js';
import { readState, writeState, synthesisDue } from './state.js';
import { readUsage, recordUsage } from './usage.js';
import { parseJsonResult } from './claude.js';
import { hasSignal } from './synthesize.js';
import { cachedCount, judgeInput } from './judge.js';
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
    [u('explain the whole design'), a(`THE-OPENING ${'y'.repeat(4100)} THE-CONCLUSION`), u('got it')].join('\n'),
  );
  const ex = parseExchanges(p);
  assert.equal(ex.length, 1);
  assert.ok(ex[0].said.includes('THE-CONCLUSION'), 'the end survives the cap');
  assert.ok(!ex[0].said.includes('THE-OPENING'), 'the head is what gets cut');
  assert.ok(ex[0].said.length <= 4000, 'the cap itself still holds');
});

test('the judge reads the TAIL of a long turn, with the cut marked', () => {
  const ex = {
    prompt: 'why a queue?',
    said: `PREAMBLE ${'x'.repeat(2000)} CONCLUSION`,
    reaction: 'ok makes sense',
    ts: '2026-07-01T10:00:00Z',
    session: 's',
    hash: 'h',
  };
  const input = judgeInput(ex);
  assert.ok(input.includes('CONCLUSION'), 'the conclusion the person reacted to survives');
  assert.ok(!input.includes('PREAMBLE'), 'the preamble is what gets cut');
  assert.ok(input.includes('…'), 'truncation is marked so the model knows it reads mid-text');
  assert.ok(input.includes('why a queue?'), 'the prompt keeps its head');
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

  injectProfile('v1', humanMd, claudeMd);
  injectProfile('v2', humanMd, claudeMd);

  const human = readFileSync(humanMd, 'utf8');
  assert.ok(human.includes('v2') && !human.includes('v1'), 'HUMAN.md is replaced, not stacked');
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

test('`none` judgments carry no signal and never reach the writer', () => {
  const j = (line: string) => ({ hash: 'x', ts: '2026-07-01T10:00:00Z', session: 's', line });
  assert.equal(hasSignal(j('none — cost logistics — asked about pricing')), false, 'a none line is filtered');
  assert.equal(hasSignal(j('None — a thank-you — said thanks')), false, 'case-insensitive');
  assert.equal(hasSignal(j('transferred — the deploy step — moved on immediately')), true);
  assert.equal(hasSignal(j('no — JWT expiry — re-asked the same question')), true, '`no` IS signal — it did not land');
  assert.equal(hasSignal(j('partial — queues — accepted but pivoted')), true);
});

test('cachedCount counts judgments, and reads missing or corrupt as zero', () => {
  const f = join(dir, 'judgments.json');
  assert.equal(cachedCount(f), 0, 'no cache yet');
  writeFileSync(f, JSON.stringify({ a: {}, b: {}, c: {} }));
  assert.equal(cachedCount(f), 3, 'one per cached exchange');
  writeFileSync(f, 'broken {');
  assert.equal(cachedCount(f), 0, 'a corrupt cache never throws');
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

