/**
 * TERMS — the answer channel's collect-time guarantees, pinned. The one that matters most: the
 * function is pure over the answer text alone (same answer → same card, forever), because that is
 * what lets a rebuild and an append produce identical piles from the same archive.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { termsOf, TERMS_CAP } from './terms.js';

test('identifiers keep their dots and hyphens — `wrangler.toml` and `cache-economics` are one term each', () => {
  const t = termsOf('edit wrangler.toml so the cache-economics story holds');
  assert.ok(t.includes('wrangler.toml'), 'the dotted identifier is whole');
  assert.ok(t.includes('cache-economics'), 'the hyphenated coinage is whole');
  assert.ok(!t.includes('wrangler'), 'and not also present as fragments');
});

test('a sentence-final term matches its mid-sentence self — trailing punctuation is trimmed', () => {
  const t = termsOf('First we deploy. Then the deploy runs again, and deploy- artifacts land.');
  assert.deepEqual(
    t.filter((x) => x.startsWith('deploy')),
    ['deploy'],
    'one identity, however the sentence ended — threading downstream is string equality',
  );
});

test('function words and short tokens carry no subject and are dropped', () => {
  const t = termsOf('the answer is that we should just use it before anything else happens');
  assert.ok(!t.includes('the') && !t.includes('should') && !t.includes('anything'), 'function words gone');
  assert.ok(!t.includes('is') && !t.includes('we'), 'sub-three-character tokens never tokenize');
  assert.ok(t.includes('answer') && t.includes('happens'), 'content words survive');
});

test('this machine\'s own names are not subjects — the pasted shell prompt cannot thread', () => {
  const machine = new Set(['jxs-macbook-air', 'jxs', 'sunuser']);
  const t = termsOf('jxs-MacBook-Air web % pnpm build failed on the tokenizer', TERMS_CAP, machine);
  assert.ok(!t.includes('jxs-macbook-air'), 'the hostname is dropped');
  assert.ok(t.includes('tokenizer'), 'while the real subject stays');
});

test('ranked by in-answer count, then first appearance — an answer leads with its subject', () => {
  const t = termsOf('caching explained: caching saves rebuilds. caching also saves money. rebuilds matter.');
  assert.equal(t[0], 'caching', 'the most-repeated term leads');
  assert.deepEqual(t.slice(1, 3), ['saves', 'rebuilds'], 'a count tie breaks by first appearance, not alphabet');
  const capped = termsOf(Array.from({ length: 50 }, (_, i) => `term${i}alpha`).join(' '), 5);
  assert.equal(capped.length, 5, 'the cap holds');
});

test('a paste artifact is not a term — tokens beyond the length ceiling are dropped', () => {
  const blob = 'A'.repeat(200);
  const t = termsOf(`the payload ${blob} decoded fine`);
  assert.ok(!t.some((x) => x.length > 40), 'the base64-shaped run is gone');
  assert.ok(t.includes('payload') && t.includes('decoded'), 'the words around it survive');
});

test('pure over the text alone — the same answer always yields the same card', () => {
  const text = 'the wrangler cache invalidates on deploy, so cache misses spike after deploy';
  assert.deepEqual(termsOf(text), termsOf(text), 'byte-identical on repeat');
  assert.deepEqual(termsOf(''), [], 'and an empty answer yields an empty list, not a crash');
});
