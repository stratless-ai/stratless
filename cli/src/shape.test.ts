/**
 * SHAPE — the transform that decides whether clustering groups a person by what they DO or by what
 * they TALK ABOUT. Pure and model-free, so the rules pin exactly.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { shapeOf, vocabulary, wordFrequency, KEEP_WORDS } from './shape.js';
import type { Moment } from './moments.js';

const moment = (reply: string, session = 's1'): Moment => ({
  key: `${session}:${reply.slice(0, 12)}`,
  session,
  ts: '2026-07-01T00:00:00Z',
  pile: 'ordinary',
  reply,
  replyLen: reply.length,
});

test('wordFrequency counts MOMENTS, not occurrences', () => {
  // A word repeated inside one long reply is one moment's worth of evidence. Counting raw
  // occurrences would let a single verbose message promote its own vocabulary.
  const df = wordFrequency([moment('schema schema schema schema'), moment('plan')]);
  assert.equal(df.get('schema'), 1, 'four occurrences in one moment count once');
  assert.equal(df.get('plan'), 1);
});

test('vocabulary keeps the most frequent words and is deterministic on ties', () => {
  const ms = [moment('the plan'), moment('the plan'), moment('the schema'), moment('gachapon')];
  const vocab = vocabulary(ms, 2);
  assert.ok(vocab.has('the'), 'the most frequent word survives');
  assert.ok(vocab.has('plan'), 'the second survives');
  assert.ok(!vocab.has('gachapon'), 'a once-seen word does not');
  assert.deepEqual([...vocabulary(ms, 2)], [...vocabulary(ms, 2)], 'ties break the same way every run');
});

test('shapeOf drops out-of-vocabulary words but keeps order and punctuation', () => {
  const vocab = new Set(['im', 'thinking', 'about', 'whether', 'holds']);
  assert.equal(shapeOf('im thinking about whether stratless positioning holds', vocab),
    'im thinking about whether holds');
  assert.equal(shapeOf('lets do it, properly!', new Set(['lets', 'do', 'it'])), 'lets do it, !',
    'punctuation survives so the sentence keeps its shape');
});

test('THE POINT: two sentences about different things become the same move', () => {
  // This is the whole reason the stage exists. Before shaping, these cluster by subject; after, the
  // subject is gone and what is left is identical — one move, two topics.
  const vocab = new Set(['im', 'thinking', 'about', 'whether', 'the', 'works']);
  const a = shapeOf('im thinking about whether stratless positioning works', vocab);
  const b = shapeOf('im thinking about whether the firecrawl schema works', vocab);
  assert.equal(a, 'im thinking about whether works');
  assert.equal(b, 'im thinking about whether the works');
  assert.ok(a.startsWith('im thinking about whether'), 'the move survives in both');
});

test('a reply made entirely of rare words falls back to itself, never to empty', () => {
  // An empty string carries no signal at all; the original at least carries something.
  assert.equal(shapeOf('gachapon marquee', new Set(['the'])), 'gachapon marquee');
});

test('KEEP_WORDS is the documented default', () => {
  assert.equal(KEEP_WORDS, 220);
});
