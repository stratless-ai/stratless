/**
 * Replaces `onnxruntime-node` at bundle time — the 92MB of per-OS native binaries that made
 * `npx stratless` cost strangers 116MB. transformers' backends/onnx.js does
 * `ONNX = ONNX_NODE.default ?? ONNX_NODE` when it detects Node, so handing ort-web over as
 * `default` lands the node branch on the WASM runtime.
 *
 * CJS on purpose: ort-web's webpack build stamps `__esModule` while keeping everything on
 * module.exports — an ESM default import therefore yields undefined (measured: env.backends.onnx
 * vanished). require() does no dialect-guessing; it hands over the real object.
 */
module.exports = require('onnxruntime-web');
