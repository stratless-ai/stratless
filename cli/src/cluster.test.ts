/**
 * CLUSTER — the piles. Pure arithmetic, seeded, so determinism and the admission rules pin exactly.
 * The one property worth more than the rest: THE SAME PILE MUST PRODUCE THE SAME PILES. A profile
 * that reshuffles on rebuild destroys the identities that make "rising" and "fading" mean anything.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { admits, bandFor, buildPiles, deriveK, join, kmeans, K_MAX, K_MIN, type Pile } from './cluster.js';
import type { Moment } from './moments.js';

/** A unit vector pointing mostly along one axis — a cheap stand-in for "an embedding". */
const at = (axis: number, dims = 8, jitter = 0): Float32Array => {
  const v = new Float32Array(dims);
  v[axis] = 1;
  if (jitter) v[(axis + 1) % dims] = jitter;
  let n = 0;
  for (let i = 0; i < dims; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < dims; i++) v[i] /= n;
  return v;
};

const moment = (session: string, pile: Moment['pile'] = 'ordinary'): Moment => ({
  key: `${session}:${Math.random()}`,
  session,
  ts: '2026-07-01T00:00:00Z',
  pile,
  reply: 'x',
  replyLen: 1,
});

/** Three well-separated groups, five members each. */
const threeGroups = (): Float32Array[] =>
  [0, 1, 2].flatMap((g) => Array.from({ length: 5 }, (_, i) => at(g, 8, i * 0.02)));

test('kmeans is deterministic — the same pile produces the same piles', () => {
  const X = threeGroups();
  const a = kmeans(X, 3);
  const b = kmeans(X, 3);
  assert.deepEqual([...a.assign], [...b.assign], 'a rebuild must not reshuffle a profile');
});

test('kmeans separates groups that are actually separate', () => {
  const { assign } = kmeans(threeGroups(), 3);
  const groupOf = (start: number) => new Set([...assign.slice(start, start + 5)]);
  assert.equal(groupOf(0).size, 1, 'the first five land together');
  assert.equal(groupOf(5).size, 1, 'so do the second five');
  assert.equal(groupOf(10).size, 1);
  assert.equal(new Set([...assign]).size, 3, 'and they are three different piles');
});

test('deriveK stays inside the product band', () => {
  // The band is set by the profile, not by statistics: under ~8 behaviours is a caricature, over ~30
  // gets cut by the char budget before it reaches the file.
  const k = deriveK(threeGroups());
  assert.ok(k >= K_MIN && k <= K_MAX, `derived K ${k} is inside ${K_MIN}..${K_MAX}`);
});

test('admits: a pattern must span MIN_CONVERSATIONS, not one long day', () => {
  const pile: Pile = { id: 0, members: [0, 1, 2, 3], centroid: at(0) };
  const oneDay = [moment('s1'), moment('s1'), moment('s1'), moment('s1')];
  assert.equal(admits(pile, oneDay), false, 'one conversation is an episode, not a pattern');
  const spread = [moment('s1'), moment('s2'), moment('s3'), moment('s1')];
  assert.equal(admits(pile, spread), true, 'three different conversations earns a place');
});

test('admits: the circular guard prunes a pile that is just our own labelling', () => {
  // A pile built overwhelmingly from interrupts/declines re-derives the anchors we applied ourselves.
  const pile: Pile = { id: 0, members: [0, 1, 2, 3, 4], centroid: at(0) };
  const mostlyAnchors = [
    moment('s1', 'interrupt'), moment('s2', 'interrupt'), moment('s3', 'decline'),
    moment('s4', 'interrupt'), moment('s5', 'ordinary'),
  ];
  assert.equal(admits(pile, mostlyAnchors), false, '80% anchors is circular');
  const mixed = [
    moment('s1', 'interrupt'), moment('s2', 'ordinary'), moment('s3', 'ordinary'),
    moment('s4', 'ordinary'), moment('s5', 'ordinary'),
  ];
  assert.equal(admits(pile, mixed), true, '20% anchors is a real behaviour');
});

test('admits: an empty pile earns nothing', () => {
  assert.equal(admits({ id: 0, members: [], centroid: at(0) }, []), false);
});

test('bandFor: the floor implies a ceiling — a small pile supports few piles', () => {
  // Not tuning to corpus size, which the engine refuses. The same floor rule read backwards: a pile
  // must span 3 conversations, so 6 conversations can support at most 2 piles. Saying so is what
  // lets a small pile produce a SMALL profile rather than an EMPTY one.
  const six = [1, 2, 3, 4, 5, 6].map((i) => moment(`s${i}`));
  assert.deepEqual(bandFor(six), { lo: 2, hi: 2 }, 'six conversations support two patterns');
  const many = Array.from({ length: 300 }, (_, i) => moment(`s${i}`));
  assert.deepEqual(bandFor(many), { lo: K_MIN, hi: K_MAX }, 'a rich pile gets the full band');
  assert.deepEqual(bandFor([moment('s1')]), { lo: 1, hi: 1 }, 'never zero, never negative');
});

test('buildPiles keeps only what earns admission', () => {
  // 15 vectors in 3 separated groups, each member from its own conversation — so the floor is
  // satisfiable and the band (15 conversations -> up to 5 piles) can express the real structure.
  const X = threeGroups();
  const moments = X.map((_, i) => moment(`s${i}`));
  const piles = buildPiles(X, moments);
  assert.ok(piles.length > 0, 'well-separated groups across many conversations survive');
  assert.ok(piles.every((p) => p.members.length > 0));
  assert.ok(piles.every((p) => p.centroid.length === 8), 'every pile carries its centre');
});

test('buildPiles returns nothing when nothing earns a place', () => {
  // One conversation, however many moments: an episode, not a pattern. An empty result is the honest
  // answer, and `write.ts` already treats "nothing earned a place" as a valid outcome.
  const X = threeGroups();
  const sameDay = X.map(() => moment('s1'));
  assert.deepEqual(buildPiles(X, sameDay), [], 'one conversation earns nothing');
});

test('join attaches a new moment to its nearest FROZEN centre', () => {
  // The growth path: centres never move, new moments come to them. This is what stops a daily
  // rebuild from reshuffling the file.
  const centroids = [at(0), at(1), at(2)];
  assert.equal(join(at(1), centroids), 1, 'an exact match joins its own pile');
  assert.equal(join(at(1, 8, 0.3), centroids), 1, 'a near match still joins it');
});
