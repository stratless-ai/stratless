/**
 * ESTIMATE — the rate card. Pure arithmetic on a shipped constant; no fixtures, no I/O. Pins the
 * linear scaling, the junk-flooring, and the human line (including the sub-cent "< $0.01" so a real
 * spend never reads as free).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { estimateBuild, estimateFromMessages, estimateLine, REFERENCE } from './estimate.js';

test('estimateBuild reproduces the reference at the reference pile, and scales linearly', () => {
  const e = estimateBuild(REFERENCE.moments);
  assert.equal(e.moments, REFERENCE.moments);
  assert.ok(Math.abs(e.usd - REFERENCE.usd) < 0.01, 'dollars match the reference');
  assert.ok(Math.abs(e.minutes - REFERENCE.minutes) < 0.01, 'minutes match the reference');
  const half = estimateBuild(REFERENCE.moments / 2);
  assert.ok(Math.abs(half.usd - REFERENCE.usd / 2) < 0.01, 'half the pile, half the cost');
});

test('estimateBuild floors junk to a safe zero', () => {
  assert.deepEqual(estimateBuild(-5), { moments: 0, usd: 0, minutes: 0 });
  assert.deepEqual(estimateBuild(NaN), { moments: 0, usd: 0, minutes: 0 });
  assert.equal(estimateBuild(10.9).moments, 10, 'a fractional count floors');
});

test('estimateLine reads as a human quote (derived from REFERENCE, never hard-coded)', () => {
  const line = estimateLine(estimateBuild(REFERENCE.moments));
  assert.ok(line.includes(`~${REFERENCE.moments.toLocaleString()} moments`), line);
  assert.ok(line.includes(`~$${REFERENCE.usd.toFixed(2)}`), line);
  // ROUNDED, not verbatim: the reference now carries a measured fraction (3.7 min), and the line is
  // for a human — `Math.round` is the formatter's job. Asserting the raw value only ever passed
  // because the previous reference happened to be a whole number.
  assert.ok(line.includes(`~${Math.round(REFERENCE.minutes)} min`), line);
});

test('a real sub-cent build never prints a free-looking zero', () => {
  const line = estimateLine(estimateBuild(1)); // ≈ $0.0018, ≈ 0.003 min
  assert.match(line, /< \$0\.01/);
  assert.match(line, /< 1 min/);
});

test('a zero pile is quoted as free (there is nothing to build)', () => {
  const line = estimateLine(estimateBuild(0));
  assert.match(line, /~\$0\.00/);
});

test('estimateFromMessages scales UP to moments — the quote never lands under the real spend', () => {
  // the reference message count must quote at (or above) the reference build cost, never below
  const fromMsgs = estimateFromMessages(REFERENCE.messages);
  assert.ok(fromMsgs.moments >= REFERENCE.moments - 1, 'messages scale up to ~the reference moment count');
  assert.ok(fromMsgs.usd >= REFERENCE.usd - 0.01, `≥ the real cost, never under (${fromMsgs.usd})`);
  // vs quoting the raw message count (the old under-quoting bug): scaled must be higher
  assert.ok(fromMsgs.usd > estimateBuild(REFERENCE.messages).usd, 'scaling beats quoting messages as moments');
  assert.deepEqual(estimateFromMessages(0), { moments: 0, usd: 0, minutes: 0 });
  assert.deepEqual(estimateFromMessages(NaN), { moments: 0, usd: 0, minutes: 0 });
});

test('estimateLine renders a cent-plus build as its rounded dollar, not the sub-cent floor', () => {
  // formatting is independent of the rate card: an over-floor value rounds, it never reads "< $0.01"
  const line = estimateLine({ moments: 5, usd: 0.011, minutes: 0.5 });
  assert.match(line, /~\$0\.01/);
  assert.doesNotMatch(line, /< \$0\.01/);
});
