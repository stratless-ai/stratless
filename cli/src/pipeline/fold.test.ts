/**
 * FOLD — the write-side grouping, pinned. The properties that carry it: what folds is decided by
 * arithmetic over injected vectors (deterministic, name-tie-broken); a fold never crosses a
 * section; the ratio wants folds but the FLOOR gets a veto — nothing folds where nothing reads
 * alike (the codex 3-row falsifier); complete linkage cannot chain A–B–C past what A and C
 * actually share; and a two-row file never folds at all (the newcomer case).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { FOLD_FLOOR, FOLD_RATIO, planFolds, voiceGroups, type FoldRow } from './fold.js';

// Unit vectors on the plane: cosine between two is cos(θa − θb), so every link is chosen exactly.
const ang = (deg: number): Float32Array => {
  const r = (deg * Math.PI) / 180;
  return new Float32Array([Math.cos(r), Math.sin(r), 0]);
};

const row = (name: string, section: FoldRow['section'] = 'frame', line = `offer ${name}`): FoldRow => ({ name, section, line });

test('the dial and the floor are the named product constants the session decided', () => {
  assert.equal(FOLD_RATIO, 0.6);
  assert.equal(FOLD_FLOOR, 0.61);
});

test('rows that read alike fold; distinct rows survive — and the output is name-sorted', () => {
  // four rows, target ceil(4 × 0.6) = 3 → one merge wanted; only the twin pair is above the floor
  const rows = [row('walkthrough'), row('plan-first'), row('verify'), row('riff')];
  const vectors = [ang(0), ang(5), ang(90), ang(180)]; // walkthrough·plan-first ≈ 0.996
  const groups = planFolds(rows, vectors);
  assert.deepEqual(groups, [{ section: 'frame', members: ['plan-first', 'walkthrough'] }]);
});

test('a fold never crosses a section, however alike the lines read', () => {
  const rows = [row('a-frame', 'frame'), row('a-judge', 'judge'), row('filler-one'), row('filler-two')];
  const vectors = [ang(0), ang(0), ang(90), ang(180)]; // the identical pair sits in two sections
  assert.deepEqual(planFolds(rows, vectors), []);
});

test('the floor vetoes the ratio: three distinct rows fold nothing — the codex falsifier', () => {
  // target ceil(3 × 0.6) = 2 → the ratio WANTS a merge; every link sits under the floor
  const rows = [row('instruct'), row('compare'), row('probe')];
  const vectors = [ang(0), ang(60), ang(120)]; // pairwise cosines 0.5, 0.5, −0.5
  assert.deepEqual(planFolds(rows, vectors), []);
});

test('complete linkage cannot chain: A~B and B~C do not drag C in when A and C share nothing', () => {
  // five rows, target 3 → two merges wanted. A·B ≈ 0.97; the {A,B}·C link is min(B·C, A·C) and
  // A·C = cos(60°) = 0.5 < floor, so the second merge is vetoed even though B·C ≈ 0.87.
  const rows = [row('a'), row('b'), row('c'), row('d'), row('e')];
  const vectors = [ang(0), ang(15), ang(60), ang(150), ang(240)];
  assert.deepEqual(planFolds(rows, vectors), [{ section: 'frame', members: ['a', 'b'] }]);
});

test('equal links break ties on the smallest member names, so identical inputs always fold identically', () => {
  // two perfect pairs, target 3 → ONE merge only; the tie goes to the lexicographically smaller pair
  const rows = [row('zeta-one'), row('zeta-two'), row('alpha-one'), row('alpha-two')];
  const vectors = [ang(0), ang(0), ang(90), ang(90)];
  assert.deepEqual(planFolds(rows, vectors), [{ section: 'frame', members: ['alpha-one', 'alpha-two'] }]);
});

test('a two-row file never folds, and mismatched inputs fold nothing', () => {
  assert.deepEqual(planFolds([row('a'), row('b')], [ang(0), ang(0)]), []);
  assert.deepEqual(planFolds([row('a')], [ang(0)]), []);
  assert.deepEqual(planFolds([row('a'), row('b')], [ang(0)]), []);
});

test('voiceGroups with no brain on the machine refuses — the caller prints flat rows, never fails', () => {
  const groups = [{ section: 'frame' as const, members: ['a', 'b'] }];
  const members = new Map([
    ['a', { name: 'a', line: 'offer a', signal: '', description: 'does a' }],
    ['b', { name: 'b', line: 'offer b', signal: '', description: 'does b' }],
  ]);
  // Pin the brain to an id that exists on no machine: brainFor resolves an absent pin to nothing,
  // never a substitute — which keeps this test from borrowing a REAL installed assistant.
  const before = process.env.STRATLESS_BRAIN;
  process.env.STRATLESS_BRAIN = 'absent-for-this-test';
  try {
    assert.deepEqual(voiceGroups(groups, members, 'claude-code'), { status: 'refused' });
  } finally {
    if (before === undefined) delete process.env.STRATLESS_BRAIN;
    else process.env.STRATLESS_BRAIN = before;
  }
  assert.deepEqual(voiceGroups([], members, 'claude-code'), { status: 'accepted', specs: [] });
});
