/**
 * CATEGORIES — the column store, pinned. The log is append-only and the projection folds it: born
 * adds, revised re-words but KEEPS the birth date, retired drops, a torn line is skipped.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';

import { loadCategories, appendCategories } from './categories.js';

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
