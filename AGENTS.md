# AGENTS.md — working on stratless

Project context for any AI agent working **on stratless itself**. (This is the *project* layer — about
this codebase. It is not the stratless product's own `HUMAN.md`, which is about a *person*.)

## What stratless is

A local, forensic **person-layer profiler**: it reads your AI coding assistant's own conversation
transcripts, judges each exchange with a borrowed `claude -p` (*did understanding transfer, about
what?*), synthesizes a **profile of the person**, and loads it into the assistant so it stops talking
over your head or under it. No server, no API key, nothing leaves the machine.

(`stratless@0.1.0` was a different, *wrong* product — a code-provenance tool, `stratless why`. That has
been killed. The full pivot story is in `docs/`.)

## Layout

- `cli/` — the tool. TypeScript, **zero runtime dependencies** (published standalone to npm). Source in
  `cli/src/`; the pipeline is `exchange.ts` (transcript → `(AI turn → human reaction)` pairs) →
  `judge.ts` (cached, read-once-ever) → `synthesize.ts` (→ profile / report) → `sink.ts` (the load).
  `claude.ts` is the borrow; `init.ts` protects history + installs the after-session Stop hook;
  `canary.ts` refuses on format drift.
- `web/` — stratless.com. Nuxt 3, no modules, prerendered static HTML.
- `docs/` — the design + handover set. Read these before any large change.

## Build & test (in `cli/`)

```
cd cli
npm run typecheck
npm run build
npm test
```

Keep all three green before handing work back.

## Discipline (non-negotiable)

- **Never auto-commit.** Stage explicit pathspecs; leave the tree green + uncommitted; **Sun commits.**
- `cli/` **stays dependency-free** — it's published standalone, and the "read the whole thing in an
  afternoon" trust argument depends on it.
- **Refuse, don't lie.** If the tool can't read a format or answer honestly, it must *say so* — never
  emit a confident guess (see `canary.ts`).
- **Nothing leaves the machine** — no telemetry, no central pooling, ever.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- The **published CLI** and the **live site** are the one-way door — never flip them for an unproven product.

## Read first (in `docs/`)

- `official-handover.md` — the master brief. Start at its **Current state** block.
- `presentation.md` — the story: **Problem · Framework (The Person Layer / `HUMAN.md`) · Outcome**.
- `build-pass-learning-profiler.md` — the 0.2.0 build, the learning design, the adapter seam.
- `adapter-seam-spec.md` · `adapter-triage.md` · `token-economics.md` — the seam, the per-tool triage,
  the cost model.

## Current state

Branch `profiler-0.2.0`. The 0.2.0 loop is done: `init` / `profile` / `report` / `update` / `stop`.
`why` is killed. Recency-weighting for the direction layer is being fixed (a dogfooding finding); after
that comes Phase 2 (the learning passes) and the held HUMAN.md-canonical Sink.
