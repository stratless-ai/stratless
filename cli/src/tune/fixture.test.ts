/**
 * THE ACCEPTANCE TEST — the deriver against the reference archive (the dogfood-gate pattern:
 * one reference archive, earned by real use, is the standard a derivation is judged by).
 *
 * Runs only where it can mean something: the shipped runtime present AND the live claude-code
 * store still carrying exactly the row set the fixture was frozen against. A machine without
 * the archive skips; a rebuilt map skips (new world, not regression) — re-freeze the fixture
 * from a fresh calibrated run when the map moves.
 */
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

import { runtimePresent, modelPresent, embedAll } from '../pipeline/embedding/embed.js';
import { voicedPath, readVoiced } from '../pipeline/voiced.js';
import { deriveTune, stageOf } from './derive.js';
import { EXPECTED_DERIVED_TUNE, EXPECTED_STAGE, FIXTURE_ROWS } from './fixture.js';
import { assembleTuneInput } from './rows.js';

const RECORD = 'claude-code';

function referenceArchivePresent(): boolean {
  if (!runtimePresent() || !modelPresent()) return false;
  if (!existsSync(voicedPath(RECORD))) return false;
  const names = readVoiced(RECORD).rows.map((r) => r.name).sort();
  return names.length === FIXTURE_ROWS.length && names.every((n, i) => n === FIXTURE_ROWS[i]);
}

test('the derived tune matches the frozen reference derivation', { skip: !referenceArchivePresent() }, async () => {
  const tune = await deriveTune(assembleTuneInput(RECORD), embedAll);

  assert.equal(tune.units.length, EXPECTED_DERIVED_TUNE.units.length);
  for (const exp of EXPECTED_DERIVED_TUNE.units) {
    const got = tune.units.find((u) => u.anchor === exp.anchor);
    assert.ok(got, `missing unit anchored at ${exp.anchor}`);
    assert.equal(got.kind, exp.kind, `${exp.anchor} classified as ${got.kind}, expected ${exp.kind}`);
    assert.deepEqual(
      got.members.map((m) => m.name).sort(),
      exp.members,
      `${exp.anchor} membership drifted`,
    );
  }
  assert.deepEqual(
    tune.leftovers.map((m) => m.name).sort(),
    EXPECTED_DERIVED_TUNE.leftovers,
  );
  assert.equal(stageOf(tune), EXPECTED_STAGE);
});
