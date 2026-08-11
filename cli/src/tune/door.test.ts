/**
 * The plan's contract: statuses diff against disk truth, covered units never write, block
 * imports assemble and remove cleanly, and the person's surrounding CLAUDE.md content is
 * untouched through every upsert. Pure — no IO anywhere.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { CompiledArtifact } from './compile.js';
import { planInstall, tuneSection, upsertTuneSection, TUNE_START } from './door.js';
import type { CoverVerdict } from './inspect.js';

const art = (name: string, kind: CompiledArtifact['kind'], content = `content of ${name}`): CompiledArtifact => ({
  kind,
  name,
  filename: kind === 'ambient' ? `${name}.md` : `${name}/SKILL.md`,
  content,
});

const mint = (name: string): CoverVerdict => ({ name, verdict: 'mint' });

const TARGET = { skillsDir: '/skills', blocksDir: '/blocks' };

test('statuses: new on first run, unchanged/updated on re-run, covered never writes', () => {
  const a = art('plan-a', 'active');
  const t = art('walk-t', 'triggered');
  const b = art('tone-b', 'ambient');
  const verdicts: CoverVerdict[] = [
    mint('plan-a'),
    { name: 'walk-t', verdict: 'already-fitted', coveredBy: 'their-guide' },
    mint('tone-b'),
  ];
  const existing = new Map([[`/blocks/tone-b.md`, 'stale bytes']]);

  const plan = planInstall([b, t, a], verdicts, TARGET, existing);
  assert.deepEqual(
    plan.entries.map((e) => [e.artifact.name, e.status]),
    [
      ['plan-a', 'new'],
      ['walk-t', 'covered'],
      ['tone-b', 'updated'],
    ],
    'ordered actives → triggered → ambient; covered flagged',
  );
  assert.equal(plan.entries[1]!.coveredBy, 'their-guide');
  assert.deepEqual(plan.writes.map((w) => w.path), ['/skills/plan-a/SKILL.md', '/blocks/tone-b.md']);
  assert.deepEqual(plan.blockPaths, ['/blocks/tone-b.md']);
  assert.deepEqual(plan.counts, { skills: 1, styles: 1, newOrUpdated: 2, covered: 1 });
});

test('an unchanged artifact plans no write', () => {
  const a = art('plan-a', 'active');
  const existing = new Map([['/skills/plan-a/SKILL.md', a.content]]);
  const plan = planInstall([a], [mint('plan-a')], TARGET, existing);
  assert.equal(plan.entries[0]!.status, 'unchanged');
  assert.equal(plan.writes.length, 0);
});

test('the tune section: home-relative imports, upsert replaces only our markers', () => {
  const home = '/Users/person';
  const section = tuneSection(['/Users/person/.stratless/tune/cc/tone.md'], home);
  assert.ok(section.includes('@~/.stratless/tune/cc/tone.md'));

  const theirs = '# their own notes\n@~/their-import.md\n';
  const withSection = upsertTuneSection(theirs, ['/Users/person/.stratless/tune/cc/tone.md'], home);
  assert.ok(withSection.startsWith('# their own notes'), 'their content untouched, ours appended');
  assert.ok(withSection.includes(TUNE_START));

  const rewritten = upsertTuneSection(withSection, ['/Users/person/.stratless/tune/cc/other.md'], home);
  assert.equal(rewritten.match(new RegExp(TUNE_START, 'g'))!.length, 1, 'upsert, never duplicate');
  assert.ok(rewritten.includes('other.md') && !rewritten.includes('tone.md'));

  const removed = upsertTuneSection(rewritten, [], home);
  assert.ok(!removed.includes(TUNE_START), 'empty blocks removes the section');
  assert.ok(removed.startsWith('# their own notes'), 'their content survives removal');
});
