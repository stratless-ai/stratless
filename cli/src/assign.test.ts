/**
 * ASSIGN — the spend, pinned against a FAKE claude (no network, no real model). The guarantees:
 * one record per moment (empty kinds kept), invalid names filtered, idempotent re-runs, a clean
 * no-op without categories, and the coverage guard that refuses a truncated batch rather than
 * freezing partial silence as matched-nothing. Every store is a temp file — nothing touches the
 * real ~/.stratless, spend-metering included (STRATLESS_USAGE).
 */
import { strict as assert } from 'node:assert';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';

import { assignMoments, assignAgainst, loadAssignments } from './assign.js';
import { appendCategories } from './categories.js';
import { loadMoments, type Moment } from './moments.js';

// A fake `claude`: it reads the moments it was shown and — unless FAKE_MODE=thin — returns an
// assignment for every one (drift for #1, an INVALID name for #2, empty for the rest). `thin`
// answers only the first, which trips the coverage guard.
const FAKE = `#!/usr/bin/env node
const args = process.argv.slice(2);
const input = args.find((a) => a.includes('MOMENTS:')) || '';
const ids = [...input.matchAll(/(?:^|\\n)#(\\d+)/g)].map((m) => Number(m[1]));
const picks = process.env.FAKE_MODE === 'thin' ? ids.slice(0, 1) : ids;
const assignments = picks.map((id) => ({ id, kinds: id === 1 ? ['drift'] : id === 2 ? ['bogus'] : [] }));
process.stdout.write(JSON.stringify({ result: JSON.stringify({ assignments }), is_error: false, total_cost_usd: 0.0001, usage: { input_tokens: 1, output_tokens: 1 } }));
`;

const ENV_KEYS = ['STRATLESS_MOMENTS', 'STRATLESS_CATEGORIES', 'STRATLESS_ASSIGNMENTS', 'STRATLESS_CLAUDE_BIN', 'STRATLESS_USAGE', 'FAKE_MODE'];

let dir: string;
let bin: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'stratless-assign-'));
  bin = join(dir, 'fake-claude');
  writeFileSync(bin, FAKE);
  chmodSync(bin, 0o755);
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of ENV_KEYS) delete process.env[k];
});

let n = 0;
/** Fresh isolated stores + N seeded ordinary moments. Returns { assignments path, key builder }. */
function scene(moments: number, categories: { name: string; description: string }[]): { a: string; keyof: (i: number) => string } {
  n++;
  const m = join(dir, `m-${n}.jsonl`);
  const c = join(dir, `c-${n}.jsonl`);
  const a = join(dir, `a-${n}.jsonl`);
  const prefix = `k${n}`;
  const lines: string[] = [];
  for (let i = 1; i <= moments; i++) {
    const mo: Moment = { key: `${prefix}-${i}`, session: `s${i}`, ts: '2026-07-01T10:00:00Z', pile: 'ordinary', reply: `reply ${i}`, replyLen: 7 };
    lines.push(JSON.stringify(mo));
  }
  writeFileSync(m, lines.join('\n') + '\n');
  if (categories.length) appendCategories(categories, { file: c });
  Object.assign(process.env, {
    STRATLESS_MOMENTS: m,
    STRATLESS_CATEGORIES: c,
    STRATLESS_ASSIGNMENTS: a,
    STRATLESS_CLAUDE_BIN: bin,
    STRATLESS_USAGE: join(dir, `u-${n}.json`),
  });
  delete process.env.FAKE_MODE;
  return { a, keyof: (i: number) => `${prefix}-${i}` };
}

const CATS = [{ name: 'drift', description: 'flags drift' }, { name: 'plan', description: 'wants a plan' }];

test('assign: one record per moment, empty kinds kept, invalid names filtered', async () => {
  const { a, keyof } = scene(3, CATS);
  const res = await assignMoments();
  assert.equal(res.categories, 2);
  assert.equal(res.assigned, 3, 'every moment shown gets a record');
  assert.equal(res.stopped, false);
  const byKey = new Map(loadAssignments(a).map((r) => [r.key, r.kinds]));
  assert.deepEqual(byKey.get(keyof(1)), ['drift']);
  assert.deepEqual(byKey.get(keyof(2)), [], 'the invalid "bogus" was filtered to nothing');
  assert.deepEqual(byKey.get(keyof(3)), []);
});

test('assign: idempotent — a second run appends nothing and spends nothing', async () => {
  const { a } = scene(3, CATS);
  assert.equal((await assignMoments()).assigned, 3);
  assert.equal((await assignMoments()).assigned, 0, 'the seen-set stops re-billing');
  assert.equal(loadAssignments(a).length, 3);
});

test('assign: no categories yet is a clean no-op', async () => {
  const { a } = scene(3, []);
  const res = await assignMoments();
  assert.equal(res.categories, 0);
  assert.equal(res.assigned, 0);
  assert.equal(loadAssignments(a).length, 0);
});

test('assign: a batch that comes back too thin is refused, not frozen', async () => {
  const { a } = scene(3, CATS);
  process.env.FAKE_MODE = 'thin'; // answers 1 of 3 — below the 50% coverage floor
  assert.equal((await assignMoments()).assigned, 0, 'the truncated batch is left for next run, not stamped matched-nothing');
  assert.equal(loadAssignments(a).length, 0);
});

test('assignAgainst: assigns a given set against given categories, firing onRecords per batch', async () => {
  scene(3, CATS);
  const persisted: unknown[] = [];
  const res = await assignAgainst(process.env.STRATLESS_CLAUDE_BIN!, loadMoments(), CATS, { onRecords: (recs) => persisted.push(...recs) });
  assert.equal(res.records.length, 3, 'one record per moment');
  assert.equal(persisted.length, 3, 'onRecords fired for the batch (kill-safe append hook)');
  assert.equal(res.stopped, false);
});
