/**
 * FLUSH GATE — the pure decision that replaced the per-turn rebuild. No fixtures, no env: flushDue
 * takes the waiting moments and decides whether to phone the assistant this run. Covers the manual
 * override, the new-session trigger, the 24h ceiling, the never-flushed baseline, and the
 * collect-and-wait default.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { flushDue } from './state.js';

const H = 3600 * 1000;
const NOW = Date.parse('2026-07-22T12:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();
const w = (session: string, atMsAgo: number) => ({ session, ts: iso(NOW - atMsAgo) });

test('manual beats every gate — flushes even with nothing waiting', () => {
  assert.equal(flushDue([], undefined, NOW, true).flush, true);
  assert.equal(flushDue([w('s1', 0)], iso(NOW), NOW, true).flush, true);
});

test('nothing waiting, not manual — never a flush', () => {
  assert.equal(flushDue([], iso(NOW - 100 * H), NOW, false).flush, false);
});

test('all waiting in the current session, recently flushed — collect and wait', () => {
  const waiting = [w('s1', 2 * H), w('s1', 1 * H)];
  assert.equal(flushDue(waiting, iso(NOW - 1 * H), NOW, false).flush, false);
});

test('a waiting moment from an older session — flush (a session ended)', () => {
  const waiting = [w('s1', 26 * H), w('s2', 1 * H)]; // s1 leftovers, now active in s2
  const d = flushDue(waiting, iso(NOW - 1 * H), NOW, false);
  assert.equal(d.flush, true);
  assert.equal(d.reason, 'a session ended');
});

test('same session, waited past the 24h ceiling — flush', () => {
  const d = flushDue([w('s1', 30 * H)], iso(NOW - 25 * H), NOW, false);
  assert.equal(d.flush, true);
  assert.equal(d.reason, 'over the flush ceiling');
});

test('same session, ceiling not reached — collect and wait', () => {
  assert.equal(flushDue([w('s1', 2 * H)], iso(NOW - 2 * H), NOW, false).flush, false);
});

test('never flushed before, something waiting — flush once to set the baseline', () => {
  const d = flushDue([w('s1', 1 * H)], undefined, NOW, false);
  assert.equal(d.flush, true);
  assert.equal(d.reason, 'first flush');
});

test('an unreadable last-flush stamp fails open (flush), never wedges', () => {
  assert.equal(flushDue([w('s1', 1 * H)], 'not-a-date', NOW, false).flush, true);
});

test('the ceiling honours the maxAgeMs override (env-style)', () => {
  // a one-hour ceiling: two hours waiting trips it
  assert.equal(flushDue([w('s1', 2 * H)], iso(NOW - 2 * H), NOW, false, { maxAgeMs: 1 * H }).flush, true);
});
