/**
 * Inspection's contract, hermetically: duplicates are caught at the floor and named, unrelated
 * proposals mint, OUR previous tune never counts as coverage, native features can cover, malformed
 * installed skills are skipped, and both installed surfaces (skills, blocks) are read. Fake
 * embedder, synthetic dirs.
 */
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { Embedder } from './derive.js';
import { inspectDescriptions, readInstalledBlocks, readInstalledSkills, NATIVE_FEATURES } from './inspect.js';

/** Same marker word → same axis → link 1; every unmatched text gets its OWN axis, so
 *  unrelated texts are orthogonal rather than accidentally identical. */
const fakeEmbed =
  (axes: Record<string, number>): Embedder =>
  async (texts) =>
    texts.map((t, i) => {
      const v = new Float32Array(8 + texts.length);
      const hit = Object.entries(axes).find(([k]) => t.includes(k));
      v[hit ? hit[1] : 8 + i] = 1;
      return v;
    });

function installedDir(skills: { name: string; description: string; minted?: boolean }[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'tune-inspect-'));
  for (const s of skills) {
    mkdirSync(join(dir, s.name));
    writeFileSync(
      join(dir, s.name, 'SKILL.md'),
      `---\nname: ${s.name}\ndescription: ${s.description}\n---\n\n# ${s.name}\n${s.minted ? '\nMinted by stratless from this pair.\n' : ''}`,
    );
  }
  return dir;
}

test('readInstalledSkills parses descriptions, flags the mint mark, skips the malformed', () => {
  const dir = installedDir([
    { name: 'their-skill', description: 'checks deployments before shipping' },
    { name: 'our-old-tune', description: 'plans before implementing', minted: true },
  ]);
  mkdirSync(join(dir, 'broken'));
  writeFileSync(join(dir, 'broken', 'SKILL.md'), 'no frontmatter at all');

  const skills = readInstalledSkills([dir, '/nonexistent/skills']);
  assert.deepEqual(skills.map((s) => [s.name, s.minted]), [
    ['our-old-tune', true],
    ['their-skill', false],
  ]);
});

test('a duplicate is caught and named; the unrelated item mints', async () => {
  const dir = installedDir([{ name: 'their-planner', description: 'planword always plan first' }]);
  const installed = readInstalledSkills([dir]);
  const verdicts = await inspectDescriptions(
    [
      { name: 'proposed-plan', description: 'planword offer a plan before code.' },
      { name: 'proposed-verify', description: 'verify before done.' },
    ],
    installed,
    fakeEmbed({ planword: 0 }),
  );
  assert.deepEqual(verdicts.map((v) => [v.name, v.verdict, v.coveredBy]), [
    ['proposed-plan', 'already-fitted', 'their-planner'],
    ['proposed-verify', 'mint', undefined],
  ]);
  assert.ok(verdicts[0]!.link! >= 0.75);
});

test('our previous tune never counts as coverage — an update is not a collision', async () => {
  const dir = installedDir([{ name: 'old-tune-plan', description: 'planword offer a plan before code', minted: true }]);
  const installed = readInstalledSkills([dir]);
  const verdicts = await inspectDescriptions(
    [{ name: 'proposed-plan', description: 'planword offer a plan before code.' }],
    installed,
    fakeEmbed({ planword: 0 }),
  );
  assert.equal(verdicts[0]!.verdict, 'mint');
});

test('a native feature covers a proposal that would rebuild it', async () => {
  const nativeWord = NATIVE_FEATURES[0]!.text.split(' ')[2]!; // a word from plan mode's text
  const verdicts = await inspectDescriptions(
    [{ name: 'proposed-planner', description: `${nativeWord} do the planning ritual.` }],
    [],
    fakeEmbed({ [nativeWord]: 0 }),
  );
  assert.equal(verdicts[0]!.verdict, 'already-fitted');
  assert.equal(verdicts[0]!.coveredBy, 'plan mode');
});

test('no installed world at all: everything mints, nothing throws', async () => {
  const verdicts = await inspectDescriptions([{ name: 'proposed-a', description: 'alpha.' }], [], fakeEmbed({}));
  assert.deepEqual(verdicts, [{ name: 'proposed-a', verdict: 'mint' }]);
});

/* ── the sitting's surfaces: description-level verdicts and the block reader ── */

test('inspectDescriptions: a proposal whose substance matches an installed skill is covered under any name', async () => {
  const dir = installedDir([{ name: 'verify-before-done', description: 'verify the work before claiming done' }]);
  const embed = fakeEmbed({ verify: 0, unrelated: 1 });
  const v = await inspectDescriptions(
    [
      { name: 'double-check-before-done', description: 'verify actual state before reporting complete' },
      { name: 'fresh-territory', description: 'unrelated new behavior entirely' },
    ],
    readInstalledSkills([dir]),
    embed,
  );
  assert.equal(v[0]!.verdict, 'already-fitted');
  assert.equal(v[0]!.coveredBy, 'verify-before-done');
  assert.equal(v[1]!.verdict, 'mint');
});

test('readInstalledBlocks: comments and headings stripped, first paragraph is the description, mint mark flagged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tune-blocks-'));
  writeFileSync(
    join(dir, 'stance.md'),
    '<!-- a comment header -->\n\n# Stance — how to hold your end\n\nThe person lays out multi-part reasoning and works terse.\n\nMore below.\n',
  );
  writeFileSync(join(dir, 'minted-style.md'), '# minted\n\nAlways on. Minted by stratless from this pair.\n');
  writeFileSync(join(dir, 'notes.txt'), 'not a block');
  const blocks = readInstalledBlocks([dir, join(dir, 'absent-subdir')]);
  assert.deepEqual(
    blocks.map((b) => b.name),
    ['minted-style', 'stance'],
  );
  const stance = blocks.find((b) => b.name === 'stance')!;
  assert.equal(stance.description, 'The person lays out multi-part reasoning and works terse.');
  assert.equal(stance.minted, false);
  assert.equal(blocks.find((b) => b.name === 'minted-style')!.minted, true);
});

test('a block covers a proposal — the second surface counts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tune-blocks-'));
  writeFileSync(join(dir, 'stance.md'), '# stance\n\nterse register, action first, no padding.\n');
  const embed = fakeEmbed({ terse: 0 });
  const v = await inspectDescriptions(
    [{ name: 'terse-imperative', description: 'match their terse register with action-first replies' }],
    readInstalledBlocks([dir]),
    embed,
  );
  assert.equal(v[0]!.verdict, 'already-fitted');
  assert.equal(v[0]!.coveredBy, 'stance');
});
