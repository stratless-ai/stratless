/**
 * The compiler's contract: valid frontmatter with a capped, vocabulary-carrying description;
 * digits confined to the Receipts section (the numerals boundary, extended to the tune's
 * output); patch wording surfacing whole; blocks marked as not-skills; byte determinism.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { compileTune } from './compile.js';
import type { DerivedTune, DerivedUnit } from './derive.js';
import type { RowRecord } from './rows.js';

const row = (over: Partial<RowRecord> & { name: string }): RowRecord => ({
  bornAt: 't0',
  section: 'frame',
  line: `offer the ${over.name} standard before continuing.`,
  signal: '',
  quote: '',
  count: 7,
  ...over,
});

const skillUnit = (): DerivedUnit => {
  const plan = row({
    name: 'plan-row',
    signal: 'wants a plan before code',
    count: 270,
    patch: { when: 'when a new or multi-step task begins', doThis: 'propose a concise plan and pause', ownVoice: 'plan it out before we start', action: 'EnterPlanMode', reach: 228, slip: 28, state: 'open' },
  });
  const seq = row({ name: 'seq-row', signal: 'wants work sequenced', count: 289 });
  return { kind: 'active', anchor: 'plan-row', seat: { patchHome: 'plan-row' }, members: [plan, seq], attached: [{ row: seq, link: 0.702 }] };
};

const blockUnit = (): DerivedUnit => {
  const terse = row({ name: 'terse-row', section: 'register', signal: 'wants the next action now', quote: 'go', count: 329 });
  const git = row({ name: 'git-row', section: 'register', quote: 'push', count: 157 });
  return {
    kind: 'ambient',
    anchor: 'terse-row',
    seat: { group: { line: 'match their terse style and reply with the next concrete action.', facets: ['short imperative', 'git one-liner'], members: [terse, git] } },
    members: [terse, git],
    attached: [],
  };
};

const tune = (): DerivedTune => ({ units: [skillUnit(), blockUnit()], leftovers: [] });

test('a skill compiles with frontmatter, trigger vocabulary, and the patched standard whole', () => {
  const [skill] = compileTune(tune());
  assert.equal(skill!.kind, 'active');
  assert.equal(skill!.filename, 'plan-row/SKILL.md');
  assert.match(skill!.content, /^---\nname: plan-row\ndescription: /);
  const desc = skill!.content.match(/description: (.*)\n---/)![1]!;
  assert.ok(desc.length <= 1024);
  assert.ok(desc.includes('wants a plan before code'), 'decode wants reach the description');
  assert.ok(skill!.content.includes('The move: propose a concise plan and pause.'));
  assert.ok(skill!.content.includes('In their own words: "plan it out before we start"'));
  assert.ok(skill!.content.includes('EnterPlanMode'));
  assert.ok(skill!.content.includes('retires when its patch heals'));
});

test('digits appear only in the Receipts section', () => {
  for (const a of compileTune(tune())) {
    const [before, after] = a.content.split('## Receipts');
    assert.ok(after, `${a.name} has a receipts section`);
    const outside = before! + (after!.split('## Sunset')[1] ?? '');
    assert.equal(outside.match(/\d/), null, `${a.name}: no digits outside receipts`);
    assert.ok(/270×|329×/.test(after!), `${a.name} receipts carry the stamped counts`);
  }
});

test('a block compiles without frontmatter and says what it is', () => {
  const [, block] = compileTune(tune());
  assert.equal(block!.kind, 'ambient');
  assert.equal(block!.filename, 'terse-row.md');
  assert.ok(block!.content.startsWith('<!-- ALWAYS-LOADED BLOCK'));
  assert.ok(!block!.content.includes('---\nname:'));
  assert.ok(block!.content.includes('Their own phrases: "go" · "push".'));
  assert.ok(block!.content.includes('short imperative'));
});

test('compilation is byte-deterministic', () => {
  const a = compileTune(tune());
  const b = compileTune(tune());
  assert.deepEqual(a, b);
});
