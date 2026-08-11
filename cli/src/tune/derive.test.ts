/**
 * The seat-and-attach deriver's contract, hermetically: folds seat first, open patches seat
 * their rows, strays attach to the single nearest seat above the floor or stay rows,
 * register-anchored units classify as blocks, 'none' rows never mint, and identical inputs
 * derive identically whatever the row order. The embedder is a fake with hand-placed geometry —
 * under test is the seating arithmetic, not the embedding.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';


type Ex = import('../pipeline/exchange.js').Exchange;
const mkEx = (session: string, i: number, over: Partial<Ex> = {}): Ex => ({
  prompt: 'p', said: 's', reaction: 'not like that', ts: `2026-08-0${1 + (i % 8)}T00:0${i % 10}:00Z`,
  session, record: 'test', hash: `${session}-${i}`, ...over,
} as Ex);

test('rituals: recurring command chains surface; sub-grams with equal support fold away', async () => {
  const { findRituals } = await import('./derive.js');
  const chains = new Map([
    ['s1', ['git add', 'git commit', 'git log', 'pnpm test']],
    ['s2', ['git add', 'git commit', 'git log']],
    ['s3', ['git add', 'git commit', 'git log']],
    ['s4', ['git add', 'git commit', 'git log', 'git push']],
  ]);
  const out = findRituals(chains, 'test');
  assert.ok(out.length >= 1);
  assert.ok((out[0]!.detail!.tokens as string[]).length >= 3);
  assert.equal(out[0]!.receipts.occurrences, 4);
  assert.equal(out[0]!.receipts.sessions, 4);
  assert.ok(out[0]!.id.startsWith('ritual:test:'));
  assert.deepEqual(out, findRituals(chains, 'test'), 'byte-deterministic');
});

test('lessons: seeds chain into episodes; cheap singletons drop', async () => {
  const { findLessons, sessionsOf } = await import('./derive.js');
  const exchanges: Ex[] = [
    mkEx('a', 0, { interrupted: 'plain' }), mkEx('a', 1), mkEx('a', 2, { declined: true }), mkEx('a', 3), mkEx('a', 4, { interrupted: 'plain' }),
    mkEx('b', 0, { interrupted: 'plain' }), // lone cheap seed — must drop
  ].reverse(); // the iterator is newest-first
  const out = findLessons(sessionsOf(exchanges, 'test'), 'test');
  assert.equal(out.length, 1);
  assert.equal(out[0]!.receipts.corrections, 3);
  assert.equal(out[0]!.receipts.exchanges, 5);
  assert.equal(out[0]!.exemplars[0]!.hash, 'a-0');
});

test('rules: cross-session floors hold; digits stay out of claims', async () => {
  const { findRules, sessionsOf } = await import('./derive.js');
  const exchanges: Ex[] = [
    mkEx('a', 0, { prompt: 'merged watch the ci 2' }), mkEx('b', 0, { prompt: 'merged watch the ci 2' }), mkEx('c', 0, { prompt: 'merged watch the ci 2' }),
    mkEx('a', 1, { prompt: 'one session burst' }), mkEx('a', 2, { prompt: 'one session burst' }), mkEx('a', 3, { prompt: 'one session burst' }),
  ];
  const out = findRules(sessionsOf(exchanges, 'test'), 'test');
  assert.equal(out.length, 1);
  assert.ok(out[0]!.claim.includes('merged watch the ci'));
  assert.equal(/[0-9]/.test(out[0]!.claim), false, 'claims carry no digits');
  assert.equal(out[0]!.receipts.sessions, 3);
});

test('wins and arrivals: approvals count with context; new terms need spread', async () => {
  const { findWins, findArrivals, sessionsOf } = await import('./derive.js');
  const exchanges: Ex[] = [];
  for (let s = 0; s < 6; s++) {
    exchanges.push(mkEx(`s${s}`, 0, { prompt: 'discussing the consultation approach today', ts: `2026-08-2${s}T00:00:00Z`, said: 'the thing it did' }));
    for (let i = 1; i <= 3; i++)
      exchanges.push(mkEx(`s${s}`, i, { prompt: `more consultation talk number ${i}`, ts: `2026-08-2${s}T00:0${i}:00Z`, said: 'the thing it did' }));
  }
  exchanges.push(mkEx('s0', 9, { prompt: 'exactly this is right', ts: '2026-08-20T01:00:00Z' }));
  const sessions = sessionsOf(exchanges.reverse(), 'test');
  const wins = findWins(sessions, 'test');
  assert.equal(wins.length, 1);
  assert.equal(wins[0]!.receipts.approvals, 1);
  const arrivals = findArrivals(sessions, 'test');
  assert.ok(arrivals.some((f) => f.detail!.term === 'consultation'), 'the arriving term surfaces');
});
