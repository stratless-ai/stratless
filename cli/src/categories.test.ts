/**
 * CATEGORIES — the column store, pinned. The log is append-only and the projection folds it: born
 * adds, revised re-words but KEEPS the birth date, retired drops, a torn line is skipped.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';

import { loadCategories, appendCategories, retireCategories } from './categories.js';

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'stratless-cats-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
const file = (): string => join(dir, `cats-${n++}.jsonl`);

test('append then load: born events become the live set, stamped with the birth date', () => {
  const f = file();
  const at = '2026-07-01T00:00:00Z';
  const wrote = appendCategories([{ name: 'a', description: 'first' }, { name: 'b', description: 'second' }], { file: f, at });
  assert.equal(wrote, 2);
  const live = loadCategories(f);
  assert.equal(live.length, 2);
  const a = live.find((c) => c.name === 'a')!;
  assert.equal(a.description, 'first');
  assert.equal(a.bornAt, at);
});

test('replay: revised re-words but keeps the birth date; retired drops', () => {
  const f = file();
  writeFileSync(
    f,
    [
      JSON.stringify({ event: 'born', name: 'x', description: 'v1', at: '2026-06-01T00:00:00Z' }),
      JSON.stringify({ event: 'born', name: 'y', description: 'keep', at: '2026-06-02T00:00:00Z' }),
      JSON.stringify({ event: 'revised', name: 'x', description: 'v2', at: '2026-07-01T00:00:00Z' }),
      JSON.stringify({ event: 'retired', name: 'y', description: '', at: '2026-07-02T00:00:00Z' }),
    ].join('\n') + '\n',
  );
  const live = loadCategories(f);
  assert.equal(live.length, 1, 'y retired, only x remains');
  assert.equal(live[0].name, 'x');
  assert.equal(live[0].description, 'v2', 'wording moved');
  assert.equal(live[0].bornAt, '2026-06-01T00:00:00Z', 'birth date is immutable');
});

test('a torn last line is skipped, not fatal', () => {
  const f = file();
  writeFileSync(f, JSON.stringify({ event: 'born', name: 'a', description: 'd', at: '2026-06-01T00:00:00Z' }) + '\n{ broken');
  const live = loadCategories(f);
  assert.equal(live.length, 1);
  assert.equal(live[0].name, 'a');
});

test('missing store is no columns, never a throw', () => {
  assert.deepEqual(loadCategories(join(dir, 'nope.jsonl')), []);
});

test('a cold rebuild retires the outgoing generation — the live set never stacks', () => {
  const file = join(dir, 'generations.jsonl');
  appendCategories([{ name: 'gen1-a', description: 'a' }, { name: 'gen1-b', description: 'b' }], { file, at: '2026-07-01T00:00:00Z' });
  // the rebuild: retire everything live, then the new generation is born
  retireCategories(loadCategories(file).map((c) => c.name), { file, at: '2026-07-15T00:00:00Z' });
  appendCategories([{ name: 'gen2-a', description: 'a2' }, { name: 'gen1-b', description: 'b2' }], { file, at: '2026-07-15T00:00:00Z' });
  const live = loadCategories(file);
  assert.equal(live.length, 2, 'only the current generation is live — no ghosts');
  assert.ok(live.every((c) => c.bornAt === '2026-07-15T00:00:00Z'), 'a reborn name is a NEW column — its assignments were replaced wholesale');
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 6, 'and the log keeps every tombstone — auditable, never rewritten');
});
