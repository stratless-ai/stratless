# stratless — agent guide

Monorepo for **stratless**: a local, private person-layer profiler. It reads your AI coding
assistant's own transcripts, breaks each session into moments, discovers the recurring things you do
from your own history, counts them, and writes a profile of the person (`HUMAN.md`) that loads into
the assistant so it stops talking over your head or under it. No server, no API key, nothing leaves
the machine. (Pipeline: `moments → shape → embed → cluster → name → count → lift → write`.)

This is the **project layer** (this codebase). Don't confuse it with `HUMAN.md`, which is the
product's *output*: a profile of a person.

## Layout

- `cli/` — the tool. TypeScript, **zero** runtime deps (the embedding runtime arrives at `init`'s consent, never via npm — see `cli/AGENTS.md`), published standalone to npm.
- `runtime/` — `@stratless/runtime`: the embedding runtime (transformers.js + ONNX WASM), pre-bundled by us, fetched once at consent. Zero deps of its own; changes here are versioned rebuild events (see `runtime/AGENTS.md`).
- `web/` — stratless.com. Nuxt 3, no modules, prerendered to static HTML.

## Commands (from the repo root)

```
pnpm install
pnpm -r build       # build every package
pnpm test           # the cli's tests — needs `pnpm -r build` first (tests run compiled dist/)
pnpm -r typecheck
pnpm dev:web        # run stratless.com locally   (pnpm generate = static build)
```

### Verifying a web change — `pnpm dev:web` is NOT enough

`nuxi dev` serves every asset from localhost in under 5ms, so anything whose failure depends on
network timing is invisible there. That blind spot cost four days: `font-display: optional` shipped
2026-07-16, looked perfect in dev and in `nuxi generate`, and left **9 of every 12 first-time
visitors** reading stratless.com in system sans — permanently, since `optional` forbids the swap.

For anything touching CSS, fonts, or above-the-fold rendering, check the **production build over a
cold, throttled connection**:

```
pnpm --filter ./web generate
pnpm --filter ./web preview          # serves .output/public — what Cloudflare actually gets
pnpm --filter ./web check:fonts      # automated: cold profile + throttling, in a real browser
```

In DevTools, "Disable cache" alone is not a first visit — use a fresh profile or an incognito window
plus network throttling, because a warm DNS/TLS connection is most of what a first visitor pays for.

## Boundaries

- 🚫 **Never auto-commit.** Stage explicit pathspecs, leave the tree green and uncommitted; a human commits.
- 🚫 **Never add telemetry or central pooling.** Nothing leaves the user's machine, ever.
- ⚠️ **Ask before flipping the published cli or the live site** — both are one-way doors; don't ship an unproven change to either.
- ✅ **Docs move with the code.** A PR that changes `cli/` behavior updates `web/content/docs/` and `cli/README.md` in the same PR — the site describing a previous version is a trust bug. (CI nudges: `.github/workflows/docs-nudge.yml`.)
- ✅ **Numbers in copy are computed, never typed.** The site's version badge comes from the build (`web/nuxt.config.ts` reads `cli/package.json`); never hand-write it, anywhere.
- ✅ **One sample profile, one source.** `web/content/samples/HUMAN.md` is a real build, checked in verbatim; the landing renders it in full. Every excerpt surface — the hero terminal (`web/pages/index.vue`), the README hero image (`assets/profile-hero.svg` + its `alt`), the npm README (`cli/README.md`), the docs sample (`web/content/docs/1.human-md.md`) — shows rows from that same build, in the format `cli/src/write.ts` currently emits. Update them together or not at all; pull rows from the real build, never invent them.
- ✅ **Fonts: two lists that must agree.** The `@font-face` sources in `web/assets/css/main.css` and the `<link rel=preload>` list in `web/nuxt.config.ts` describe the same set. They drifted once and shipped a four-day outage. `pnpm --filter ./web check:fonts` enforces it; CI runs it before deploy.
- ✅ Leave `pnpm -r typecheck`, `pnpm -r build`, and `pnpm test` green before handing work back. For `web/` changes that touch rendering, also leave `pnpm --filter ./web check:fonts` green.
