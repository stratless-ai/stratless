/**
 * Build @stratless/runtime: transformers.js compiled for Node with the dead weight stubbed out,
 * plus the ONE WASM binary. The output IS the package — dist/ is everything that publishes.
 *
 * Resolution goes through createRequire chains, never hardcoded store paths: transformers resolves
 * from THIS package's devDependencies, and onnxruntime-web resolves from transformers' own
 * dependency tree — so the versions that bundle are exactly the versions the lockfile pinned.
 *
 * ONE WASM FILE ON PURPOSE. ort ships four variants; we ship ort-wasm-simd.wasm alone. Node ≥18
 * always has WASM SIMD (measured: the bundle embeds with only this file present), and the CLI pins
 * numThreads=1 so the threaded variants are never requested.
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const req = createRequire(join(here, 'build.mjs'));

const transformersPkg = req.resolve('@xenova/transformers/package.json');
const transformersDir = dirname(transformersPkg);
const ortPkg = createRequire(transformersPkg).resolve('onnxruntime-web/package.json');
const ortDir = dirname(ortPkg);

rmSync(join(here, 'dist'), { recursive: true, force: true });

await build({
  entryPoints: [join(here, 'src', 'entry.js')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: join(here, 'dist', 'runtime.mjs'),
  alias: {
    'onnxruntime-node': join(here, 'src', 'ort-shim.cjs'),
    'onnxruntime-web': ortDir,
    sharp: join(here, 'src', 'stub-sharp.js'),
  },
  // ort-web's CJS requires node builtins and uses __dirname; ESM output needs both defined for
  // real — the standard createRequire banner. NOTE: this does NOT make ort find its WASM beside
  // the bundle (its default lookup is CWD-relative, measured) — the CLI pins
  // env.backends.onnx.wasm.wasmPaths to the install dir instead.
  banner: {
    js: [
      "import { createRequire as __rtCR } from 'node:module';",
      "import { fileURLToPath as __rtF2P } from 'node:url';",
      "import { dirname as __rtDN } from 'node:path';",
      'const require = __rtCR(import.meta.url);',
      'const __filename = __rtF2P(import.meta.url);',
      'const __dirname = __rtDN(__filename);',
    ].join('\n'),
  },
  logLevel: 'info',
});

copyFileSync(join(ortDir, 'dist', 'ort-wasm-simd.wasm'), join(here, 'dist', 'ort-wasm-simd.wasm'));

// Attribution travels with the artifact: the bundled libraries' licenses ship inside dist/.
mkdirSync(join(here, 'dist', 'licenses'), { recursive: true });
copyFileSync(join(transformersDir, 'LICENSE'), join(here, 'dist', 'licenses', 'xenova-transformers-2.17.2-Apache-2.0.txt'));
// ort-web ships no license text (only a package.json field) — we carry the MIT text ourselves.
copyFileSync(join(here, 'src', 'onnxruntime-MIT.txt'), join(here, 'dist', 'licenses', 'onnxruntime-web-1.14.0-MIT.txt'));

for (const f of ['runtime.mjs', 'ort-wasm-simd.wasm']) {
  console.log(`${f}  ${(statSync(join(here, 'dist', f)).size / 1024 / 1024).toFixed(2)}MB`);
}
