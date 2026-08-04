/**
 * THE POOL'S ONE GATE: pooled output must be BIT-IDENTICAL to sequential output — not similar,
 * equal. This is what lets the pool ship with no stamp change and no rebuild: it can change the
 * clock and nothing else. Needs the real runtime + weights on disk, so it runs on dev machines
 * and skips where they're absent (CI's stranger-clone has neither).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { embedAll, runtimePresent } from './embed.js';

const flat = (vs: Float32Array[]): Buffer =>
  Buffer.concat(vs.map((v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength)));

test('pooled embedding is bit-identical to sequential', { skip: !runtimePresent() }, async () => {
  // 300 texts: enough to cross POOL_MIN and shard unevenly across 4 workers (300 = 4×75), with
  // length variety so padding-adjacent bugs would show. Deterministic — no randomness.
  const texts = Array.from({ length: 300 }, (_, i) =>
    `sample ${i} ${'word '.repeat(i % 40)}${i % 7 === 0 ? 'x'.repeat(500) : ''}`.trim());

  delete process.env.STRATLESS_NO_POOL;
  const pooled = await embedAll(texts);
  process.env.STRATLESS_NO_POOL = '1';
  try {
    const sequential = await embedAll(texts);
    assert.equal(pooled.length, sequential.length);
    assert.equal(Buffer.compare(flat(pooled), flat(sequential)), 0, 'pooled and sequential fingerprints differ — the pool must not ship');
  } finally {
    delete process.env.STRATLESS_NO_POOL;
  }
});
