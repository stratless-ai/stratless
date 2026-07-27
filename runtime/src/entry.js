/**
 * The runtime's public surface — exactly what the CLI's `embed.ts load()` consumes, nothing more.
 * `pipeline` builds the extractor; `env` carries the knobs (model paths, wasm settings) the CLI
 * pins. Everything else transformers.js exports stays internal to the bundle on purpose: the
 * smaller this surface, the smaller the contract a future runtime has to honor.
 */
export { pipeline, env } from '@xenova/transformers';
