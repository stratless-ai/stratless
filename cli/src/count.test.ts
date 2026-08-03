/**
 * COUNT — the arithmetic, pinned. Pure, so every case is a fixture. The load-bearing one is the
 * scoreboard's TWO gates: an Infinity-lift category with too few conversations must NOT count.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Moment, Pile } from './moments.js';
import type { Category } from './categories.js';
import type { Assignment } from './assign.js';
import { join, tally, computeLift, direction, misfitRate, scoreboard, actionFor, supplyRead, gapCandidates, gapWindowRead, type Labelled } from './count.js';

let seq = 0;
const lab = (pile: Pile, session: string, kinds: string[], ts = '2026-07-01T10:00:00Z'): Labelled => ({
  moment: { key: `k${seq++}`, session, record: 'claude-code', ts, pile, reply: 'x', replyLen: 1 },
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
  const m = (key: string): Moment => ({ key, session: 's', record: 'claude-code', ts: day(1), pile: 'ordinary', reply: 'x', replyLen: 1 });
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

test('direction: fading when the late half thins', () => {
  seq = 0;
  const labelled: Labelled[] = [];
  const fadeDays = new Set([1, 2, 3, 4, 5, 6, 12, 19]);
  for (let d = 1; d <= 20; d++) labelled.push(lab('ordinary', `s${d}`, fadeDays.has(d) ? ['fade'] : [], day(d)));
  assert.equal(direction(labelled, 'fade'), 'fading');
});

/* ——— the two-sided marker fixtures ———
 * The shape mirrors the measured reality that motivated the feature (the fading spike): the person
 * asks for a thing, the assistant answers with an action, the asking fades — and what the action
 * does next decides everything. 24 early ask→answer pairs (days 1–8), 8 late (days 12–17), busy
 * filler so the halves stay populated and the action's base rate stays low. */
const T = (d: number, h = 10, min = 0): string => `2026-07-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`;
const labT = (pile: Pile, session: string, kinds: string[], ts: string, extra: Partial<Moment> = {}): Labelled => ({
  moment: { key: `k${seq++}`, session, record: 'claude-code', ts, pile, reply: 'x', replyLen: 1, ...extra },
  kinds,
});

function askPile(opts: { unpromptedLate: boolean; deniedData?: boolean; lateDenials?: number }): Labelled[] {
  seq = 0;
  const rows: Labelled[] = [];
  for (let i = 0; i < 24; i++) {
    const d = 1 + (i % 8);
    rows.push(labT('ordinary', `e${i}`, ['plan'], T(d)));
    rows.push(labT('ordinary', `e${i}`, [], T(d, 10, 30), { tools: ['Act'] })); // the answer
  }
  for (let i = 0; i < 8; i++) {
    const d = 12 + (i % 6);
    rows.push(labT('ordinary', `l${i}`, ['plan'], T(d)));
    rows.push(labT('ordinary', `l${i}`, [], T(d, 10, 30), { tools: ['Act'], ...(i < (opts.lateDenials ?? 0) ? { denied: ['Act'] } : {}) }));
  }
  // The assistant keeps acting without being asked — the supply a one-sided read cannot see.
  if (opts.unpromptedLate) for (let i = 0; i < 16; i++) rows.push(labT('ordinary', `u${i}`, [], T(12 + (i % 5), 11), { tools: ['Act'] }));
  // Denial data exists in the pile (of some other tool) unless the fixture is testing its absence.
  if (opts.deniedData !== false) rows.push(labT('decline', 'dd', [], T(2, 12), { denied: ['Other'] }));
  for (let i = 0; i < 90; i++) rows.push(labT('ordinary', `fe${i}`, [], T(1 + (i % 8), 14)));
  for (let i = 0; i < 100; i++) rows.push(labT('ordinary', `fl${i}`, [], T(10 + (i % 7), 14)));
  return rows;
}

test('met: a fading ask whose action held steady, unrefused, stamps met — verified, with the action named', () => {
  const rows = askPile({ unpromptedLate: true });
  assert.equal(direction(rows, 'plan'), 'fading', 'the one-sided read alone says fading');
  assert.equal(actionFor(rows, 'plan'), 'Act', 'adjacency maps the ask to the action that answers it');
  const s = tally(rows, [cat('plan')])[0];
  assert.equal(s.direction, 'met');
  assert.equal(s.verified, true);
  assert.equal(s.action, 'Act');
});

test('two-sided fading: when the supply faded with the asking, fading stands — and is verified', () => {
  const rows = askPile({ unpromptedLate: false });
  const s = tally(rows, [cat('plan')])[0];
  assert.equal(s.direction, 'fading');
  assert.equal(s.verified, true, 'both sides agree the fade is real');
});

test('rising declines block met — refusing the action is the person saying no', () => {
  const rows = askPile({ unpromptedLate: true, lateDenials: 3 });
  const s = tally(rows, [cat('plan')])[0];
  assert.equal(s.direction, 'fading', 'supply held but refusals rose — not met');
  assert.equal(s.verified, undefined, 'and not verified either: the sides disagree');
});

test('no denial data anywhere in the pile blocks met — absence of refusals must not read as approval', () => {
  const rows = askPile({ unpromptedLate: true, deniedData: false });
  assert.equal(supplyRead(rows, 'plan'), undefined);
  const s = tally(rows, [cat('plan')])[0];
  assert.equal(s.direction, 'fading');
  assert.equal(s.verified, undefined);
  assert.equal(s.action, undefined);
});

test('the verdict machinery never runs across records — a mixed slice is refused, not averaged', () => {
  // THE DOCTRINE AS AN ASSERTION (2026-08-03): tally's input is one record's slice by construction
  // now — the per-record stores make a mixed pile unbuildable upstream — and `supplyRead` refuses
  // one outright as defense in depth. Both sides of a verdict are one tool's: its tool names, its
  // declines. Averaged across two, the number would describe neither.
  const rows = askPile({ unpromptedLate: true });
  for (let i = 0; i < 20; i++) {
    rows.push(labT('ordinary', `cx${i}`, ['plan'], T(1 + (i % 8), 16), { record: 'codex' }));
  }
  assert.equal(supplyRead(rows, 'plan'), undefined, 'a mixed slice is refused, not averaged');

  // Sliced to one record — the only way the pipeline ever calls it now — the verdict returns.
  const mine = rows.filter((r) => r.moment.record === 'claude-code');
  const s = tally(mine, [cat('plan')])[0];
  assert.equal(s.direction, 'met');
  assert.equal(s.verified, true);
});

test('actionFor: below the adjacency evidence floor, no mapping', () => {
  seq = 0;
  const rows: Labelled[] = [];
  for (let i = 0; i < 10; i++) {
    rows.push(labT('ordinary', `s${i}`, ['plan'], T(1 + i)));
    rows.push(labT('ordinary', `s${i}`, [], T(1 + i, 10, 30), { tools: ['Act'] }));
  }
  for (let i = 0; i < 50; i++) rows.push(labT('ordinary', `f${i}`, [], T(1 + (i % 10), 14)));
  assert.equal(actionFor(rows, 'plan'), undefined, '10 answered asks is anecdote, not a mapping');
});

/* ——— the gap read (LIFT layer 2) ———
 * The fixture mirrors the measured shape: a standard held in ordinary moments, slips recorded as
 * interrupt/decline, stumble sessions (slip with no prior reach) vs guarded sessions (reach came
 * first — the assistant's failure, excluded). Floors: slip ≥ 15 over ≥ 8 sessions, stumbles ≥ 5,
 * reach ≥ 30, lift ≥ 2 with ≥ 3 sessions. */
function gapPile(): Labelled[] {
  seq = 0;
  const rows: Labelled[] = [];
  // 40 pure-reach sessions: the person deploys the standard calmly
  for (let i = 0; i < 40; i++) rows.push(labT('ordinary', `r${i}`, ['plan'], T(1 + (i % 18))));
  // 6 stumble sessions, 2 slips each: the standard only ever arrives as a correction
  for (let i = 0; i < 6; i++) {
    rows.push(labT('interrupt', `st${i}`, ['plan'], T(2 + i)));
    rows.push(labT('decline', `st${i}`, ['plan'], T(2 + i, 11)));
  }
  // 4 guarded sessions: the reach came FIRST, the slip landed anyway — not the person's gap
  for (let i = 0; i < 4; i++) {
    rows.push(labT('ordinary', `g${i}`, ['plan'], T(3 + i)));
    rows.push(labT('interrupt', `g${i}`, ['plan'], T(3 + i, 12)));
  }
  // background so the lift denominators are honest
  for (let i = 0; i < 20; i++) rows.push(labT('interrupt', `bn${i}`, [], T(1 + (i % 18), 15)));
  for (let i = 0; i < 400; i++) rows.push(labT('ordinary', `bo${i}`, [], T(1 + (i % 18), 16)));
  return rows;
}

test('gapCandidates: the stumble/guarded split, and the floors hold', () => {
  const rows = gapPile();
  const cands = gapCandidates(rows, [cat('plan')]);
  assert.equal(cands.length, 1);
  const c = cands[0];
  assert.equal(c.name, 'plan');
  assert.equal(c.slip, 16, '12 stumble slips + 4 guarded slips');
  assert.equal(c.stumbleSessions.length, 6, 'sessions where no reach preceded the slip');
  assert.equal(c.guardedSessions, 4, 'the standard was deployed and slipped anyway — excluded evidence');
  assert.equal(c.reach, 44, '40 calm deployments + 4 guarded first-reaches');
});

test('gapCandidates: below any floor, no candidate — and low lift never enters', () => {
  // same shape but only 4 stumble sessions (below STUMBLE_SESS_MIN)
  seq = 0;
  const rows: Labelled[] = [];
  for (let i = 0; i < 40; i++) rows.push(labT('ordinary', `r${i}`, ['plan'], T(1 + (i % 18))));
  for (let i = 0; i < 4; i++) {
    rows.push(labT('interrupt', `st${i}`, ['plan'], T(2 + i)));
    rows.push(labT('decline', `st${i}`, ['plan'], T(2 + i, 11)));
    rows.push(labT('interrupt', `st${i}`, ['plan'], T(2 + i, 12)));
    rows.push(labT('decline', `st${i}`, ['plan'], T(2 + i, 13)));
  }
  for (let i = 0; i < 20; i++) rows.push(labT('interrupt', `bn${i}`, [], T(1 + (i % 18), 15)));
  for (let i = 0; i < 400; i++) rows.push(labT('ordinary', `bo${i}`, [], T(1 + (i % 18), 16)));
  assert.equal(gapCandidates(rows, [cat('plan')]).length, 0, '16 slips in only 4 sessions is a bad week, not a gap');

  // an everyday category: plenty of slips by count but proportional to its size — lift < 2
  const evr = gapPile().map((l) => (l.kinds.includes('plan') && l.moment.pile !== 'ordinary' ? { ...l, kinds: [] } : l));
  assert.equal(gapCandidates(evr, [cat('plan')]).length, 0, 'no negatives carried → no lift → no entry');
});

test('gapWindowRead: rates over the trailing window; a quiet window reports its thin sample', () => {
  const rows = gapPile();
  const now = Date.parse(T(20));
  const read = gapWindowRead(rows, 'plan', now);
  assert.ok(read.sample > 400, 'the window holds the corpus');
  assert.equal(read.stumbleSessions, 6);
  assert.ok(Math.abs(read.slipRate - 16 / read.sample) < 1e-9);
  const quiet = gapWindowRead(rows, 'plan', now + 100 * 24 * 3600_000);
  assert.equal(quiet.sample, 0, 'far in the future nothing is recent');
});

test('tally: burst flags a category concentrated in one week', () => {
  seq = 0;
  const labelled: Labelled[] = [];
  for (const d of [1, 8, 15, 22, 29]) labelled.push(lab('ordinary', `sp${d}`, ['spread'], day(d))); // one per week
  for (let i = 0; i < 5; i++) labelled.push(lab('ordinary', `bu${i}`, ['bursty'], day(10))); // five in one week
  labelled.push(lab('ordinary', 'bu5', ['bursty'], day(25))); // + one later
  const stats = tally(labelled, [cat('spread'), cat('bursty')]);
  assert.equal(stats.find((s) => s.name === 'spread')!.burst, false, 'spread across weeks is not bursty');
  assert.equal(stats.find((s) => s.name === 'bursty')!.burst, true, 'concentrated in one week is bursty');
});
