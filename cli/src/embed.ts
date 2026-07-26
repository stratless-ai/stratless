/**
 * EMBED — the fingerprints. A small model, on this machine, turning each thing the person typed into
 * 384 numbers. Similar behaviour, similar numbers.
 *
 * THIS IS THE STAGE THAT MADE v3 POSSIBLE. It replaces `assign`, which asked a borrowed model "does
 * this moment fit this category?" about 190,000 times per cold build — a reasoning engine doing a
 * lookup table's job, at $20.40 and forty minutes. This does the same work in ~90 seconds for $0,
 * and nothing leaves the machine.
 *
 * THE ONE DEPENDENCY. `bge-small-en-v1.5` (BAAI, MIT, ~34MB int8 ONNX) via `transformers.js`. This
 * is the first runtime dependency the CLI has ever taken, and it was taken deliberately:
 *
 *   · it BREAKS  "cli/ stays zero runtime dependency"
 *   · it KEEPS   "nothing leaves" — the model runs entirely here. The only network touch is the
 *                weights arriving ONCE, like an app update, never the person's data going out.
 *
 * ⚠️ THE WASM BACKEND IS PINNED, AND THAT IS NOT OPTIONAL. Left alone, `transformers.js` in Node
 * will load `onnxruntime-node` — a NATIVE binary — if it can resolve one. A native binary is exactly
 * the cross-platform install hazard the whole no-native-build choice exists to avoid: it fails at
 * `npm install` on someone else's machine, in a way we cannot reproduce or debug. WASM is slower and
 * cannot fail that way.
 *
 * LAZY BY CONSTRUCTION. The model is loaded on first use, never at import. `mirror` — the free read
 * that `npx stratless` runs, and the surface the launch points at — does pure arithmetic over logs
 * and must never touch a model. If importing this module downloaded 34MB, that would be broken.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** BAAI, MIT-licensed, 384 dimensions. Strong on short informal text, no native build.
 *  (Runner-up: all-MiniLM-L6-v2 — smaller and measurably weaker on the harder behaviours.) */
export const MODEL = 'Xenova/bge-small-en-v1.5';

/** Where the weights live. Beside the person's own stores, not in node_modules — so an npm reinstall
 *  does not re-download 34MB, and `stop` can reason about everything stratless put on the disk. */
export const modelDir = (): string => process.env.STRATLESS_MODELS || join(homedir(), '.stratless', 'models');

/** How many texts ride in one forward pass. Bigger is faster until memory; 32 is comfortable on a
 *  laptop and the whole pass is under two minutes on a 5,000-moment pile. */
const BATCH = 32;

/** BGE's window. Beyond this the tokenizer truncates from the END — and the end of a reply is often
 *  where the person's point lands, so we cap deliberately rather than letting it happen silently. */
const MAX_CHARS = 512;

type Extractor = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{
  data: Float32Array; dims: number[];
}>;

let extractor: Extractor | undefined;

/**
 * Load the model, once per process. The import is dynamic so that merely importing this module costs
 * nothing — `mirror` imports the world and must stay instant.
 */
async function load(): Promise<Extractor> {
  if (extractor) return extractor;
  const { pipeline, env } = await import('@xenova/transformers');
  // THE PIN. See the header — without these two lines the runtime may reach for a native binary.
  env.backends.onnx.wasm.numThreads = 1;
  env.allowLocalModels = true;
  env.localModelPath = modelDir();
  env.cacheDir = modelDir();
  mkdirSync(modelDir(), { recursive: true });
  extractor = (await pipeline('feature-extraction', MODEL)) as unknown as Extractor;
  return extractor;
}

/** Is the model already on this machine? `init` asks before offering to fetch it. */
export function modelPresent(): boolean {
  return existsSync(join(modelDir(), MODEL.replace('/', '_'))) || existsSync(join(modelDir(), ...MODEL.split('/')));
}

/**
 * Fetch the weights if they are not here yet. Called by `init`, in the FOREGROUND, after consent —
 * never from the background Stop hook, which must stay silent and free. A ~34MB download that
 * happens invisibly while someone is working is a surprise, and surprises are how trust goes.
 */
export async function ensureModel(): Promise<void> {
  await load();
}

/**
 * Fingerprint every text. Returns unit vectors, so a dot product IS cosine everywhere downstream and
 * no stage has to remember to normalise.
 *
 * `onProgress` exists because this is the longest silent stretch in a cold build — a minute and a
 * half of nothing is indistinguishable from a hang, and the CLI has spinners on every other wait.
 */
export async function embedAll(texts: string[], onProgress?: (done: number, total: number) => void): Promise<Float32Array[]> {
  // TEST SEAM. The end-to-end worker tests (kill-safety, stop, the consent gate) exercise the real
  // pipeline and must not download 34MB or reach the network to do it. This returns deterministic
  // vectors derived from the text itself — same text, same vector; similar text, similar vector —
  // which is every property the stages downstream actually depend on.
  if (process.env.STRATLESS_FAKE_EMBED === '1') return texts.map(fakeVector);
  const embed = await load();
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
