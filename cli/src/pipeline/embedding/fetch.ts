/**
 * FETCH — the one-time arrivals, and nothing else. Route B (0.6.0) removed the CLI's only runtime
 * dependency; what the discovery engine needs arrives HERE instead, once, into `~/.stratless/`, and only
 * ever from `init`'s consented path. Two artifacts, two hosts, both named in the consent line:
 *
 *   · the runtime  — `@stratless/runtime` from registry.npmjs.org: transformers.js + the ONNX
 *                    WASM runtime, pre-bundled by us. ~3MB down, ~11MB on disk.
 *   · the model    — bge-small weights from huggingface.co (the runtime pulls them on first load,
 *                    from `ensureRuntime`'s consented path), ~34MB. Verified against a pinned hash
 *                    after arrival.
 *
 * EVERYTHING IS PINNED IN CODE. The tarball's sha512 and the weights' sha256 live in this file:
 * a registry compromise, a truncated download, or an upstream re-publish produces a refusal with
 * an honest message, never a silent install. Refuse, don't lie.
 *
 * KILL-SAFE BY SHAPE. The download lives in memory (~3MB); extraction goes to a `.tmp` dir that
 * is swapped into place only after every file checks out. An interrupt leaves either the old
 * runtime or a stale `.tmp` that the next run deletes — never a half-installed runtime.
 *
 * The tar walk is ~40 lines on purpose: npm tarballs are plain ustar with short paths, and a
 * dependency-free CLI does not take a dependency to unpack one.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { MODEL, MODEL_WEIGHTS_SHA256, modelDir, RUNTIME_TARBALL_SHA512, RUNTIME_VERSION, runtimeDir } from './config.js';

export { MODEL_WEIGHTS_SHA256, RUNTIME_TARBALL_SHA512, RUNTIME_VERSION, runtimeDir } from './config.js';
/** Integrity of the runtime tarball — VERIFIED against the registry's own dist.integrity for the
 *  published @stratless/runtime@1.0.0 (2026-07-27, exact match). A runtime version bump updates
 *  this pin and the version together, and is always a versioned, announced rebuild. */
const RUNTIME_URL = `https://registry.npmjs.org/@stratless/runtime/-/runtime-${RUNTIME_VERSION}.tgz`;

/** The weights that define every fingerprint. bge-small-en-v1.5, int8 ONNX, Xenova's published
 *  revision — any drift here would silently change what "similar" means, so drift is a refusal. */
/** The files the runtime must contain to count as installed. */
const RUNTIME_FILES = ['runtime.mjs', 'ort-wasm-simd.wasm'];

type Manifest = { version: string; tarballSha512: string; files: Record<string, string> };

const sha512b64 = (b: Buffer): string => createHash('sha512').update(b).digest('base64');
const sha256hex = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/**
 * Walk a ustar archive into name → bytes. Only regular files; paths are guarded against
 * traversal (a hostile tarball must not be able to write outside its target).
 */
export function extractTar(tar: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let off = 0;
  while (off + 512 <= tar.length) {
    const block = tar.subarray(off, off + 512);
    if (block.every((b) => b === 0)) break; // the end-of-archive zero blocks
    const name = block.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = block.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const size = parseInt(block.subarray(124, 136).toString('utf8').trim(), 8) || 0;
    const type = String.fromCharCode(block[156]);
    const full = prefix ? `${prefix}/${name}` : name;
    if (full.includes('..') || full.startsWith('/')) throw new Error(`refusing tar entry with unsafe path: ${full}`);
    if (type === '0' || type === '\0') out.set(full, Buffer.from(tar.subarray(off + 512, off + 512 + size)));
    off += 512 + Math.ceil(size / 512) * 512; // data is padded to whole blocks
  }
  return out;
}

/**
 * Verify + unpack a runtime tarball into `dir`. Pure of network: `ensureRuntime` downloads, this
 * installs — which is what lets the whole suite test it offline. Throws (and leaves no partial
 * install) on any mismatch.
 */
export function installRuntime(tarball: Buffer, opts: { dir?: string; sha512?: string } = {}): void {
  const dir = opts.dir ?? runtimeDir();
  const expect = opts.sha512 ?? RUNTIME_TARBALL_SHA512;
  const tmp = `${dir}.tmp`;
  rmSync(tmp, { recursive: true, force: true }); // a stale interrupt's leavings

  const got = sha512b64(tarball);
  if (got !== expect) {
    throw new Error(`the runtime download did not match its pinned checksum — refusing to install it.\n  expected sha512-${expect}\n  received sha512-${got}`);
  }

  const files = extractTar(gunzipSync(tarball));
  const manifest: Manifest = { version: RUNTIME_VERSION, tarballSha512: expect, files: {} };
  for (const [name, bytes] of files) {
    if (!name.startsWith('package/dist/')) continue; // the artifact is dist/; README etc. stay behind
    const rel = name.slice('package/dist/'.length);
    const target = join(tmp, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    manifest.files[rel] = sha256hex(bytes);
  }
  for (const f of RUNTIME_FILES) {
    if (!(f in manifest.files)) {
      rmSync(tmp, { recursive: true, force: true });
      throw new Error(`the runtime tarball is missing ${f} — refusing the incomplete install`);
    }
  }
  writeFileSync(join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2));
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
}

/** Is the pinned runtime version installed and complete? `init` asks before offering the fetch;
 *  the loader refuses (never downloads) when this is false. */
export function runtimeInstalled(dir: string = runtimeDir()): boolean {
  try {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;
    if (m.version !== RUNTIME_VERSION) return false; // an old runtime is NOT this runtime
    return RUNTIME_FILES.every((f) => f in m.files && existsSync(join(dir, f)));
  } catch {
    return false;
  }
}

/**
 * Fetch + install the runtime, FOREGROUND, on the consented path only — the same contract as the
 * model fetch beside it. `fetchImpl` exists so tests never touch the network.
 */
export async function fetchRuntime(opts: {
  fetchImpl?: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
} = {}): Promise<void> {
  if (runtimeInstalled()) return;
  const get = opts.fetchImpl ?? fetch;
  const res = await get(RUNTIME_URL);
  if (!res.ok) throw new Error(`could not download the runtime (HTTP ${res.status} from registry.npmjs.org)`);
  installRuntime(Buffer.from(await res.arrayBuffer()));
}

/**
 * The weights check, run after the runtime arrives: 'absent' means not downloaded yet,
 * 'mismatch' means the bytes on disk are not the pinned bge-small — a wrong profile waiting to
 * happen, so the caller refuses to build. Verified from disk, cheap enough to run per build.
 */
export function modelWeights(): 'absent' | 'valid' | 'mismatch' {
  const weights = join(modelDir(), ...MODEL.split('/'), 'onnx', 'model_quantized.onnx');
  if (!existsSync(weights)) return 'absent';
  return sha256hex(readFileSync(weights)) === MODEL_WEIGHTS_SHA256 ? 'valid' : 'mismatch';
}
