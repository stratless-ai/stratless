/**
 * MIRRORVIEW — the free-read renderer. Pure: a Mirror in, labelled rows out. Pins the load-bearing
 * property (the two friction numbers are shown SEPARATELY, never summed), the pick rules for busiest
 * repo and top tool, and the empty-when-no-history contract.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { renderMirror } from './mirrorview.js';
import type { Mirror } from './mirror.js';

/** A complete Mirror with sane values; tests mutate the fields they care about. */
function base(): Mirror {
  return {
    scale: {
      messages: 4443,
      activeDays: 40,
      spanDays: 43,
      medianPerActiveDay: 20,
      longestStreak: 10,
      firstMessage: '2026-06-09',
      lastMessage: '2026-07-21',
    },
    writing: { median: 12, p25: 4, p75: 30, p90: 60, terseShare: 0.3, questionShare: 0.2, pastes: 5, images: 2 },
    friction: { courseCorrections: 119, toolDeclines: 26, permissionStops: 44, systemBlocks: 3, perHundred: 3.26, daysWithAny: 30, events: [] },
    context: {
      repos: [
        { root: '/Users/jx/stratless-mono', messages: 3000 },
        { root: '/Users/jx/other', messages: 100 },
      ],
      branchPairs: 5,
      branchNames: 4,
    },
    work: {
      toolMix: [
        { name: 'Edit', calls: 200, share: 0.5 },
        { name: 'Bash', calls: 100, share: 0.25 },
      ],
      toolCalls: 400,
    },
    rhythm: { byHour: new Array(24).fill(1), hoursFor80: 8, hoursFor90: 12 },
    topics: ['stratless', 'discovery pipeline'],
  };
}

test('the two friction numbers are shown separately — corrections per 100, declines as a count', () => {
  const rows = renderMirror(base());
  const cc = rows.find((r) => r.label === 'course corrections');
  assert.ok(cc, 'course corrections row present');
  assert.equal(cc!.value, '2.68 / 100 messages', '119 / 4443 * 100 = 2.68 — corrections ALONE, not summed');
  const td = rows.find((r) => r.label === 'tool declines');
  assert.equal(td!.value, '26', 'declines are a raw count, kept out of the rate');
});

test('busiest repo is by messages (basename), top tool is its share of all tool calls', () => {
  const rows = renderMirror(base());
  assert.equal(rows.find((r) => r.label === 'busiest repo')!.value, 'stratless-mono');
  assert.equal(rows.find((r) => r.label === 'most-used tool')!.value, 'Edit (50%)');
});

test('rows with no data are skipped, not shown as zeros', () => {
  const m = base();
  m.context.repos = [];
  m.work = { toolMix: [], toolCalls: 0 };
  const rows = renderMirror(m);
  assert.ok(!rows.some((r) => r.label === 'busiest repo'), 'no repo row without repos');
  assert.ok(!rows.some((r) => r.label === 'most-used tool'), 'no tool row without tools');
  assert.ok(rows.some((r) => r.label === 'course corrections'), 'but the friction read still stands');
});

test('no history — no rows at all', () => {
  const m = base();
  m.scale.messages = 0;
  assert.deepEqual(renderMirror(m), []);
});

test('a non-empty toolMix with zero total calls skips the tool row (no divide-by-zero)', () => {
  const m = base();
  m.work = { toolMix: [{ name: 'Edit', calls: 0, share: 0 }], toolCalls: 0 };
  const rows = renderMirror(m);
  assert.ok(!rows.some((r) => r.label === 'most-used tool'), 'guarded on toolCalls, not just toolMix length');
});

test('full: the dashboard adds span and the writing fingerprint; the tight teaser omits them', () => {
  const tight = renderMirror(base());
  assert.ok(!tight.some((r) => r.label === 'span'), 'the door stays tight — no span row');
  assert.ok(!tight.some((r) => r.label === 'how you write'), 'the door stays tight — no writing row');

  const full = renderMirror(base(), { full: true });
  assert.equal(full.find((r) => r.label === 'span')!.value, '2026-06-09 → 2026-07-21 · longest streak 10 days', 'span reads first → last date and the streak');
  assert.equal(full.find((r) => r.label === 'how you write')!.value, 'median 12 words · 30% four words or fewer · 20% questions', 'writing fingerprint from median/terse/question shares');
  assert.equal(full.find((r) => r.label === 'course corrections')!.value, '2.68 / 100 messages', 'the friction read is unchanged by full');
});

test('a repo root with a trailing slash still yields a clean basename', () => {
  const m = base();
  m.context.repos = [{ root: '/Users/jx/stratless-mono/', messages: 10 }];
  assert.equal(renderMirror(m).find((r) => r.label === 'busiest repo')!.value, 'stratless-mono');
});
