/**
 * WRITE — the file's shape, pinned on the PURE assembler (no model). The quote+voice picker is the only
 * model call and is exercised end-to-end in the real dogfood; here we fix the assembly rules: the three
 * functional sections (Frame/Judge/Register), count-ordering, project held back, no-quote dropped, the
 * char budget on Register, the notes, the decode key.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { CategoryStat } from './count.js';
import { assemble, looksLikeProfile, type Voiced, type Section } from './write.js';

const stat = (over: Pick<CategoryStat, 'name' | 'lift' | 'count'> & Partial<CategoryStat>): CategoryStat => ({
  description: `does ${over.name}`,
  sessions: 5,
  burst: false,
  bornAt: '2026-06-01T00:00:00Z',
  ...over,
});
const prov = { sessions: 100, moments: 4000, from: '2026-06-01', to: '2026-07-20' };
const v = (section: Section, quote: string, line: string, signal = ''): Voiced => ({ section, quote, line, signal });

test('assemble: three sections, count-ordered, project held back, no-quote dropped', () => {
  const stats: CategoryStat[] = [
    stat({ name: 'plan', lift: 1, count: 300, scope: 'person' }), // frame
    stat({ name: 'probe', lift: 1, count: 100, scope: 'person' }), // frame, fewer
    stat({ name: 'number', lift: 5, count: 200, scope: 'person' }), // judge
    stat({ name: 'terse', lift: 1, count: 250, scope: 'person' }), // register
    stat({ name: 'ui-tuning', lift: 4, count: 500, scope: 'project' }), // project → excluded despite the numbers
    stat({ name: 'noquote', lift: 6, count: 400, scope: 'person' }), // no quote → dropped
  ];
  const voiced = new Map<string, Voiced>([
    ['plan', v('frame', 'lets make a plan', 'offer a plan first')],
    ['probe', v('frame', 'try a small test first', 'offer a probe first')],
    ['number', v('judge', 'whats the sample size', 'catch unverified numbers')],
    ['terse', v('register', 'sure', 'ship it means go')],
    ['ui-tuning', v('judge', 'make it 14px', 'catch ui drift')], // has a quote but is project
    ['noquote', v('judge', '', 'catch nothing')], // no quote
  ]);
  const built = assemble(stats, voiced, prov);
  assert.ok(built, 'a file was built');
  const t = built!.text;

  const offer = t.indexOf('## What to offer me before I ask');
  const catch_ = t.indexOf('## What to catch for me');
  const talk = t.indexOf('## How to talk to me');
  assert.ok(offer >= 0 && catch_ > offer && talk > catch_, 'sections in Frame, Judge, Register order');

  assert.ok(t.indexOf('offer a plan first') < t.indexOf('offer a probe first'), 'frame ordered by count desc');
  assert.ok(t.indexOf('offer a plan first') < catch_, 'plan sits in the frame section');
  assert.ok(t.indexOf('catch unverified numbers') > catch_ && t.indexOf('catch unverified numbers') < talk, 'number sits in judge');
  assert.ok(t.indexOf('ship it means go') > talk, 'terse sits in register');

  assert.ok(!t.includes('make it 14px'), 'project category held back');
  assert.ok(!t.includes('catch nothing'), 'entry with no quote dropped');

  assert.equal(built!.meta.frame, 2);
  assert.equal(built!.meta.judge, 1);
  assert.equal(built!.meta.register, 1);
  assert.ok(t.includes('**offer a plan first**\n300 times across 5 conversations\n> lets make a plan'), 'block format');
});

test('assemble: rising/fading and bursts show in the weight line', () => {
  const stats = [
    stat({ name: 'rise', lift: 1, count: 10, scope: 'person', direction: 'rising' }),
    stat({ name: 'burst', lift: 1, count: 10, scope: 'person', burst: true }),
  ];
  const voiced = new Map<string, Voiced>([
    ['rise', v('frame', 'q1', 'offer rise')],
    ['burst', v('frame', 'q2', 'offer burst')],
  ]);
  const built = assemble(stats, voiced, prov)!;
  assert.ok(built.text.includes('10 times across 5 conversations · rising'), 'rising note');
  assert.ok(built.text.includes('10 times across 5 conversations · comes in bursts'), 'burst note');
});

test('assemble: register fills only to the char budget', () => {
  const stats: CategoryStat[] = [stat({ name: 'number', lift: 3, count: 999, scope: 'person' })];
  const voiced = new Map<string, Voiced>([['number', v('judge', 'wait what', 'catch numbers')]]);
  for (let i = 0; i < 40; i++) {
    const name = `r${i}`;
    stats.push(stat({ name, lift: 1, count: 100 - i, scope: 'person' }));
    voiced.set(name, v('register', 'x'.repeat(150), `register trait number ${i} that is fairly wordy`));
  }
  const built = assemble(stats, voiced, prov)!;
  assert.equal(built.meta.judge, 1, 'the judge entry always ships');
  assert.ok(built.meta.register > 0 && built.meta.register < 40, 'register truncated by the budget');
  assert.ok(built.text.length <= 5800, 'stays within the char budget');
});

test('assemble: null when no Frame or Judge entry earns a quote', () => {
  const stats = [
    stat({ name: 'proj', lift: 3, count: 100, scope: 'project' }), // project, has a quote but excluded
    stat({ name: 'noq', lift: 1, count: 50, scope: 'person' }), // person frame, no quote
    stat({ name: 'reg', lift: 1, count: 40, scope: 'person' }), // register only — not a bookend
  ];
  const voiced = new Map<string, Voiced>([
    ['proj', v('judge', 'q', 'catch proj')],
    ['noq', v('frame', '', 'offer noq')],
    ['reg', v('register', 'q', 'talk reg')],
  ]);
  assert.equal(assemble(stats, voiced, prov), null);
});

test('looksLikeProfile: yes for a real profile, no for chatter', () => {
  const built = assemble(
    [stat({ name: 'plan', lift: 1, count: 5, scope: 'person' })],
    new Map<string, Voiced>([['plan', v('frame', 'wait what', 'offer a plan')]]),
    prov,
  )!;
  assert.equal(looksLikeProfile(built.text), true);
  assert.equal(looksLikeProfile('sure, let me help you with that, here is the answer'), false);
  assert.equal(looksLikeProfile(''), false);
});

test('assemble: the decode key renders (phrases → signal), before the sections', () => {
  const stats = [stat({ name: 'plan', lift: 1, count: 200, scope: 'person' })];
  const decode = {
    sigs: [{ name: 'plan', phrases: ['make a plan', 'lets make a'], count: 200 }],
    signals: new Map([['plan', 'wants a plan before building']]),
  };
  const built = assemble(
    stats,
    new Map<string, Voiced>([['plan', v('frame', 'lets make a plan', 'offer a plan first')]]),
    prov,
    decode,
  )!;
  assert.ok(built.text.includes('## In the moment'), 'the section renders');
  assert.ok(built.text.includes('"make a plan" · "lets make a" → wants a plan before building'), 'phrases → decode');
  assert.equal(built.meta.shorthand, 1);
  assert.ok(built.text.indexOf('## In the moment') < built.text.indexOf('## What to offer me'), 'sits above the detail');
});

test('assemble: no decode → no shorthand section, meta.shorthand 0', () => {
  const built = assemble(
    [stat({ name: 'plan', lift: 1, count: 5, scope: 'person' })],
    new Map<string, Voiced>([['plan', v('frame', 'q', 'offer a plan')]]),
    prov,
  )!;
  assert.ok(!built.text.includes('## In the moment'));
  assert.equal(built.meta.shorthand, 0);
});
