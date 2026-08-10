/**
 * The seat-and-attach deriver's contract, hermetically: folds seat first, open patches seat
 * their rows, strays attach to the single nearest seat above the floor or stay rows,
 * register-anchored units classify as blocks, 'none' rows never mint, and identical inputs
 * derive identically whatever the row order. The embedder is a fake with hand-placed geometry —
 * under test is the seating arithmetic, not the embedding.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { deriveTune, momentText } from './derive.js';
import type { Embedder } from './derive.js';
import type { RowRecord, TuneInput } from './rows.js';

const row = (over: Partial<RowRecord> & { name: string }): RowRecord => ({
  bornAt: 't0',
  section: 'frame',
  line: `${over.name} line.`,
  signal: '',
  quote: '',
  count: 1,
  ...over,
});

/** Hand-placed geometry: texts sharing a marker word land on the same axis. */
const fakeEmbed =
  (axes: Record<string, number>): Embedder =>
  async (texts) =>
    texts.map((t) => {
      const v = new Float32Array(8);
      const hit = Object.entries(axes).find(([k]) => t.includes(k));
      v[hit ? hit[1] : 7] = 1;
      return v;
    });

test('an open patch seats a skill and its when-clause attracts the matching stray', async () => {
  const plan = row({
    name: 'plan-row',
    count: 270,
    patch: { when: 'planmoment a new task begins', doThis: 'offer a plan', ownVoice: '', reach: 228, slip: 28, state: 'open' },
  });
  const walk = row({ name: 'walk-row', line: 'planmoment walk them through.', count: 288 });
  const lone = row({ name: 'lone-row', line: 'entirely elsewhere.', count: 5 });
  const tune = await deriveTune({ rows: [plan, walk, lone], groups: [], meta: {} }, fakeEmbed({ planmoment: 0 }));

  assert.equal(tune.units.length, 1);
  const u = tune.units[0]!;
  assert.equal(u.kind, 'active');
  assert.equal(u.seat.patchHome, 'plan-row');
  assert.deepEqual(u.members.map((m) => m.name).sort(), ['plan-row', 'walk-row']);
  assert.equal(u.attached.length, 1);
  assert.equal(u.attached[0]!.row.name, 'walk-row');
  assert.ok(u.attached[0]!.link >= 0.61);
  assert.deepEqual(tune.leftovers.map((m) => m.name), ['lone-row']);
});

test('a healed patch does not seat — its row strays like any other', async () => {
  const healed = row({
    name: 'healed-row',
    patch: { when: 'oldmoment', doThis: '', ownVoice: '', reach: 10, slip: 2, state: 'healed' },
  });
  const tune = await deriveTune({ rows: [healed], groups: [], meta: {} }, fakeEmbed({}));
  assert.equal(tune.units.length, 0);
  assert.deepEqual(tune.leftovers.map((m) => m.name), ['healed-row']);
});

test('stored folds seat first, and a register member classifies the unit as a block', async () => {
  const terse = row({ name: 'terse-row', section: 'register', count: 329 });
  const git = row({ name: 'git-row', section: 'register', count: 157 });
  const verify = row({ name: 'verify-row', section: 'judge', count: 198 });
  const commit = row({ name: 'commit-row', section: 'judge', count: 159 });
  const input: TuneInput = {
    rows: [terse, git, verify, commit],
    groups: [
      { line: 'match their terse style.', facets: ['imperative', 'git one-liner'], members: [terse, git] },
      { line: 'catch anything unverified.', facets: ['remote', 'commit'], members: [verify, commit] },
    ],
    meta: {},
  };
  const tune = await deriveTune(input, fakeEmbed({}));
  assert.equal(tune.units.length, 2);
  const block = tune.units.find((u) => u.anchor === 'terse-row')!;
  const skill = tune.units.find((u) => u.anchor === 'verify-row')!;
  assert.equal(block.kind, 'ambient');
  assert.equal(skill.kind, 'active');
  assert.ok(skill.seat.group);
  assert.equal(tune.leftovers.length, 0);
});

test('a stray attaches to its single NEAREST seat, not to every seat above the floor', async () => {
  // two seats on different axes; the stray shares the second seat's axis only
  const a = row({ name: 'a-seat', patch: { when: 'alpha moment', doThis: '', ownVoice: '', reach: 1, slip: 1, state: 'open' } });
  const b = row({ name: 'b-seat', patch: { when: 'beta moment', doThis: '', ownVoice: '', reach: 1, slip: 1, state: 'open' } });
  const stray = row({ name: 'stray-row', line: 'beta flavored thing.' });
  const tune = await deriveTune({ rows: [a, b, stray], groups: [], meta: {} }, fakeEmbed({ alpha: 0, beta: 1 }));
  const bUnit = tune.units.find((u) => u.anchor === 'b-seat')!;
  const aUnit = tune.units.find((u) => u.anchor === 'a-seat')!;
  assert.deepEqual(bUnit.members.map((m) => m.name).sort(), ['b-seat', 'stray-row']);
  assert.deepEqual(aUnit.members.map((m) => m.name), ['a-seat']);
});

test("section 'none' rows never seat, never attach, never strand", async () => {
  const vent = row({ name: 'vent-row', section: 'none', count: 300 });
  const tune = await deriveTune({ rows: [vent], groups: [], meta: {} }, fakeEmbed({}));
  assert.deepEqual(tune, { units: [], leftovers: [] });
});

test('derivation is order-independent', async () => {
  const rows = [
    row({ name: 'p-row', count: 10, patch: { when: 'planmoment', doThis: '', ownVoice: '', reach: 1, slip: 1, state: 'open' } }),
    row({ name: 'w-row', line: 'planmoment adjacent.', count: 20 }),
    row({ name: 'r1-row', section: 'register', count: 30 }),
    row({ name: 'r2-row', section: 'register', count: 40 }),
    row({ name: 'x-row', line: 'alone.', count: 1 }),
  ];
  const groups = [{ line: 'style fold.', facets: ['a', 'b'], members: [rows[2]!, rows[3]!] }];
  const embed = fakeEmbed({ planmoment: 0 });
  const fwd = await deriveTune({ rows, groups, meta: {} }, embed);
  const rev = await deriveTune({ rows: [...rows].reverse(), groups, meta: {} }, embed);
  assert.deepEqual(
    fwd.units.map((u) => ({ k: u.kind, m: u.members.map((x) => x.name).sort() })),
    rev.units.map((u) => ({ k: u.kind, m: u.members.map((x) => x.name).sort() })),
  );
  assert.deepEqual(fwd.leftovers.map((m) => m.name), rev.leftovers.map((m) => m.name));
});

test('momentText is the voiced line plus the decode signal', () => {
  const bare = row({ name: 'b', line: 'the line.', signal: 'the signal' });
  assert.equal(momentText(bare), 'the line. the signal');
});

test('the actuator gate: prediction-shaped folds never seat; their members stay rows', async () => {
  const q1 = row({ name: 'q1-row', section: 'judge', count: 551 });
  const q2 = row({ name: 'q2-row', section: 'judge', count: 295 });
  const verify = row({ name: 'verify-row', section: 'judge', count: 198 });
  const commit = row({ name: 'commit-row', section: 'judge', count: 159 });
  const input: TuneInput = {
    rows: [q1, q2, verify, commit],
    groups: [
      { line: 'expect them to push past vague answers until the mechanism is named.', facets: ['a', 'b'], members: [q1, q2] },
      { line: 'catch anything unverified before continuing.', facets: ['c', 'd'], members: [verify, commit] },
    ],
    meta: {},
  };
  const tune = await deriveTune(input, fakeEmbed({}));
  assert.equal(tune.units.length, 1);
  assert.equal(tune.units[0]!.anchor, 'verify-row');
  assert.deepEqual(tune.leftovers.map((m) => m.name).sort(), ['q1-row', 'q2-row']);
});

test('the stage ladder: count bands over skills, with the active floor', async () => {
  const { stageOf } = await import('./derive.js');
  const mk = (kinds: import('./derive.js').UnitKind[]): import('./derive.js').DerivedTune => ({
    units: kinds.map((k, i) => ({ kind: k, anchor: `u${i}`, seat: {}, members: [], attached: [] })),
    leftovers: [],
  });
  assert.equal(stageOf(mk([])), 'base-map');
  assert.equal(stageOf(mk(['ambient', 'triggered'])), 'base-map'); // no active habit → no stage
  assert.equal(stageOf(mk(['active'])), 'stage-1');
  assert.equal(stageOf(mk(['active', 'triggered'])), 'stage-1');
  assert.equal(stageOf(mk(['active', 'triggered', 'triggered'])), 'stage-2');
  assert.equal(stageOf(mk(['active', 'active', 'triggered', 'triggered'])), 'stage-2');
  assert.equal(stageOf(mk(['active', 'active', 'active', 'triggered', 'triggered', 'ambient'])), 'stage-3');
});
