# cli — agent guide

The published tool (`npm: stratless`). TypeScript, **zero runtime dependencies**, shipped standalone.
Both matter: the "audit the whole thing in an afternoon" trust argument depends on a small, dep-free surface.

Pipeline: `transcript.ts` (parse raw JSONL) → `moments.ts` (the persisted pile: what you typed and
what the assistant was doing) → `discover.ts` (mint the categories from the person's own logs) →
`assign.ts` (score each moment against them; the one stage that spends) → `count.ts` (pure arithmetic
over the checkmarks, no model) → `write.ts` (assemble `HUMAN.md` from the scored pile) → `sink.ts`
(load it where the assistant reads it). Supporting: `claude.ts` (the borrow), `mirror.ts` (the free,
zero-side-effect read), `worker.ts`/`loop.ts` (the after-session refresh), `init.ts` (protect history
+ install the Stop hook), `canary.ts` (refuse on format drift), `index.ts` (CLI entry).

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

- 🚫 **No runtime dependency.** Dev-only deps (`@types/node`, `tsx`, `typescript`) are fine; anything in
  `dependencies` breaks the audit-in-an-afternoon promise.
- 🚫 **No confident guess** when honesty isn't possible — refuse and explain (see `canary.ts`).
- ✅ Node built-ins only (`node:fs`, `node:path`, …) plus the `claude` the user already has.
