/**
 * Inspection's contract, hermetically: duplicates are caught at the floor and named, unrelated
 * units mint, OUR previous tune never counts as coverage, native features can cover, malformed
 * installed skills are skipped, and verdicts are deterministic. Fake embedder, synthetic dirs.
 */
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { Embedder } from './derive.js';
import type { DerivedUnit } from './derive.js';
import { inspectTune, readInstalledSkills, NATIVE_FEATURES } from './inspect.js';
import type { RowRecord } from './rows.js';

const row = (over: Partial<RowRecord> & { name: string }): RowRecord => ({
  bornAt: 't0',
  section: 'frame',
  line: `${over.name} standard line.`,
  signal: '',
  quote: '',
  count: 5,
  ...over,
});

const unit = (name: string, line: string): DerivedUnit => ({
  kind: 'active',
  anchor: name,
  seat: { group: { line, facets: ['f'], members: [] } },
  members: [row({ name, line })],
  attached: [],
});

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

test('a duplicate is caught and named; the unrelated unit mints', async () => {
  const dir = installedDir([{ name: 'their-planner', description: 'planword always plan first' }]);
  const installed = readInstalledSkills([dir]);
  const verdicts = await inspectTune(
    [unit('derived-plan', 'planword offer a plan before code.'), unit('derived-verify', 'verify before done.')],
    installed,
    fakeEmbed({ planword: 0 }),
  );
  assert.deepEqual(verdicts.map((v) => [v.name, v.verdict, v.coveredBy]), [
    ['derived-plan', 'already-fitted', 'their-planner'],
    ['derived-verify', 'mint', undefined],
  ]);
  assert.ok(verdicts[0]!.link! >= 0.75);
});

test('our previous tune never counts as coverage — an update is not a collision', async () => {
  const dir = installedDir([{ name: 'old-tune-plan', description: 'planword offer a plan before code', minted: true }]);
  const installed = readInstalledSkills([dir]);
  const verdicts = await inspectTune([unit('derived-plan', 'planword offer a plan before code.')], installed, fakeEmbed({ planword: 0 }));
  assert.equal(verdicts[0]!.verdict, 'mint');
});

test('a native feature covers a unit that would rebuild it', async () => {
  const nativeWord = NATIVE_FEATURES[0]!.text.split(' ')[2]!; // a word from plan mode's text
  const verdicts = await inspectTune([unit('derived-planner', `${nativeWord} do the planning ritual.`)], [], fakeEmbed({ [nativeWord]: 0 }));
  assert.equal(verdicts[0]!.verdict, 'already-fitted');
  assert.equal(verdicts[0]!.coveredBy, 'plan mode');
});

test('no installed world at all: everything mints, nothing throws', async () => {
  const verdicts = await inspectTune([unit('derived-a', 'alpha.')], [], fakeEmbed({}));
  assert.deepEqual(verdicts, [{ name: 'derived-a', kind: 'active', verdict: 'mint' }]);
});
