/**
 * RULES — the gap leg's guarantees, pinned. The load-bearing ones: a rule's identity survives a
 * cold rebuild only DECISIVELY (anything less goes dormant, never guesses), every lifecycle exit
 * fires exactly on its pre-registered condition, a quiet window can never close a gap, and the
 * store degrades to empty on corruption instead of throwing.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';

import { readRules, writeRules, anchor, nextState, openRiders, PRINT_CAP, type LiftRule, type RuleHistoryEntry } from './rules.js';

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'stratless-rules-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const DAY = 24 * 3600_000;
const NOW = Date.parse('2026-07-28T10:00:00Z');

const rule = (over: Partial<LiftRule> = {}): LiftRule => ({
  id: 'r1',
  bornAt: new Date(NOW - 10 * DAY).toISOString(),
  pipeline: 'pipe-a',
  anchorName: 'plan',
  centroid: [1, 0, 0],
  x: 'launches work unbounded',
  doThis: 'offer the bound up front',
  y: 'their own tight scope',
  rider: "when work is starting and I haven't set a bound yet, stop and set one with me",
  reachCount: 44,
  slipCount: 16,
  stumbleSessions: 6,
  baseline: 0.01,
  history: [],
  state: 'open',
  ...over,
});

const entry = (over: Partial<RuleHistoryEntry> = {}): RuleHistoryEntry => ({
  builtAt: new Date(NOW).toISOString(),
  slipRate: 0.01,
  stumbleSessions: 2,
  reach: 5,
  sample: 200,
  ...over,
});

// ── the store ───────────────────────────────────────────────────────────────────────────────────

test('the store round-trips, and corruption degrades to empty — never a throw', () => {
  const file = join(dir, 'rules.json');
  writeRules({ rules: [rule()] }, file);
  const back = readRules(file);
  assert.equal(back.rules.length, 1);
  assert.equal(back.rules[0].anchorName, 'plan');
  assert.equal(back.rules[0].doThis, 'offer the bound up front');

  writeFileSync(file, '{ not json');
  assert.deepEqual(readRules(file), { rules: [] });
  writeFileSync(file, JSON.stringify({ rules: [{ id: 'broken' }, 42, null] }));
  assert.deepEqual(readRules(file), { rules: [] }, 'records missing required fields are dropped');
  assert.deepEqual(readRules(join(dir, 'absent.json')), { rules: [] });
});

// ── anchoring ───────────────────────────────────────────────────────────────────────────────────

const engine = (centroids: number[][], labels: string[], pipeline = 'pipe-a') => ({ labels, centroids, pipeline });

test('anchor: a live name keeps its anchor without touching geometry', () => {
  const a = anchor(rule(), new Set(['plan', 'other']), undefined);
  assert.deepEqual(a, { anchorName: 'plan' }, 'steady state needs no engine at all');
});

test('anchor: after a cold rebuild the birth centroid must claim its home decisively', () => {
  const live = new Set(['new-plan', 'new-other']);
  // decisive: best 0.99, runner-up 0.50
  const win = anchor(rule(), live, engine([[0.99, 0.141, 0], [0.5, 0.866, 0]], ['new-plan', 'new-other']));
  assert.deepEqual(win, { anchorName: 'new-plan' });
  // margin too thin: 0.99 vs 0.98
  const thin = anchor(rule(), live, engine([[0.99, 0.141, 0], [0.98, 0.199, 0]], ['new-plan', 'new-other']));
  assert.deepEqual(thin, { dormant: true }, 'a near-tie is a guess, and a guess grafts one axis onto another');
  // best below the floor
  const low = anchor(rule(), live, engine([[0.9, 0.436, 0], [0.5, 0.866, 0]], ['new-plan', 'new-other']));
  assert.deepEqual(low, { dormant: true });
});

test('anchor: cross-pipeline geometry is refused outright', () => {
  const a = anchor(rule(), new Set(['new-plan']), engine([[1, 0, 0]], ['new-plan'], 'pipe-B'));
  assert.deepEqual(a, { dormant: true }, 'cosine across embedding spaces is meaningless');
});

// ── the lifecycle exits ─────────────────────────────────────────────────────────────────────────

test('graduated: the stumbles stopped while the reaching continued — the best exit', () => {
  const r = rule({ history: [entry({ stumbleSessions: 0, reach: 4 }), entry({ stumbleSessions: 0, reach: 3 })] });
  assert.equal(nextState(r, NOW), 'graduated');
});

test('closed: the slips collapsed — and with a mapped action, only if the supply held', () => {
  const collapsed = [entry({ slipRate: 0.004 }), entry({ slipRate: 0.003 })];
  assert.equal(nextState(rule({ history: collapsed }), NOW), 'closed');

  const withAction = rule({ action: 'EnterPlanMode', history: [entry({ slipRate: 0.004 }), entry({ slipRate: 0.003, supplyRatio: 0.9, declinesRose: false })] });
  assert.equal(nextState(withAction, NOW), 'closed', 'supply held, unrefused');

  const supplyDied = rule({ action: 'EnterPlanMode', history: [entry({ slipRate: 0.004 }), entry({ slipRate: 0.003, supplyRatio: 0.4, declinesRose: false })] });
  assert.equal(nextState(supplyDied, NOW), 'open', 'slips fell but so did the doing — that is not closure');
});

test('a quiet window can never close or graduate a gap', () => {
  const quiet = rule({ history: [entry({ slipRate: 0, stumbleSessions: 0, reach: 2, sample: 30 }), entry({ slipRate: 0, stumbleSessions: 0, reach: 2, sample: 20 })] });
  assert.equal(nextState(quiet, NOW), 'open', 'three silent weeks are not a closed gap');
});

test('falsified: enough builds, enough days, and the gap never moved', () => {
  const flat = Array.from({ length: 6 }, (_, i) => entry({ builtAt: new Date(NOW - (6 - i) * DAY).toISOString(), slipRate: 0.009 }));
  const r = rule({ bornAt: new Date(NOW - 50 * DAY).toISOString(), history: flat });
  assert.equal(nextState(r, NOW), 'falsified');
  const young = rule({ bornAt: new Date(NOW - 10 * DAY).toISOString(), history: flat });
  assert.equal(nextState(young, NOW), 'open', 'the same evidence too soon is not a verdict');
});

// ── what prints ─────────────────────────────────────────────────────────────────────────────────

test('openRiders: open rules only, keyed by host, capped, trend on the gap', () => {
  const file = join(dir, 'rows.json');
  const mk = (id: string, slip: number, over: Partial<LiftRule> = {}) => rule({ id, anchorName: id, slipCount: slip, ...over });
  writeRules(
    {
      rules: [
        mk('a', 10, { history: [entry({ slipRate: 0.02 })] }), // opening (2× baseline)
        mk('b', 30, { history: [entry({ slipRate: 0.005 })] }), // closing (0.5× baseline)
        mk('c', 20, { history: [entry({ slipRate: 0.01 })] }), // steady — no trend word
        mk('d', 5, {}),
        mk('e', 99, { state: 'closed' }), // retired — never prints
        mk('f', 50, { rider: undefined }), // not yet backfilled — prints nothing until voiced
      ],
    },
    file,
  );
  const riders = openRiders(file);
  assert.equal(riders.size, PRINT_CAP, 'capped');
  assert.ok(!riders.has('e'), 'a retired rule never prints');
  assert.ok(!riders.has('f'), 'no rider voiced yet, nothing to print');
  assert.equal(riders.get('b')!.trend, 'closing');
  assert.equal(riders.get('c')!.trend, undefined);
  assert.equal(riders.get('a')!.trend, 'opening');
  assert.equal(riders.get('b')!.rider, "when work is starting and I haven't set a bound yet, stop and set one with me", 'the voiced-once clause, verbatim');
});

test('openRiders: a thin recent sample claims no trend', () => {
  const file = join(dir, 'thin.json');
  writeRules({ rules: [rule({ history: [entry({ slipRate: 0.02, sample: 40 })] })] }, file);
  assert.equal(openRiders(file).get('plan')!.trend, undefined, 'below the sample floor the gap makes no claim');
});
