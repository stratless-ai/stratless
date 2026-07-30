/**
 * MIRRORVIEW — the free-read renderer. Pure: a Mirror in, labelled rows out. Pins the load-bearing
 * property (the two friction numbers are shown SEPARATELY, never summed), the pick rules for busiest
 * repo and top tool, and the empty-when-no-history contract.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { renderMirror, renderCard } from './mirrorview.js';
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
    writing: { median: 12, p25: 4, p75: 30, p90: 60, terseShare: 0.3, questionShare: 0.2, pastes: 5, images: 2, repeated: [] },
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
      agentRuns: 40,
      agentMix: [
        { name: 'Explore', runs: 24, share: 0.6 },
        { name: 'general-purpose', runs: 12, share: 0.3 },
      ],
      skillUses: 10,
      skillMix: [{ name: 'research', uses: 5, share: 0.5 }],
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
  m.work = { toolMix: [], toolCalls: 0, agentRuns: 0, agentMix: [], skillUses: 0, skillMix: [] };
  const rows = renderMirror(m);
  assert.ok(!rows.some((r) => r.label === 'busiest repo'), 'no repo row without repos');
  assert.ok(!rows.some((r) => r.label === 'most-used tool'), 'no tool row without tools');
  assert.ok(!rows.some((r) => r.label === 'work it handed off'), 'no delegation row for someone who never delegates');
  assert.ok(!rows.some((r) => r.label === 'skills it loaded'), 'no skills row for someone whose assistant loaded none');
  assert.ok(rows.some((r) => r.label === 'course corrections'), 'but the friction read still stands');
});

test('no history — no rows at all', () => {
  const m = base();
  m.scale.messages = 0;
  assert.deepEqual(renderMirror(m), []);
});

test('a non-empty toolMix with zero total calls skips the tool row (no divide-by-zero)', () => {
  const m = base();
  m.work = { toolMix: [{ name: 'Edit', calls: 0, share: 0 }], toolCalls: 0, agentRuns: 0, agentMix: [], skillUses: 0, skillMix: [] };
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

// ── The vault rows (2026-07-27): fields the mirror always computed, promoted into the FULL read
// only — the init door's tight teaser must not grow, and the card must never quote the person.

test('full: the vault rows appear — median day, the person\'s words, screenshots, friction days, the uncounted interrupts', () => {
  const m = base();
  m.writing.repeated = [
    { text: 'go', count: 20 },
    { text: 'continue', count: 18 },
    { text: 'sure', count: 11 },
    { text: 'yes', count: 7 },
  ];
  const full = renderMirror(m, { full: true });
  assert.equal(full.find((r) => r.label === 'a median day')!.value, '20 messages');
  assert.equal(
    full.find((r) => r.label === 'what you keep typing')!.value,
    '"go" 20× · "continue" 18× · "sure" 11×',
    'top three repeats only, exact text quoted',
  );
  assert.equal(full.find((r) => r.label === 'screenshots sent')!.value, '2');
  assert.equal(full.find((r) => r.label === 'friction days')!.value, '30 of 40 active days');
  assert.equal(
    full.find((r) => r.label === 'not counted against you')!.value,
    '44 permission stops · 3 system blocks',
    'the interrupts excluded from the rate are shown, never silently dropped (mirror.ts:69)',
  );
  assert.equal(
    full.find((r) => r.label === 'busiest repo')!.value,
    'stratless-mono · across 2 repos · 4 branches',
    'the full read carries the spread beside the basename',
  );
  assert.equal(
    full.find((r) => r.label === 'tools it ran for you')!.value,
    '400 calls · Edit 50% · Bash 25%',
    'delegation scale plus the top of the mix',
  );
  assert.ok(!full.some((r) => r.label === 'most-used tool'), 'the single-tool row is replaced by the mix in full');
});

test('the door teaser gains none of the vault rows', () => {
  const m = base();
  m.writing.repeated = [{ text: 'go', count: 20 }];
  const tight = renderMirror(m);
  for (const label of [
    'a median day',
    'what you keep typing',
    'screenshots sent',
    'friction days',
    'not counted against you',
    'tools it ran for you',
  ]) {
    assert.ok(!tight.some((r) => r.label === label), `door has no "${label}" row`);
  }
  assert.equal(tight.find((r) => r.label === 'busiest repo')!.value, 'stratless-mono', 'door repo row stays bare — no spread');
  assert.equal(tight.find((r) => r.label === 'most-used tool')!.value, 'Edit (50%)', 'door keeps the single top tool');
});

test('the card never quotes the person — writing.repeated is terminal-only', () => {
  const m = base();
  m.writing.repeated = [{ text: 'acme-payments rollout', count: 9 }];
  const rows = renderCard(m);
  assert.ok(!rows.some((r) => r.label === 'what you keep typing'), 'no words row on the shareable card');
  assert.ok(!rows.some((r) => r.value.includes('acme-payments')), 'no repeated text leaks into any card value');
});

// ── The shareable card (`renderCard`) — the screenshot-safe subset. Same numbers as the full read,
// minus anything that can carry a name, and the two friction numbers still separate.

test('the card omits the busiest-repo row — a repo basename can be a client/project name', () => {
  const rows = renderCard(base());
  assert.ok(!rows.some((r) => r.label === 'busiest repo'), 'no repo row on the shareable card');
  // and no row value carries the repo basename anywhere
  assert.ok(!rows.some((r) => r.value.includes('stratless-mono')), 'no repo name leaks into any card value');
});

test('the card keeps the two friction numbers separate — never summed', () => {
  const rows = renderCard(base());
  assert.equal(rows.find((r) => r.label === 'course corrections')!.value, '2.68 / 100 messages', 'corrections ALONE (119/4443*100), not summed with declines');
  assert.equal(rows.find((r) => r.label === 'tool declines')!.value, '26', 'declines as a raw count');
});

test('the card carries the universal, safe rows: activity, writing, top tool', () => {
  const rows = renderCard(base());
  assert.equal(rows.find((r) => r.label === 'activity')!.value, '4,443 messages · 40 active days · longest streak 10 days');
  assert.equal(rows.find((r) => r.label === 'how you write')!.value, 'median 12 words · 30% four words or fewer · 20% questions');
  assert.equal(rows.find((r) => r.label === 'most-used tool')!.value, 'Edit (50%)');
});

test('the card is empty when there is no history', () => {
  const m = base();
  m.scale.messages = 0;
  assert.deepEqual(renderCard(m), []);
});
