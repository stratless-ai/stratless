/**
 * DISCOVER — pinned. The pure harness (uniquify, prune) offline, plus a cold-start integration
 * against a fake `claude` that answers both the discovery call and the assign calls: the round loop
 * mints a category, assigns every moment, and persists the store once.
 */
import { strict as assert } from 'node:assert';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';

import { uniquify, pruneCategories, discover, type Candidate } from './discover.js';
import { loadCategories } from './categories.js';
import { loadAssignments, type Assignment } from './assign.js';
import type { Moment, Pile } from './moments.js';

const cand = (name: string, scope = 'person'): Candidate => ({ name, description: `does ${name}`, scope });
let seq = 0;
const mo = (session: string, pile: Pile = 'ordinary'): Moment => ({ key: `k${seq++}`, session, ts: '2026-07-01T10:00:00Z', pile, reply: 'x', replyLen: 1 });
const asn = (key: string, kinds: string[]): Assignment => ({ key, at: '2026-07-02T00:00:00Z', kinds });

test('uniquify: skips a name already live; renames an in-round collision', () => {
  const names = uniquify([cand('plan'), cand('plan'), cand('verify')], new Set(['verify'])).map((c) => c.name);
  assert.deepEqual(names, ['plan', 'plan-2']); // verify dropped (live); the second plan uniquified
});

test('pruneCategories: retires under the conversation floor and the circular guard', () => {
  seq = 0;
  const [m1, m2, m3, m4, m5, m6] = [mo('s1'), mo('s2'), mo('s3'), mo('s4', 'interrupt'), mo('s5', 'interrupt'), mo('s6', 'interrupt')];
  const moments = [m1, m2, m3, m4, m5, m6];
  const records: Assignment[] = [
    asn(m1.key, ['good']), asn(m2.key, ['good']), asn(m3.key, ['good']), // 3 conversations, ordinary → survives
    asn(m4.key, ['thin', 'circular']), asn(m5.key, ['thin', 'circular']), // 'thin': 2 conversations → floor
    asn(m6.key, ['circular']), // 'circular': 3 conversations but all anchors → circular guard
  ];
  const survivors = pruneCategories([cand('good'), cand('thin'), cand('circular')], records, moments);
  assert.ok(survivors.has('good'));
  assert.ok(!survivors.has('thin'), 'below the 3-conversation floor');
  assert.ok(!survivors.has('circular'), 'all-anchor members are circular');
});

// A fake `claude` that answers BOTH stages by inspecting the prompt: the discovery call gets a
// category, the assign calls get every shown moment tagged with it.
const FAKE = `#!/usr/bin/env node
const args = process.argv.slice(2);
const input = args.find((a) => a.includes('MOMENTS:')) || '';
let result;
if (input.includes('recurring KINDS')) {
  result = JSON.stringify({ categories: [{ name: 'planning', description: 'wants a plan first', scope: 'person' }] });
} else {
  const ids = [...input.matchAll(/(?:^|\\n)#(\\d+)/g)].map((m) => Number(m[1]));
  result = JSON.stringify({ assignments: ids.map((id) => ({ id, kinds: ['planning'] })) });
}
process.stdout.write(JSON.stringify({ result, is_error: false, total_cost_usd: 0.001, usage: { input_tokens: 1, output_tokens: 1 } }));
`;

let dir: string;
let bin: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'stratless-discover-'));
  bin = join(dir, 'fake-claude');
  writeFileSync(bin, FAKE);
  chmodSync(bin, 0o755);
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of ['STRATLESS_MOMENTS', 'STRATLESS_CATEGORIES', 'STRATLESS_ASSIGNMENTS', 'STRATLESS_CLAUDE_BIN', 'STRATLESS_USAGE']) delete process.env[k];
});

test('discover: cold start mints a category and writes every moment against it, once', async () => {
  const m = join(dir, 'moments.jsonl');
  const c = join(dir, 'categories.jsonl');
  const a = join(dir, 'assignments.jsonl');
  const lines: string[] = [];
  for (let i = 0; i < 6; i++) lines.push(JSON.stringify({ key: `m${i}`, session: `s${i}`, ts: '2026-07-01T10:00:00Z', pile: 'ordinary', reply: `reply ${i}`, replyLen: 7 }));
  writeFileSync(m, lines.join('\n') + '\n');
  Object.assign(process.env, { STRATLESS_MOMENTS: m, STRATLESS_CATEGORIES: c, STRATLESS_ASSIGNMENTS: a, STRATLESS_CLAUDE_BIN: bin, STRATLESS_USAGE: join(dir, 'u.json') });

  const dr = await discover();
  assert.equal(dr.categories, 1, 'planning survived (6 conversations, ordinary)');
  assert.ok(dr.rounds >= 1);
  assert.equal(dr.assigned, 6);

  assert.deepEqual(loadCategories(c).map((x) => x.name), ['planning']);
  const rows = loadAssignments(a);
  assert.equal(rows.length, 6, 'every moment persisted exactly once');
  assert.ok(rows.every((r) => r.kinds.includes('planning')), 'all assigned to planning');
});
