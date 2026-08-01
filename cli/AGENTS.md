# cli — agent guide

The published tool (`npm: stratless`). TypeScript, **zero runtime dependencies** (see below), shipped standalone.
Both matter: the "audit the whole thing in an afternoon" trust argument depends on a small, dep-free surface.

Pipeline: a **Record** (parse one tool's raw history) → `moments.ts` (the persisted pile: what you
typed and what the assistant was doing) → `shape.ts` (keep the person's own words, drop the subject) →
`embed.ts` (a fingerprint per moment, local model, free) → `cluster.ts` (k-means, K derived per
person, overlap-merge, and the join loop) → `name.ts` (the one paid stage of a cold build: one call
that names each pile, nothing more — no scope stamp, no merge; those verdicts wobbled and became
arithmetic) → `count.ts` (pure arithmetic over the checkmarks, no model) → `lift.ts` (the
self-retune loop: patches, the dyno, one ledger) → `write.ts` (assemble `HUMAN.md`; each NEW
category is voiced once and cached in `voiced.ts` — a steady-state rebuild spends $0) → a **Load**
(put it where each assistant reads it). `engine.ts` drives it: a cold build freezes the vocabulary
and the centroids, and every run
after joins new moments to those frozen centres, so piles keep their names. Supporting: `assign.ts`
(the assignment store — no model calls left in it), `mirror.ts` (the free, zero-side-effect read),
`worker.ts`/`loop.ts` (the after-session refresh), `profile.ts` (the one artifact), `index.ts` (CLI entry).

**THE SEAM — read this before adding an assistant.** `seam.ts` states what the engine understands
with no idea whose tool produced it (`Turn`, and the three leg contracts). `adapters.ts` is the
compiled-in registry; `brains.ts` is a SEPARATE registry, because a brain is provider-bound rather
than tool-bound and one brain can read any tool's history. Per tool, three files and no engine edits:

| Leg | Claude Code | Codex |
|---|---|---|
| **Record** — its history → `Turn`s | `record-claude-code.ts` | `record-codex.ts` |
| **Rhythm** — the after-session trigger, and protecting the history | `rhythm-claude-code.ts` | `rhythm-codex.ts` |
| **Load** — the profile back into it | `load-claude-code.ts` | `load-codex.ts` |
| *Brain* — the borrowed model (NOT a leg; provider-bound) | `brain-claude-code.ts` | `brain-codex.ts` |

The rule that makes it worth having: adding an assistant costs one new file per leg and **zero** edits
to exchange/moments/shape/embed/cluster/name/count/write/lift. If it ever forces one, the seam has
leaked — fix the boundary, not the symptom.

**The two ways the profile reaches an assistant.** A `load-*` module writes it where a tool already
looks (an import line for Claude Code, an inline copy for Codex, which expands no import syntax).
`mcp.ts` serves it to any tool that speaks MCP, over stdio,
so a new client costs a config line instead of an adapter — the Return leg of the seam, done once.
Read-only, one tool, hand-rolled JSON-RPC (no SDK, the dep-free rule holds). Two rungs because
clients differ, and the split is MEASURED: the connect-time `instructions` field is truncated at
exactly 2048 chars (Claude Code, 2026-07-30), so it carries a short complete hook budgeted under
1024, and the tool carries the profile. Reading a tool's transcripts is a separate, per-tool job
(the Record leg) that MCP does not touch.

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
format or answer honestly, it must SAY SO, never guess.

Which way it fails depends on WHOSE file it is, and the two halves point opposite ways:

**Our own stores fail OPEN.** A damaged cache costs one rebuild, never the pile — the v3 engine made
every artifact cheap to re-derive, so the v1-era `CorruptStoreError` retired along with the $24
caches it protected (`atomic.ts`).

**The person's own files are REFUSED, never clobbered.** Their `settings.json`, their `hooks.json`,
their `CLAUDE.md` hold automation we did not write, and overwriting one we cannot parse destroys it.
Real example (`rhythm-codex.ts`):

```ts
const read = readHooks(path);
if (!read.ok || !read.doc) {
  throw new Error(
    `your ${path} is not valid JSON, and stratless will not overwrite a file it cannot read.\n` +
      `Fix it (or move it aside), then try again.`,
  );
}
```

The same rule shows up as `driftCheck` in each Record: a real archive that reads as zero typed turns
means the format moved, so stratless refuses rather than building a profile of a person it never saw.

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
- 🚫 **No confident guess** when honesty isn't possible — refuse and explain. Our stores fail open; the person's own files are never overwritten unparsed.
- ✅ Node built-ins only (`node:fs`, `node:path`, …) plus the `claude` the user already has.
