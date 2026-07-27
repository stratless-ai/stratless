/**
 * FETCH — offline proof of the arrival path. A synthetic ustar tarball stands in for the real
 * package (same layout: package/dist/*), so every property is testable with no network and no
 * 11MB fixture: the tar walk, the traversal guard, checksum refusal with no partial install,
 * the happy install, interrupt recovery, and version-aware presence.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { RUNTIME_VERSION, runtimeInstalled, extractTar, installRuntime } from './fetch.js';

/** Build a minimal ustar archive — headers exactly as fetch.ts reads them. */
function tarOf(entries: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content, 'utf8');
    const h = Buffer.alloc(512);
    h.write(name, 0, 'utf8');
    h.write('0000644\0', 100, 'utf8'); // mode
    h.write('0000000\0', 108, 'utf8'); // uid
    h.write('0000000\0', 116, 'utf8'); // gid
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'utf8');
    h.write('0000000000\0', 136, 'utf8'); // mtime
    h.write('        ', 148, 'utf8'); // checksum: spaces while summing
    h.write('0', 156, 'utf8'); // regular file
    h.write('ustar', 257, 'utf8');
    h.write('00', 263, 'utf8');
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'utf8');
    blocks.push(h, data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024)); // end-of-archive
  return Buffer.concat(blocks);
}

const sha512 = (b: Buffer): string => createHash('sha512').update(b).digest('base64');

const ENGINE_ENTRIES = {
  'package/dist/runtime.mjs': 'export const pipeline = 1;',
  'package/dist/ort-wasm-simd.wasm': 'not really wasm, and that is fine here',
  'package/dist/licenses/x.txt': 'license text',
  'package/README.md': 'never extracted — only dist/ is the artifact',
};

test('extractTar walks names, sizes, and content faithfully', () => {
  const files = extractTar(tarOf(ENGINE_ENTRIES));
  assert.equal(files.get('package/dist/runtime.mjs')!.toString(), 'export const pipeline = 1;');
  assert.equal(files.size, 4);
});

test('extractTar refuses traversal — a hostile tarball cannot escape its target', () => {
  assert.throws(() => extractTar(tarOf({ 'package/../../evil': 'x' })), /unsafe path/);
});

test('checksum mismatch refuses loudly and leaves NO partial install', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'stratless-fetch-')), 'engine');
  const tgz = gzipSync(tarOf(ENGINE_ENTRIES));
  assert.throws(() => installRuntime(tgz, { dir, sha512: 'sha-of-something-else' }), /pinned checksum/);
  assert.ok(!existsSync(dir), 'no engine dir after refusal');
  assert.ok(!existsSync(`${dir}.tmp`), 'no tmp leavings after refusal');
});

test('a valid tarball installs dist/ only, writes a manifest, and reads back present', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'stratless-fetch-')), 'engine');
  const tgz = gzipSync(tarOf(ENGINE_ENTRIES));
  installRuntime(tgz, { dir, sha512: sha512(tgz) });
  assert.ok(existsSync(join(dir, 'runtime.mjs')));
  assert.ok(existsSync(join(dir, 'licenses', 'x.txt')), 'nested paths survive');
  assert.ok(!existsSync(join(dir, 'README.md')), 'only dist/ is the artifact');
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, RUNTIME_VERSION);
  assert.ok(runtimeInstalled(dir));
});

test('an incomplete tarball (no wasm) refuses and cleans up', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'stratless-fetch-')), 'engine');
  const tgz = gzipSync(tarOf({ 'package/dist/runtime.mjs': 'alone' }));
  assert.throws(() => installRuntime(tgz, { dir, sha512: sha512(tgz) }), /missing ort-wasm-simd\.wasm/);
  assert.ok(!existsSync(dir) && !existsSync(`${dir}.tmp`));
});

test('a stale .tmp from an interrupt is swept, and reinstall over an old engine swaps cleanly', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'stratless-fetch-')), 'engine');
  mkdirSync(`${dir}.tmp`, { recursive: true });
  writeFileSync(join(`${dir}.tmp`, 'half-written'), 'interrupted');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'runtime.mjs'), 'the OLD engine');
  const tgz = gzipSync(tarOf(ENGINE_ENTRIES));
  installRuntime(tgz, { dir, sha512: sha512(tgz) });
  assert.equal(readFileSync(join(dir, 'runtime.mjs'), 'utf8'), 'export const pipeline = 1;');
  assert.ok(!existsSync(`${dir}.tmp`));
  rmSync(join(dir, 'manifest.json'));
  assert.ok(!runtimeInstalled(dir), 'presence requires the manifest, not just files');
});
