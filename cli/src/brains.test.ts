/**
 * Tests for THE BRAIN LAYER.
 *
 * The borrow is where a person's whole history meets a model, so the invariants here are the ones
 * that cost the most when they slip: no hands, a blank slate, and a machine with one brain never
 * quietly spawning the other. The Claude implementation's own protocol tests live in
 * plumbing.test.ts and are unchanged by this — what is new is that there are two of these now.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readStream } from './brain-codex.js';
import { brains, detectBrains, pickBrain } from './brains.js';

/** One frame of what `codex exec --json` really emits, shaped from a live run against 0.146.0. */
const stream = (...lines: unknown[]): string => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

test('the registry is ordered, and the order IS the policy', () => {
  assert.deepEqual(
    brains.map((b) => b.id),
    ['claude', 'codex'],
    'Claude first, so nobody who has it today sees their profile written by a different model',
  );
  for (const b of brains) assert.ok(b.displayName, `${b.id} names itself — messages interpolate this, never a literal`);
});

test('a pinned brain is honoured, and a pin for something absent picks nothing', () => {
  // The pin is how the CHOICE survives the detached spawn: a worker inherits a thin PATH and
  // re-derives the brain, and a path alone cannot carry a protocol.
  const saved = process.env.STRATLESS_BRAIN;
  try {
    process.env.STRATLESS_BRAIN = 'nonexistent-brain';
    assert.equal(pickBrain(), undefined, 'a pin naming something not here resolves to nothing, never to a substitute');
    delete process.env.STRATLESS_BRAIN;
    const present = detectBrains();
    assert.deepEqual(pickBrain()?.id, present[0]?.id, 'unpinned, the first PRESENT brain wins');
  } finally {
    if (saved === undefined) delete process.env.STRATLESS_BRAIN;
    else process.env.STRATLESS_BRAIN = saved;
  }
});

test('the Codex reply is assembled from a stream of frames, not parsed as one object', () => {
  // `codex exec --json` emits thread.started / turn.started / item.completed / turn.completed —
  // measured against a live 0.146.0 run. A parser expecting one envelope reads nothing at all.
  const raw = stream(
    { type: 'thread.started', thread_id: 't1' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'banana' } },
    { type: 'turn.completed', usage: { input_tokens: 12851, cached_input_tokens: 9984, cache_write_input_tokens: 0, output_tokens: 5 } },
  );
  const read = readStream(raw);
  assert.equal(read.text, 'banana');
  assert.equal(read.errored, false);
  assert.equal(read.cost.inputTokens, 12851);
  assert.equal(read.cost.outputTokens, 5);
  assert.equal(read.cost.cacheReadTokens, 9984, 'cached input is a read, not a write — the two are separate lines on the bill');
});

test('the LAST message is the answer, not the first', () => {
  const raw = stream(
    { type: 'item.completed', item: { type: 'agent_message', text: 'thinking out loud' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'the actual answer' } },
    { type: 'turn.completed', usage: { output_tokens: 1 } },
  );
  assert.equal(readStream(raw).text, 'the actual answer');
});

test('an error frame is a refusal, never an answer', () => {
  // The same rule as the Claude side's is_error envelope: error prose returned AS the reply would
  // poison the profile with a diagnosis of the call.
  const raw = stream(
    { type: 'item.completed', item: { type: 'agent_message', text: 'partial' } },
    { type: 'error', message: 'rate limited' },
  );
  assert.equal(readStream(raw).errored, true, 'the caller must refuse rather than use what came before it');
});

test('a torn frame is skipped, not fatal — the stream is a log', () => {
  const raw =
    '{"type":"thread.started"}\n' +
    '{"type":"item.completed","item":{"type":"agent_mess\n' + // truncated mid-write
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'survived' } }) +
    '\n';
  assert.equal(readStream(raw).text, 'survived');
});

test('what the borrow cannot report stays absent rather than zero', () => {
  // Measured: the exec stream carries tokens and nothing else — no model id, no quota reading,
  // no dollars. Filling those with what we ASKED for would make `byModel` a record of our request
  // instead of what actually ran.
  const read = readStream(stream({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } }));
  assert.equal(read.cost.model, undefined, 'the model that ran is unknown here, and says so');
  assert.equal(read.cost.usedPercent, undefined);
  assert.equal(read.cost.costUsd, undefined, 'no dollars — nobody is billed for a subscription call');
});
