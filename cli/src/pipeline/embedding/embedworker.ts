/**
 * EMBEDWORKER — one hand of the pool. Receives a contiguous shard of shaped texts, loads its OWN
 * runtime instance through the same `loadExtractor()` as everyone else (one home for the pins:
 * single thread, wasmPaths, local-only models), fingerprints one text at a time, and hands back a
 * single transferred Float32Array.
 *
 * BIT-IDENTITY IS THE CONTRACT. This worker must produce exactly the bytes the sequential path
 * would — same slice cap, same '.' fallback, same batch-of-one — because the pool ships gated on
 * a hash comparison, not on "close enough". If this file drifts from `embedAll`'s inner loop, the
 * gate in embedpool.test.ts is what catches it.
 */
import { parentPort, workerData } from 'node:worker_threads';

import { MAX_CHARS, loadExtractor } from './embed.js';

if (!parentPort) throw new Error('embedworker only runs as a worker thread');
const port = parentPort;
const { texts } = workerData as { texts: string[] };

const embed = await loadExtractor();
let out = new Float32Array(0);
let dim = 0;
for (let i = 0; i < texts.length; i++) {
  const res = await embed([texts[i].slice(0, MAX_CHARS) || '.'], { pooling: 'mean', normalize: true });
  if (!dim) {
    dim = res.dims[1];
    out = new Float32Array(texts.length * dim);
  }
  out.set(res.data.subarray(0, dim), i * dim);
  if (i % 64 === 0) port.postMessage({ progress: i });
}
port.postMessage({ progress: texts.length });
port.postMessage({ done: out.buffer }, [out.buffer]);
