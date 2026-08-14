# @stratless/runtime

The local embedding runtime for [stratless](https://github.com/stratless-ai/stratless) — transformers.js and the ONNX
Runtime WASM backend, pre-bundled into ~11MB with everything else stubbed out.

**You never install this package yourself.** The stratless CLI downloads it once, into
`~/.stratless/runtime/`, at `init` — after asking, with the size named out loud. It is pinned by
exact version and integrity hash in the CLI's code, and it declares zero dependencies: what you
see in `dist/` is everything there is.

## Why it exists

stratless turns your own words into fingerprints using a small local model — nothing leaves your
machine. Shipping that runtime as a normal npm dependency made a first-time `npx stratless`
download 116MB, ~90% of it native binaries and image codecs the model runner never executes. This
package is the same runtime with the dead weight compiled out: ~1.3MB of JavaScript and one
~9.6MB WASM binary.

## Why WASM

Standard over speed. The WASM standard computes identical bits on every machine — fingerprints
become portable and cacheable, and no one's profile depends on which chip built it. The native
runtime was faster but machine-flavored. Because any change to this bundle changes the
fingerprints, every version bump here becomes a versioned, announced rebuild in the CLI — never a
silent drift.

## What's inside

- [transformers.js](https://github.com/xenova/transformers.js) 2.17.2 (Apache-2.0) — bundled
- [ONNX Runtime](https://github.com/microsoft/onnxruntime) web 1.14.0, WASM backend (MIT) — bundled, SIMD binary only
- Upstream licenses ship in `dist/licenses/`

The model weights are **not** in this package — they arrive separately from Hugging Face, also at
consent, also named and sized before the yes.
