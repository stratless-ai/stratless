# runtime/ — agent guide

`@stratless/runtime`: the pre-bundled WASM embedding runtime the CLI fetches at `init`'s consent.
Built by `build.mjs` (esbuild; transformers.js with `onnxruntime-node` shimmed to ort-web and
`sharp` stubbed loud), gated by `check.mjs`.

## Boundaries

- 🚫 **Never add `dependencies` of any kind.** The published artifact is self-contained; bundled
  libraries are devDependencies because they are compiled in. `check.mjs` enforces this.
- 🚫 **Never bump the bundled library versions casually.** Any change to this bundle changes every
  user's fingerprints. A version bump here is a **versioned, announced rebuild event** in the CLI
  (the `pipeline` stamp), shipped through the parity discipline in
  `~/stratless-strategy/builds/route-b-consent-arrival.md` — measured, never drifted into.
- ⚠️ **Publishing is a one-way door** — Sun's explicit go, like the CLI. The CLI pins this
  package's exact version + integrity hash in code; publish and pin move together.
- ✅ Exact pins in devDependencies, no ranges — this package's job is reproducible output.
- ✅ The export surface stays minimal (`pipeline`, `env`) — it is the contract `cli/src/embed.ts`
  loads; widen it only with a reason the CLI actually has.
