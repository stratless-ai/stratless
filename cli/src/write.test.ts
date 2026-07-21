/**
 * WRITE — the file's shape, pinned on the PURE assembler (no model). The quote picker is the only
 * model call and is exercised end-to-end in the real dogfood; here we fix the assembly rules: the
 * two lift sections, count-ordering, project held back, no-quote dropped, the char budget, the notes.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { CategoryStat } from './count.js';
import { assemble, looksLikeProfile } from './write.js';

const stat = (over: Pick<CategoryStat, 'name' | 'lift' | 'count'> & Partial<CategoryStat>): CategoryStat => ({
  description: `does ${over.name}`,
  sessions: 5,
  burst: false,
  bornAt: '2026-06-01T00:00:00Z',
  ...over,
});
const prov = { sessions: 100, moments: 4000, from: '2026-06-01', to: '2026-07-20' };

test('assemble: two lift sections, count-ordered, project held back, no-quote dropped', () => {
  const stats: CategoryStat[] = [
    stat({ name: 'drift', lift: 3, count: 300, scope: 'person' }), // distress
    stat({ name: 'frustration', lift: 5, count: 100, scope: 'person' }), // distress, fewer
    stat({ name: 'plan', lift: 1, count: 200, scope: 'person' }), // working
    stat({ name: 'terse', lift: 1, count: 250, scope: 'person' }), // working, more
    stat({ name: 'ui-tuning', lift: 4, count: 500, scope: 'project' }), // project → excluded despite the numbers
    stat({ name: 'noquote', lift: 6, count: 400, scope: 'person' }), // no quote → dropped
  ];
  const quotes = new Map([
    ['drift', 'wait what are you doing'],
    ['frustration', 'which is the fucking file'],
    ['plan', 'lets make a plan'],
    ['terse', 'sure'],
    ['ui-tuning', 'make it 14px'], // has a quote but is project
  ]);
  const built = assemble(stats, quotes, prov);
  assert.ok(built, 'a file was built');
  const t = built!.text;

  const gw = t.indexOf('## When something has gone wrong');
  const hw = t.indexOf('## How they work');
  assert.ok(gw >= 0 && hw > gw, 'distress section comes before working section');

  assert.ok(t.indexOf('does drift') < t.indexOf('does frustration'), 'distress ordered by count desc');
  assert.ok(t.indexOf('does drift') < hw, 'drift sits in the distress section');
  assert.ok(t.indexOf('does terse') > hw && t.indexOf('does terse') < t.indexOf('does plan'), 'working ordered by count desc');

  assert.ok(!t.includes('does ui-tuning'), 'project category held back');
  assert.ok(!t.includes('does noquote'), 'entry with no quote dropped');

  assert.equal(built!.meta.signals, 2);
  assert.equal(built!.meta.working, 2);
  assert.ok(t.includes('**does drift**\n300 times across 5 conversations\n> wait what are you doing'), 'block format');
});

test('assemble: rising/fading and bursts show in the weight line', () => {
  const stats = [
    stat({ name: 'rise', lift: 1, count: 10, scope: 'person', direction: 'rising' }),
    stat({ name: 'burst', lift: 1, count: 10, scope: 'person', burst: true }),
  ];
  const built = assemble(stats, new Map([['rise', 'q1'], ['burst', 'q2']]), prov)!;
  assert.ok(built.text.includes('10 times across 5 conversations · rising'), 'rising note');
  assert.ok(built.text.includes('10 times across 5 conversations · comes in bursts'), 'burst note');
});

test('assemble: working-style fills only to the char budget', () => {
  const stats: CategoryStat[] = [stat({ name: 'drift', lift: 3, count: 999, scope: 'person' })];
  const quotes = new Map<string, string>([['drift', 'wait what']]);
  for (let i = 0; i < 40; i++) {
    const name = `w${i}`;
    stats.push(stat({ name, lift: 1, count: 100 - i, scope: 'person', description: `working trait number ${i} that is fairly wordy` }));
    quotes.set(name, 'x'.repeat(150));
  }
  const built = assemble(stats, quotes, prov)!;
  assert.equal(built.meta.signals, 1, 'the distress entry always ships');
  assert.ok(built.meta.working > 0 && built.meta.working < 40, 'working truncated by the budget');
  assert.ok(built.text.length <= 5800, 'stays within the char budget');
});

test('assemble: null when no person-scoped entry earns a quote', () => {
  const stats = [
    stat({ name: 'proj', lift: 3, count: 100, scope: 'project' }), // project, has a quote but excluded
    stat({ name: 'noq', lift: 1, count: 50, scope: 'person' }), // person, no quote
  ];
  assert.equal(assemble(stats, new Map([['proj', 'q']]), prov), null);
});

test('looksLikeProfile: yes for a real profile, no for chatter', () => {
  const built = assemble([stat({ name: 'drift', lift: 3, count: 5, scope: 'person' })], new Map([['drift', 'wait what']]), prov)!;
  assert.equal(looksLikeProfile(built.text), true);
  assert.equal(looksLikeProfile('sure, let me help you with that — here is the answer'), false);
  assert.equal(looksLikeProfile(''), false);
});

test('assemble: the decode key renders (phrases → signal), before the analytical sections', () => {
  const stats = [stat({ name: 'plan', lift: 1, count: 200, scope: 'person' })];
  const decode = {
    sigs: [{ name: 'plan', phrases: ['make a plan', 'lets make a'], count: 200 }],
    signals: new Map([['plan', 'wants a plan before building']]),
  };
  const built = assemble(stats, new Map([['plan', 'lets make a plan']]), prov, decode)!;
  assert.ok(built.text.includes('## In the moment'), 'the section renders');
  assert.ok(built.text.includes('"make a plan" · "lets make a" → wants a plan before building'), 'phrases → decode');
  assert.equal(built.meta.shorthand, 1);
  assert.ok(built.text.indexOf('## In the moment') < built.text.indexOf('## How they work'), 'sits above the detail');
});

test('assemble: no decode → no shorthand section, meta.shorthand 0', () => {
  const built = assemble([stat({ name: 'plan', lift: 1, count: 5, scope: 'person' })], new Map([['plan', 'q']]), prov)!;
  assert.ok(!built.text.includes('## In the moment'));
  assert.equal(built.meta.shorthand, 0);
});
