# cli — agent guide

The published tool (`npm: stratless`). TypeScript, **zero runtime dependencies** (see below), shipped standalone.
Both matter: the "audit the whole thing in an afternoon" trust argument depends on a small, dep-free surface.

Pipeline: `reader.ts` (parse raw JSONL) → `moments.ts` (the persisted pile: what you typed and
what the assistant was doing) → `shape.ts` (keep the person's own words, drop the subject) →
`embed.ts` (a fingerprint per moment, local model, free) → `cluster.ts` (k-means, K derived per
person, overlap-merge, and the join loop) → `name.ts` (the one paid stage of a cold build: one call
that names each pile, nothing more — no scope stamp, no merge; those verdicts wobbled and became
arithmetic) → `count.ts` (pure arithmetic over the checkmarks, no model) → `lift.ts` (the
self-retune loop: patches, the dyno, one ledger) → `write.ts` (assemble `HUMAN.md`; each NEW
category is voiced once and cached in `voiced.ts` — a steady-state rebuild spends $0) → `load.ts`
(put it where the assistant reads it). `engine.ts` drives it: a cold build freezes the vocabulary
and the centroids, and every run
after joins new moments to those frozen centres, so piles keep their names. Supporting: `assign.ts`
(the assignment store — no model calls left in it), `claude.ts` (the borrow), `mirror.ts` (the free,
zero-side-effect read), `worker.ts`/`loop.ts` (the after-session refresh), `init.ts` (protect history
+ install the Stop hook), `index.ts` (CLI entry).

## Commands (from `cli/`)

```
npm run typecheck    # tsc --noEmit
npm run build        # tsc → dist/    ← REQUIRED before test (tests run compiled dist/)
npm test             # node --test dist/*.test.js
```

Uses **npm**, not pnpm: the cli publishes standalone, and CI builds it from a clean `npm install`
exactly like a stranger would.

## Code style — refuse, don't lie

The one failure that would end this product is a confident wrong answer. If the tool can't read a
format or answer honestly, it must SAY SO, never guess. Real example (`atomic.ts`):

```ts
// A store that exists but cannot be parsed is a refusal, never "empty" — reading the paid-for
// judgment cache as empty would silently re-bill the person's whole history.
export class CorruptStoreError extends Error {
  constructor(public readonly file: string) {
    super(`${file} is damaged (not the JSON stratless wrote)`);
    this.name = 'CorruptStoreError';
  }
}
```

## Boundaries

- 🚫 **ZERO runtime dependencies — and the embedding engine is NOT one (0.6.0, the consent-arrival
  rule).** The local model is what keeps a cold build at **~$0.25** (measured 2026-07-27, 5,784
  moments) — the grouping is arithmetic on the user's own machine, so the only paid call left is the
  one that names what the arithmetic found. But its runtime does not ride in `dependencies`
  (declaring it made `npx stratless` cost strangers 116MB): it arrives ONCE, at `init`, after the
  person's yes — `@stratless/runtime` (~3MB, our own pre-bundled WASM, see `runtime/AGENTS.md`) plus
  the weights (~34MB), into `~/.stratless/`, pinned by exact version + hashes in `src/fetch.ts`.
  WASM is the canonical runtime, **standard over speed**: identical bits on every machine, and any
  runtime or model change is a versioned, announced rebuild (the `pipeline` stamp in `engine.ts`),
  never silent drift. `npx stratless` runs `mirror`, which needs no model at all, and must stay
  instant. Dev-only deps (`@types/node`, `tsx`, `typescript`) remain fine; anything in
  `dependencies` breaks the audit-in-an-afternoon promise — and now also the consent story.
- 🚫 **No confident guess** when honesty isn't possible — refuse and explain (see `atomic.ts`'s `CorruptStoreError`).
- ✅ Node built-ins only (`node:fs`, `node:path`, …) plus the `claude` the user already has.
