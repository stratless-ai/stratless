# cli — agent guide

The published tool (`npm: stratless`). TypeScript, **one runtime dependency** (see below), shipped standalone.
Both matter: the "audit the whole thing in an afternoon" trust argument depends on a small, dep-free surface.

Pipeline: `transcript.ts` (parse raw JSONL) → `moments.ts` (the persisted pile: what you typed and
what the assistant was doing) → `shape.ts` (keep the person's own words, drop the subject) →
`embed.ts` (a fingerprint per moment, local model, free) → `cluster.ts` (k-means, K derived per
person, overlap-merge, and the join loop) → `name.ts` (**the only stage that spends**: one call that
names each pile, nothing more — no scope stamp, no merge; those verdicts wobbled and became
arithmetic) → `count.ts` (pure arithmetic over the checkmarks, no model) →
`write.ts` (assemble `HUMAN.md` from the scored pile) → `sink.ts` (load it where the assistant reads
it). `engine.ts` drives it: a cold build freezes the vocabulary and the centroids, and every run
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

- ⚠️ **ONE runtime dependency, and the bar for a second is very high.** `@xenova/transformers` carries
  the local embedding model, and it is what keeps a cold build at **$0.25** (measured 2026-07-26,
  5,647 moments) — the grouping is arithmetic on the user's own machine, so the only paid call left
  is the one that names what the arithmetic found. It **breaks**
  "zero runtime dependency"; it **keeps** "nothing leaves", since the model runs locally and only the
  weights ever arrive. Pinned to its **WASM backend** in `embed.ts` — no native binary, so it cannot
  fail-to-install the way native deps do. The weights are **not bundled**: `npx stratless` runs
  `mirror`, which needs no model at all, and must stay instant. Dev-only deps (`@types/node`, `tsx`,
  `typescript`) remain fine; anything else in `dependencies` still breaks the audit-in-an-afternoon
  promise.
- 🚫 **No confident guess** when honesty isn't possible — refuse and explain (see `atomic.ts`'s `CorruptStoreError`).
- ✅ Node built-ins only (`node:fs`, `node:path`, …) plus the `claude` the user already has.
