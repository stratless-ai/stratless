/**
 * ENGINE — the two guarantees that a silent failure would have broken, both found in a diligence
 * pass rather than by a test: the UPGRADE PATH, and REPLACE-not-append on a cold build.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { engineReady, loadEngine, saveEngine } from './engine.js';
import { writeAssignments, loadAssignments } from './assign.js';

const scratch = (name: string): string => join(mkdtempSync(join(tmpdir(), 'engine-')), name);

test('engineReady: a machine with categories but NO frozen model is NOT ready', () => {
  // THE UPGRADE CASE. A machine that ran a previous engine has categories.jsonl and no engine.json.
  // Branching cold-vs-steady on categories alone sent it down the steady path forever: nothing to
  // join against, nothing placed, silently never updating again. The worker asks THIS instead.
  const missing = scratch('engine.json');
  assert.equal(engineReady(missing), false, 'no engine file at all');

  const empty = scratch('engine.json');
  saveEngine({ vocab: ['the'], centroids: [], labels: [], builtAt: 'x' }, empty);
  assert.equal(engineReady(empty), false, 'a model with no centres cannot place anything');

  const mismatched = scratch('engine.json');
  saveEngine({ vocab: ['the'], centroids: [[1, 0]], labels: [], builtAt: 'x' }, mismatched);
  assert.equal(engineReady(mismatched), false, 'centres without labels cannot name what a moment joined');

  const good = scratch('engine.json');
  saveEngine({ vocab: ['the'], centroids: [[1, 0]], labels: ['asks-for-a-plan'], builtAt: 'x' }, good);
  assert.equal(engineReady(good), true);
});

test('a corrupt engine file reads as not-ready rather than crashing a background worker', () => {
  const f = scratch('engine.json');
  writeFileSync(f, '{ not json');
  assert.equal(loadEngine(f), undefined);
  assert.equal(engineReady(f), false);
});

test('writeAssignments replace TRUNCATES — a cold build must not double every count', () => {
  // count.join() emits one row per RECORD, so a moment left holding an older row is counted twice
  // and every number in the profile inflates. This is what an upgrade would have done.
  const f = scratch('assignments.jsonl');
  writeAssignments([{ key: 'a', at: 't1', kinds: ['old-name'] }], f);
  writeAssignments([{ key: 'a', at: 't2', kinds: ['new-name'] }], f, 'replace');
  const rows = loadAssignments(f);
  assert.equal(rows.length, 1, 'one moment, one record — not two');
  assert.deepEqual(rows[0].kinds, ['new-name'], 'the cold build establishes the whole set');
});

test('writeAssignments append is still append — growth adds to what is there', () => {
  const f = scratch('assignments.jsonl');
  writeAssignments([{ key: 'a', at: 't1', kinds: ['x'] }], f);
  writeAssignments([{ key: 'b', at: 't2', kinds: ['y'] }], f);
  assert.equal(loadAssignments(f).length, 2);
});
