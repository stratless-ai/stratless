/**
 * The assembler's contract: counts are tallied not stored, patches attach by home with open
 * winning, groups keep facet↔member alignment through drops, and a damaged or absent store
 * degrades to a smaller input, never a throw. All hermetic — a synthetic record in a tmp dir,
 * no dependence on any real ~/.stratless.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { assembleTuneInput } from './rows.js';

function syntheticStore() {
  const dir = mkdtempSync(join(tmpdir(), 'tune-rows-'));
  const voiced = join(dir, 'voiced.json');
  const lift = join(dir, 'lift.json');
  const assignments = join(dir, 'assignments.jsonl');

  writeFileSync(
    voiced,
    JSON.stringify({
      rows: [
        { name: 'plan-row', bornAt: 't0', section: 'frame', line: 'offer a plan first.', signal: 'wants a plan', quote: '', voicedAt: 't1' },
        { name: 'verify-row', bornAt: 't0', section: 'judge', line: 'verify remote state.', signal: 'wants proof', quote: '', voicedAt: 't1' },
        { name: 'commit-row', bornAt: 't0', section: 'judge', line: 'commit before continuing.', signal: 'wants it locked', quote: '', voicedAt: 't1' },
        { name: 'terse-row', bornAt: 't0', section: 'register', line: 'reply tersely.', signal: 'wants next action', quote: 'go', voicedAt: 't1' },
      ],
      groups: [
        {
          members: [
            { name: 'verify-row', bornAt: 't0' },
            { name: 'commit-row', bornAt: 't0' },
            { name: 'gone-row', bornAt: 't0' },
          ],
          line: 'catch anything unverified or uncommitted.',
          facets: ['remote state unverified', 'uncommitted work', 'facet of a vanished row'],
          voicedAt: 't1',
        },
      ],
    }),
  );

  writeFileSync(
    lift,
    JSON.stringify({
      patches: [
        {
          id: 'p-healed', bornAt: 't0', mode: 1, form: 'sharpen', home: 'plan-row',
          pipeline: 'test', evidence: { reach: 10, slip: 2 }, baseline: { fail: 0 },
          wording: { text: 'old when', x: '', doThis: 'old move', y: '' }, history: [], state: 'healed',
        },
        {
          id: 'p-open', bornAt: 't1', mode: 1, form: 'sharpen', home: 'plan-row',
          pipeline: 'test', evidence: { reach: 228, slip: 28 }, baseline: { fail: 0 },
          wording: { text: 'when a new task begins, pause and offer a plan', x: 'started without a plan', doThis: 'propose a concise plan and pause', y: 'plan it out before we start' },
          action: 'EnterPlanMode', history: [], state: 'open',
        },
      ],
      meta: { asks: 840, sessions: 109, bounces: 93, specPhrases: [] },
      delegatedZones: 366,
    }),
  );

  writeFileSync(
    assignments,
    [
      JSON.stringify({ key: 'm1', at: 't2', kinds: ['plan-row'] }),
      JSON.stringify({ key: 'm2', at: 't2', kinds: ['plan-row', 'terse-row'] }),
      'not json — a torn line that must be skipped',
      JSON.stringify({ key: 'm3', at: 't2', kinds: ['verify-row'] }),
    ].join('\n'),
  );

  return { voiced, lift, assignments };
}

test('assembles rows with tallied counts and the open patch by home', () => {
  const files = syntheticStore();
  const input = assembleTuneInput('test-record', files);

  assert.equal(input.rows.length, 4);
  const plan = input.rows.find((r) => r.name === 'plan-row');
  assert.ok(plan);
  assert.equal(plan.count, 2); // tallied across two assignments
  assert.ok(plan.patch);
  assert.equal(plan.patch.state, 'open'); // the open patch outranks the healed one on the same home
  assert.equal(plan.patch.doThis, 'propose a concise plan and pause');
  assert.equal(plan.patch.action, 'EnterPlanMode');
  assert.equal(plan.patch.reach, 228);
  assert.equal(plan.patch.slip, 28);

  const terse = input.rows.find((r) => r.name === 'terse-row');
  assert.ok(terse);
  assert.equal(terse.count, 1);
  assert.equal(terse.quote, 'go'); // trigger vocabulary survives assembly
  assert.equal(terse.patch, undefined);

  assert.equal(input.meta.asks, 840);
  assert.equal(input.meta.delegatedZones, 366);
});

test('groups resolve members to rows and keep facets aligned through a dropped member', () => {
  const files = syntheticStore();
  const input = assembleTuneInput('test-record', files);

  assert.equal(input.groups.length, 1);
  const g = input.groups[0]!;
  // gone-row is not in voiced.rows: it drops WITH its facet, alignment intact
  assert.deepEqual(g.members.map((m) => m.name), ['verify-row', 'commit-row']);
  assert.deepEqual(g.facets, ['remote state unverified', 'uncommitted work']);
  assert.equal(g.members[0]!.count, 1); // members are the assembled rows, counts included
});

test('absent stores degrade to an empty input, never a throw', () => {
  const input = assembleTuneInput('test-record', {
    voiced: '/nonexistent/voiced.json',
    lift: '/nonexistent/lift.json',
    assignments: '/nonexistent/assignments.jsonl',
  });
  assert.deepEqual(input.rows, []);
  assert.deepEqual(input.groups, []);
});
