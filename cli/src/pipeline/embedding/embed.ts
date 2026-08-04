/**
 * EMBED — the fingerprints. A small model, on this machine, turning each thing the person typed into
 * 384 numbers. Similar behaviour, similar numbers.
 *
 * THIS IS THE STAGE THAT MADE v3 POSSIBLE. It replaces `assign`, which asked a borrowed model "does
 * this moment fit this category?" about 190,000 times per cold build — a reasoning engine doing a
 * lookup table's job, at $20.40 and forty minutes. This does the same work locally for $0, and
 * nothing leaves the machine.
 *
 * NOT A DEPENDENCY — AN ARRIVAL (0.6.0, Route B). The runtime that does the math is NOT in
 * `package.json`: it arrives once, at `init`, after the person's yes — `@stratless/runtime`
 * (transformers.js + the ONNX WASM backend, pre-bundled, ~3MB down) into `~/.stratless/runtime`,
 * plus the bge-small weights (~34MB) beside it. `fetch.ts` owns the arrivals, pinned and
 * checksummed; this module only ever LOADS what is already here, and refuses when it isn't.
 *
 * WASM IS THE CANONICAL RUNTIME — STANDARD OVER SPEED (decided 2026-07-27). The WASM standard
 * computes identical bits on every machine, so fingerprints are portable, cacheable, and
 * comparable across time; the native runtime was ~7× faster but machine-flavored. (0.5.0
 * believed two config lines here pinned WASM — they never did; transformers picks the native
 * binary in Node unconditionally, which is why 0.6.0 rebuilds are versioned via the `pipeline`
 * stamp in engine.json rather than assumed compatible.) A runtime change is ALWAYS a versioned,
 * announced rebuild, never silent drift.
 *
 * LAZY BY CONSTRUCTION. The runtime is loaded on first use, never at import. `mirror` — the free
 * read that `npx stratless` runs, and the surface the launch points at — does pure arithmetic over
 * logs and must never touch a model.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runtimeInstalled, fetchRuntime, modelWeights } from './fetch.js';
import { MODEL, modelDir, runtimeDir } from './config.js';

export { MODEL, modelDir, runtimeDir } from './config.js';
export { runtimeInstalled } from './fetch.js';

/** How many texts ride in one forward pass. ONE, measured, and the number is load-bearing twice.
 *
 *  SPEED: a batch must be a rectangle — every text padded to the batch's longest — and on the
 *  single-thread WASM runtime every padded blank is paid in real serial time. Shaped texts are
 *  short (median ~55 chars) with rare 512-char outliers, so batches of 32 were 73% padding;
 *  batch-of-one computes exactly each text and measured 3.7× faster (2026-07-27). The old
 *  "bigger is faster until memory" was true on the multi-core native runtime and inverted when
 *  the runtime changed — a tuning constant is a claim about hardware, and it expired.
 *
 *  DETERMINISM: the int8 model picks its quantization scales per forward pass, so batch-mates
 *  used to leak into each other's fingerprints (~0.995 cosine by company). At batch 1 there are
 *  no batch-mates: same text → same bits, alone, in any order, on any machine. That property is
 *  what makes embedding caches and sharded/parallel embedding sound, and it is named in the
 *  PIPELINE stamp (`b1`) — changing this constant changes every fingerprint and is a versioned,
 *  announced rebuild, never a tweak. */
const BATCH = 1;

/** BGE's window. Beyond this the tokenizer truncates from the END — and the end of a reply is often
 *  where the person's point lands, so we cap deliberately rather than letting it happen silently.
 *  Exported for the embedding worker, which must slice identically or bit-identity breaks. */
export const MAX_CHARS = 512;

/** Below this many texts the pool is not worth its worker startup (~1s) — and `grow`'s daily
 *  handful must never pay it. At or above it (cold builds, migrations), fingerprinting fans out. */
const POOL_MIN = 256;

/** Never more than 4 workers: measured on an 8-core/4-performance-core laptop, K=4 gave 3.07× and
 *  K=8 was SLOWER and 2× the memory (efficiency cores + startup don't pay). Each worker holds its
 *  own runtime + weights (~260MB); 4 keeps peak ~1GB. */
const POOL_MAX = 4;

type Extractor = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{
  data: Float32Array; dims: number[];
}>;

let extractor: Extractor | undefined;

/**
 * Load the runtime, once per process, from `~/.stratless/runtime` — never from node_modules, which
 * has nothing to offer. The import is dynamic so that merely importing this module costs nothing —
 * `mirror` imports the world and must stay instant. Refuses (it does NOT fetch) when the runtime is
 * absent or the weights on disk fail their pinned hash: a wrong fingerprint is worse than none.
 *
 * Exported for the embedding worker: every pool worker loads through THIS function, so the pins
 * (single thread, wasmPaths, local-only models) have exactly one home.
 */
export async function loadExtractor(): Promise<Extractor> {
  if (extractor) return extractor;
  if (!runtimeInstalled()) {
    throw new Error('the local runtime is not installed — `stratless init` fetches it, with consent');
  }
  if (modelWeights() === 'mismatch') {
    throw new Error('the model weights on disk do not match their pinned hash — refusing to fingerprint with an unverified model');
  }
  const { pipeline, env } = (await import(pathToFileURL(join(runtimeDir(), 'runtime.mjs')).href)) as {
    pipeline: (task: string, model: string) => Promise<unknown>;
    env: {
      backends: { onnx: { wasm: { numThreads: number; wasmPaths: string } } };
      allowLocalModels: boolean; localModelPath: string; cacheDir: string;
    };
  };
  // ONE THREAD, DELIBERATELY: a fixed order of floating-point work is what makes "identical bits on
  // every machine" true. Faster threaded WASM exists — it ships only if fingerprints survive it.
  env.backends.onnx.wasm.numThreads = 1;
  // EXPLICIT, because the default is a trap: left alone, ort looks for its .wasm relative to the
  // process's CWD (measured: `<cwd>/dist/ort-wasm-simd.wasm`), which happens to work exactly when
  // a bundle sits in a folder named dist under wherever the person ran the command. The binary
  // lives beside runtime.mjs; say so.
  env.backends.onnx.wasm.wasmPaths = `${runtimeDir()}/`;
  env.allowLocalModels = true;
  env.localModelPath = modelDir();
  env.cacheDir = modelDir();
  mkdirSync(modelDir(), { recursive: true });
  extractor = (await pipeline('feature-extraction', MODEL)) as unknown as Extractor;
  return extractor;
}

/** Are the weights already on this machine? One half of `runtimePresent`. */
export function modelPresent(): boolean {
  return existsSync(join(modelDir(), MODEL.replace('/', '_'))) || existsSync(join(modelDir(), ...MODEL.split('/')));
}

/** Is EVERYTHING the engine needs on this machine — runtime files AND weights? `init` asks before
 *  offering the fetch; the background paths refuse (never download) when this is false. */
export function runtimePresent(): boolean {
  return runtimeInstalled() && modelPresent();
}

/**
 * Fetch whatever is missing — the runtime tarball, then the weights (the engine pulls them from
 * Hugging Face on first load). Called by `init`, in the FOREGROUND, after consent — never from the
 * background Stop hook, which must stay silent and free. Both arrivals verify against pinned
 * hashes; a failure reports honestly and installs nothing.
 */
export async function ensureRuntime(): Promise<void> {
  await fetchRuntime();
  await loadExtractor();
  const weights = modelWeights();
  if (weights !== 'valid') {
    throw new Error(weights === 'absent'
      ? 'the model weights never arrived — check your connection and run `stratless init` again'
      : 'the model weights do not match their pinned hash — refusing to keep an unverified model');
  }
}

/**
 * Fingerprint every text. Returns unit vectors, so a dot product IS cosine everywhere downstream and
 * no stage has to remember to normalise.
 *
 * `onProgress` exists because this is the longest silent stretch in a cold build — minutes of
 * nothing is indistinguishable from a hang, and the CLI has spinners on every other wait.
 */
export async function embedAll(texts: string[], onProgress?: (done: number, total: number) => void): Promise<Float32Array[]> {
  // TEST SEAM. The end-to-end worker tests (kill-safety, stop, the consent gate) exercise the real
  // pipeline and must not download 40MB or reach the network to do it. This returns deterministic
  // vectors derived from the text itself — same text, same vector; similar text, similar vector —
  // which is every property the stages downstream actually depend on. (The lambda matters:
  // `texts.map(fakeVector)` fed map's INDEX into fakeVector's `dims` and every fake vector had a
  // different dimensionality — unnoticed until the topic discriminator became the first consumer
  // to depend on the fake geometry, 2026-07-29.)
  if (process.env.STRATLESS_FAKE_EMBED === '1') return texts.map((t) => fakeVector(t));
  // THE POOL. Big jobs (cold builds, migrations) fan out across up to POOL_MAX workers, each with
  // its own single-threaded runtime, each fingerprinting one text at a time. SAFE ONLY BECAUSE OF
  // BATCH=1: fingerprints are grouping-independent, so sharding cannot change a single bit —
  // measured 3.07× on a real pile with hashes equal to the sequential run. A pool problem must
  // never fail a build, so any worker error falls back to the sequential path below; and
  // STRATLESS_NO_POOL=1 is the escape hatch (also how the bit-identity test gets its reference).
  if (texts.length >= POOL_MIN && process.env.STRATLESS_NO_POOL !== '1' && runtimePresent()) {
    try {
      return await embedPooled(texts, onProgress);
    } catch {
      /* fall through — sequential embedding answers every question the pool can't */
    }
  }
  const embed = await loadExtractor();
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH).map((t) => t.slice(0, MAX_CHARS) || '.');
    const res = await embed(chunk, { pooling: 'mean', normalize: true });
    const dim = res.dims[1];
    for (let j = 0; j < chunk.length; j++) out.push(Float32Array.from(res.data.slice(j * dim, (j + 1) * dim)));
    onProgress?.(Math.min(i + BATCH, texts.length), texts.length);
  }
  return out;
}

/**
 * Fan the texts out across workers as contiguous shards and reassemble in order. Progress is
 * reported as 640-multiples only — the cold build's throttle prints on exact multiples, and the
 * pool's aggregate counts would otherwise never land on one.
 */
async function embedPooled(texts: string[], onProgress?: (done: number, total: number) => void): Promise<Float32Array[]> {
  const { Worker } = await import('node:worker_threads');
  const { availableParallelism } = await import('node:os');
  const k = Math.min(POOL_MAX, Math.max(1, availableParallelism() - 1));
  if (k < 2) throw new Error('no parallelism to pool');

  const shards: string[][] = [];
  const base = Math.floor(texts.length / k);
  let off = 0;
  for (let w = 0; w < k; w++) {
    const size = base + (w < texts.length % k ? 1 : 0);
    shards.push(texts.slice(off, off + size));
    off += size;
  }

  const progress = new Array<number>(k).fill(0);
  let lastMilestone = 0;
  const flats = await Promise.all(shards.map((shard, w) => new Promise<Float32Array>((resolve, reject) => {
    const worker = new Worker(new URL('./embedworker.js', import.meta.url), { workerData: { texts: shard } });
    worker.on('message', (m: { progress?: number; done?: ArrayBuffer }) => {
      if (m.done) return resolve(new Float32Array(m.done));
      progress[w] = m.progress ?? 0;
      const total = progress.reduce((a, b) => a + b, 0);
      const milestone = Math.floor(total / 640) * 640;
      if (milestone > lastMilestone) {
        lastMilestone = milestone;
        onProgress?.(milestone, texts.length);
      }
    });
    worker.on('error', reject);
    worker.on('exit', (code) => { if (code !== 0) reject(new Error(`embed worker exited ${code}`)); });
  })));

  const out: Float32Array[] = [];
  shards.forEach((shard, w) => {
    const flat = flats[w];
    const dim = shard.length ? flat.length / shard.length : 0;
    for (let i = 0; i < shard.length; i++) out.push(flat.subarray(i * dim, (i + 1) * dim));
  });
  return out;
}

/**
 * A deterministic stand-in for a fingerprint, used only under STRATLESS_FAKE_EMBED.
 *
 * Hashes each word into a small number of dimensions and accumulates — a bag-of-words projection.
 * It is not a language model, and it is not meant to be: it just has to be stable (same text, same
 * vector), similar for similar text, and unit-length, which is exactly what `cluster.ts` relies on.
 */
function fakeVector(text: string, dims = 384): Float32Array {
  const v = new Float32Array(dims);
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9]{1,}/g) ?? []) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[Math.abs(h) % dims] += 1;
    v[Math.abs(h >> 8) % dims] += 0.5;
  }
  let n = 0;
  for (let i = 0; i < dims; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < dims; i++) v[i] /= n;
  return v;
}
