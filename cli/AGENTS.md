# cli — agent guide

The published tool (`npm: stratless`). TypeScript, **one runtime dependency** (see below), shipped standalone.
Both matter: the "audit the whole thing in an afternoon" trust argument depends on a small, dep-free surface.

Pipeline: `transcript.ts` (parse raw JSONL) → `exchange.ts` (→ AI-turn / human-reaction pairs) →
`judge.ts` (borrowed `claude -p`, cached, read-once) → `synthesize.ts` (→ the profile) → `sink.ts`
(load it). Supporting: `claude.ts` (the borrow), `init.ts` (protect history + install the Stop hook),
`canary.ts` (refuse on format drift), `index.ts` (CLI entry).

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
format or answer honestly, it must SAY SO, never guess. Real example (`canary.ts`):

```ts
// We can see a write tool in the log but parsed zero edits → the format moved under us.
if (knownWrites > 0 && edits.length === 0) {
  return { ok: false, reason: 'The log format has changed. stratless will NOT guess.' /* …+ how to report */ };
}
```

## Boundaries

- ⚠️ **ONE runtime dependency, and the bar for a second is very high.** `@xenova/transformers` carries
  the local embedding model, and it is what makes a cold build **$0.25 instead of $13.27** (measured 2026-07-26, 5,647 moments) — it
  replaced ~190,000 model calls with arithmetic on the user's own machine (2026-07-26). It **breaks**
  "zero runtime dependency"; it **keeps** "nothing leaves", since the model runs locally and only the
  weights ever arrive. Pinned to its **WASM backend** in `embed.ts` — no native binary, so it cannot
  fail-to-install the way native deps do. The weights are **not bundled**: `npx stratless` runs
  `mirror`, which needs no model at all, and must stay instant. Dev-only deps (`@types/node`, `tsx`,
  `typescript`) remain fine; anything else in `dependencies` still breaks the audit-in-an-afternoon
  promise.
- 🚫 **No confident guess** when honesty isn't possible — refuse and explain (see `canary.ts`).
- ✅ Node built-ins only (`node:fs`, `node:path`, …) plus the `claude` the user already has.
