/**
 * COUNT — the arithmetic, pinned. Pure, so every case is a fixture. The load-bearing one is the
 * scoreboard's TWO gates: an Infinity-lift category with too few conversations must NOT count.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Moment, Pile } from './moments.js';
import type { Category } from './categories.js';
import type { Assignment } from './assign.js';
import { join, tally, computeLift, direction, misfitRate, scoreboard, scoreboardLine, type Labelled } from './count.js';

let seq = 0;
const lab = (pile: Pile, session: string, kinds: string[], ts = '2026-07-01T10:00:00Z'): Labelled => ({
  moment: { key: `k${seq++}`, session, ts, pile, reply: 'x', replyLen: 1 },
  kinds,
});
const cat = (name: string): Category => ({ name, description: name, bornAt: '2026-06-01T00:00:00Z' });
const day = (d: number): string => `2026-07-${String(d).padStart(2, '0')}T10:00:00Z`;

test('computeLift: ratio, Infinity for distress-only, zero for never', () => {
  assert.equal(computeLift(3, 6, 1, 6), 3); // (3/6)/(1/6)
  assert.equal(computeLift(3, 5, 0, 6), Infinity); // only ever in distress
  assert.equal(computeLift(0, 5, 4, 6), 0); // never in distress
  assert.equal(computeLift(0, 0, 0, 0), 0); // nothing at all
});

test('join: pairs moments to kinds, drops assignments whose moment is gone', () => {
  const m = (key: string): Moment => ({ key, session: 's', ts: day(1), pile: 'ordinary', reply: 'x', replyLen: 1 });
  const joined = join([m('a'), m('b')], [
    { key: 'a', at: day(2), kinds: ['x'] },
    { key: 'gone', at: day(2), kinds: ['y'] },
  ] as Assignment[]);
  assert.equal(joined.length, 1);
  assert.equal(joined[0].moment.key, 'a');
  assert.deepEqual(joined[0].kinds, ['x']);
});

test('scoreboard: only distress AND well-evidenced categories count — the floor excludes a fluke', () => {
  seq = 0;
  const labelled: Labelled[] = [
    // drift: distress-only (Infinity lift) across 3 conversations → clears BOTH gates → COUNTS
    lab('interrupt', 's1', ['drift']),
    lab('interrupt', 's2', ['drift']),
    lab('decline', 's3', ['drift']),
    // chatty: distress-only too (Infinity lift) but only 2 conversations → the floor EXCLUDES it
    lab('interrupt', 's4', ['chatty']),
    lab('interrupt', 's5', ['chatty']),
    // plan: well-evidenced but ordinary → low lift → excluded
    lab('ordinary', 's6', ['plan']),
    lab('ordinary', 's7', ['plan']),
    lab('ordinary', 's8', ['plan']),
    lab('ordinary', 's9', ['plan']),
    // pure misfits
    lab('ordinary', 's10', []),
    lab('ordinary', 's11', []),
  ];
  const cats = [cat('drift'), cat('chatty'), cat('plan')];

  const stats = tally(labelled, cats);
  const chatty = stats.find((s) => s.name === 'chatty')!;
  assert.equal(chatty.lift, Infinity, 'chatty IS a distress signal by lift');
  assert.equal(chatty.sessions, 2, 'but only 2 conversations');

  const board = scoreboard(labelled, cats);
  assert.deepEqual(board.signalCategories, ['drift'], 'the floor keeps the 2-conversation fluke out');
  assert.equal(board.signalMoments, 3);
  assert.equal(board.total, 11);
  assert.equal(board.rate, 27.3); // 3/11*100
});

test('misfitRate: share matching nothing, bounded by `since`', () => {
  seq = 0;
  const labelled: Labelled[] = [
    lab('ordinary', 's1', [], day(1)),
    lab('ordinary', 's2', [], day(2)),
    lab('ordinary', 's3', ['x'], day(10)),
    lab('ordinary', 's4', ['x'], day(11)),
  ];
  assert.equal(misfitRate(labelled), 0.5); // 2 of 4 matched nothing
  assert.equal(misfitRate(labelled, { since: new Date(day(5)) }), 0); // only the two later (matched) ones
});

test('direction: rising when the late half is denser; undefined below the evidence floor', () => {
  seq = 0;
  const labelled: Labelled[] = [];
  const riseDays = new Set([1, 2, 11, 12, 13, 14, 15, 16]);
  for (let d = 1; d <= 20; d++) labelled.push(lab('ordinary', `s${d}`, riseDays.has(d) ? ['rise'] : [], day(d)));
  assert.equal(direction(labelled, 'rise'), 'rising');

  seq = 0;
  const few: Labelled[] = [lab('ordinary', 's1', ['x'], day(1)), lab('ordinary', 's2', ['x'], day(2)), lab('ordinary', 's3', ['x'], day(3))];
  assert.equal(direction(few, 'x'), undefined, 'three points is not a trend');
});

test('scoreboardLine: bare, then with the last-build delta', () => {
  const board = { rate: 5.2, signalMoments: 3, total: 58, signalCategories: ['drift'] };
  assert.equal(scoreboardLine(board), 'corrections: 5.2 per 100 messages');
  assert.equal(scoreboardLine(board, 6.1), 'corrections: 5.2 per 100 messages  (was 6.1 last build)');
});
