/**
 * FLUSH GATE — the pure decision that replaced the per-turn rebuild. No fixtures, no env: flushDue
 * takes the waiting moments and decides whether to phone the assistant this run. Covers the manual
 * override, the once-a-day cooldown (a finished session no longer flushes on its own), the
 * never-flushed baseline, the cooldown override, and the collect-and-wait default.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { flushDue, flushCooldownMs, setFlushCadence, readState } from './state.js';

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

test('a session ended but within the cooldown — collect and wait (no more per-session rebuild)', () => {
  const waiting = [w('s1', 26 * H), w('s2', 1 * H)]; // s1 leftovers, now active in s2, but flushed 1h ago
  const d = flushDue(waiting, iso(NOW - 1 * H), NOW, false);
  assert.equal(d.flush, false, 'a finished session no longer flushes on its own — it waits out the cooldown');
});

test('waited past the daily cooldown — flush', () => {
  const d = flushDue([w('s1', 30 * H)], iso(NOW - 25 * H), NOW, false);
  assert.equal(d.flush, true);
  assert.equal(d.reason, 'the scheduled rebuild');
});

test('within the cooldown — collect and wait', () => {
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

test('the cooldown honours the maxAgeMs override (env-style / a user setting)', () => {
  // a one-hour cooldown: last flush two hours ago trips it
  assert.equal(flushDue([w('s1', 2 * H)], iso(NOW - 2 * H), NOW, false, { maxAgeMs: 1 * H }).flush, true);
});

test('flushCooldownMs: named cadences, the env override, and the weekly default', () => {
  const DAY = 24 * H, WEEK = 7 * DAY;
  assert.equal(flushCooldownMs(undefined, undefined), WEEK, 'unset resolves to weekly');
  assert.equal(flushCooldownMs('daily', undefined), DAY);
  assert.equal(flushCooldownMs('weekly', undefined), WEEK);
  assert.equal(flushCooldownMs('weekly', '3600000'), 3600000, 'an exact env override beats the cadence');
  assert.equal(flushCooldownMs('weekly', 'junk'), WEEK, 'a junk env falls back to the cadence');
  assert.equal(flushCooldownMs('weekly', '-5'), WEEK, 'a non-positive env is ignored');
});

test('setFlushCadence stores the choice and readState reads it back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stratless-cadence-'));
  const f = join(dir, 'state.json');
  setFlushCadence('weekly', f);
  assert.equal(readState(f).flushCadence, 'weekly');
  setFlushCadence('daily', f);
  assert.equal(readState(f).flushCadence, 'daily', 'a later choice overwrites the earlier one');
  rmSync(dir, { recursive: true, force: true });
});
