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

import { runtimePresent, modelPresent } from '../pipeline/embedding/embed.js';
import { voicedPath, readVoiced } from '../pipeline/voiced.js';
import { FIXTURE_ROWS } from './fixture.js';

const RECORD = 'claude-code';

function referenceArchivePresent(): boolean {
  if (!runtimePresent() || !modelPresent()) return false;
  if (!existsSync(voicedPath(RECORD))) return false;
  const names = readVoiced(RECORD).rows.map((r) => r.name).sort();
  return names.length === FIXTURE_ROWS.length && names.every((n, i) => n === FIXTURE_ROWS[i]);
}

test('measure finds every hand-verified ground truth in the reference archive', { skip: !referenceArchivePresent() }, async () => {
  const { measure } = await import('./derive.js');
  const { MEASURE_GROUND_TRUTHS: G } = await import('./fixture.js');
  const findings = await measure(RECORD);

  const rituals = findings.filter((f) => f.kind === 'ritual');
  assert.ok(
    rituals.some((f) => G.ritualTokens.every((t) => (f.detail!.tokens as string[]).includes(t))),
    'the commit ritual surfaces',
  );
  assert.ok(
    findings.some((f) => f.kind === 'lesson' && f.exemplars.some((e) => e.quote?.includes(G.lessonQuote))),
    'the jina episode surfaces',
  );
  assert.ok(
    findings.some((f) => f.kind === 'rule' && f.detail?.phrase === G.rulePhrase),
    'the merged-watch-ci rule surfaces',
  );
  assert.ok(
    findings.some((f) => f.kind === 'win' && (f.receipts.approvals ?? 0) >= G.winsAtLeast),
    'approvals exist in quantity',
  );
  assert.ok(
    findings.some((f) => f.kind === 'arrival' && f.detail?.term === G.arrivalTerm),
    'the July arrival surfaces',
  );
  // the numerals boundary holds for every claim of every finding
  for (const f of findings) assert.equal(/[0-9]/.test(f.claim), false, `${f.id}: claim carries no digits`);
});
