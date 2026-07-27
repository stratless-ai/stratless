/**
 * The package's own gate, run by `test` and prepublishOnly. Three properties, all structural:
 * the artifact exists and is complete; the published package declares ZERO dependencies of any
 * kind (the entire point of bundling); and the bundle actually loads and exposes the contract
 * surface — offline, no model needed, because import alone never touches weights or network.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
assert.equal(pkg.dependencies, undefined, 'runtime must declare NO dependencies — they defeat the bundle');
assert.equal(pkg.optionalDependencies, undefined, 'runtime must declare NO optionalDependencies');
assert.equal(pkg.peerDependencies, undefined, 'runtime must declare NO peerDependencies');

for (const f of ['runtime.mjs', 'ort-wasm-simd.wasm', 'licenses/xenova-transformers-2.17.2-Apache-2.0.txt', 'licenses/onnxruntime-web-1.14.0-MIT.txt']) {
  assert.ok(existsSync(join(here, 'dist', f)), `dist/${f} missing — run build first`);
}

const { pipeline, env } = await import(join(here, 'dist', 'runtime.mjs'));
assert.equal(typeof pipeline, 'function', 'bundle must export pipeline()');
assert.ok(env?.backends?.onnx?.wasm, 'bundle must expose env.backends.onnx.wasm — the CLI pins its knobs there');

console.log('runtime check: zero deps declared, artifact complete, contract surface loads');
