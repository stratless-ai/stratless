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

import { uniquify, pruneCategories, discover, knownCategoriesBlock, confidentCategories, type Candidate } from './discover.js';
import { loadCategories } from './categories.js';
import { loadAssignments, type Assignment } from './assign.js';
import type { Moment, Pile } from './moments.js';

const cand = (name: string, scope = 'person'): Candidate => ({ name, description: `does ${name}`, scope });
let seq = 0;
const mo = (session: string, pile: Pile = 'ordinary'): Moment => ({ key: `k${seq++}`, session, ts: '2026-07-01T10:00:00Z', pile, reply: 'x', replyLen: 1 });
const asn = (key: string, kinds: string[]): Assignment => ({ key, at: '2026-07-02T00:00:00Z', kinds });

test('knownCategoriesBlock: empty on round 0 (blind), forbids re-mints on later rounds', () => {
  assert.equal(knownCategoriesBlock([]), '', 'round 0 stays blind — no already-found block');
  const block = knownCategoriesBlock([cand('asks-for-recap'), cand('plan-first')]);
  assert.match(block, /ALREADY FOUND/);
  assert.match(block, /asks-for-recap/);
  assert.match(block, /plan-first/);
  assert.match(block, /genuinely NEW/);
  assert.match(block, /synonym/, 'explicitly forbids near-duplicate categories');
});

test('confidentCategories: feeds forward only categories that would survive the prune (floor AND not circular)', () => {
  seq = 0;
  const [m1, m2, m3, m4, m5, m6, m7] = [mo('s1'), mo('s2'), mo('s3'), mo('s4'), mo('s5', 'interrupt'), mo('s6', 'interrupt'), mo('s7', 'interrupt')];
  const moments = [m1, m2, m3, m4, m5, m6, m7];
  const born = [cand('strong'), cand('fluke'), cand('circular')];
  const kinds = new Map<string, Set<string>>([
    [m1.key, new Set(['strong'])],
    [m2.key, new Set(['strong'])],
    [m3.key, new Set(['strong'])], // strong: 3 ordinary conversations → survives → fed forward
    [m4.key, new Set(['fluke'])], // fluke: 1 conversation → below the floor → withheld
    [m5.key, new Set(['circular'])],
    [m6.key, new Set(['circular'])],
    [m7.key, new Set(['circular'])], // circular: 3 conversations but all anchors → circular guard → withheld
  ]);
  assert.deepEqual(confidentCategories(born, kinds, moments).map((c) => c.name), ['strong']);
  assert.deepEqual(confidentCategories([], kinds, moments), [], 'nothing minted yet → nothing to feed');
});

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

test('pruneCategories: exempt names skip ONLY the circular guard, never the floor (the judgment catches)', () => {
  seq = 0;
  const [m1, m2, m3, m4] = [mo('s1', 'interrupt'), mo('s2', 'interrupt'), mo('s3', 'interrupt'), mo('s4', 'interrupt')];
  const moments = [m1, m2, m3, m4];
  const records: Assignment[] = [
    asn(m1.key, ['catch']), asn(m2.key, ['catch']), asn(m3.key, ['catch']), // 3 anchor conversations
    asn(m4.key, ['catch-thin']), // only 1 conversation
  ];
  const born = [cand('catch'), cand('catch-thin')];
  // Not exempt: a catch is all-anchors by nature, so the circular guard would wrongly delete it.
  assert.ok(!pruneCategories(born, records, moments).has('catch'), 'not exempt: the all-anchor catch is pruned as circular');
  // Exempt: it survives (it still cleared the conversation floor); the floor is NEVER bypassed.
  const survivors = pruneCategories(born, records, moments, new Set(['catch', 'catch-thin']));
  assert.ok(survivors.has('catch'), 'exempt: the all-anchor catch survives the circular guard');
  assert.ok(!survivors.has('catch-thin'), 'exemption never bypasses the 3-conversation floor');
});

// A fake `claude` that answers ALL THREE stages by inspecting the prompt: the behavioural discovery
// call gets a behaviour, the judgment-lens call gets a catch, and every assign call tags each shown
// moment with whatever kind(s) its fixed list names (so the catch gets scored across the whole pile).
const FAKE = `#!/usr/bin/env node
const args = process.argv.slice(2);
const input = args.find((a) => a.includes('MOMENTS:')) || '';
let result;
if (input.includes('recurring KINDS')) {
  result = JSON.stringify({ categories: [{ name: 'planning', description: 'wants a plan first', scope: 'person' }] });
} else if (input.includes('THIS PERSON JUDGES')) {
  result = JSON.stringify({ categories: [{ name: 'rejects-patch-jobs', description: 'refuses quick fixes that leave debt', scope: 'person' }] });
} else {
  const kinds = [...input.matchAll(/(?:^|\\n)- ([a-z-]+):/g)].map((m) => m[1]);
  const ids = [...input.matchAll(/(?:^|\\n)#(\\d+)/g)].map((m) => Number(m[1]));
  result = JSON.stringify({ assignments: ids.map((id) => ({ id, kinds })) });
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
  assert.equal(dr.categories, 2, 'planning (behavioural) + rejects-patch-jobs (judgment pass) both survived');
  assert.ok(dr.rounds >= 2, 'a behavioural round plus the judgment pass');
  assert.equal(dr.assigned, 6);

  assert.deepEqual(loadCategories(c).map((x) => x.name).sort(), ['planning', 'rejects-patch-jobs']);
  const rows = loadAssignments(a);
  assert.equal(rows.length, 6, 'every moment persisted exactly once');
  assert.ok(rows.every((r) => r.kinds.includes('planning')), 'all assigned to the behaviour');
  assert.ok(rows.every((r) => r.kinds.includes('rejects-patch-jobs')), 'the judgment pass scored the catch across the whole pile');
});
