# AGENTS.md — working on stratless

Project context for any AI agent working **on stratless itself**. This is the *project* layer — about this codebase. Its counterpart is `HUMAN.md`, which is about a *person*.

## What stratless is

A local, forensic **person-layer profiler**: it reads your AI coding assistant's own conversation transcripts, judges each exchange (*did understanding transfer, about what?*), synthesizes a **profile of the person**, and loads it into the assistant so it stops talking over your head or under it. No server, no API key, nothing leaves the machine.

## Layout

- `cli/` — the tool. TypeScript, **zero runtime dependencies** (published standalone to npm).
- `web/` — stratless.com. Nuxt 3, no modules, prerendered static HTML.
- `docs/` — the design + handover set. Read these before any large change.

## Discipline (non-negotiable)

- **Never auto-commit.** Stage explicit pathspecs; leave the tree green and uncommitted.
- `cli/` **stays dependency-free** — the "read the whole thing in an afternoon" trust argument depends on it.
- **Refuse, don't lie.** If the tool can't read a format or answer honestly, it must *say so* — never emit a confident guess.
- **Nothing leaves the machine** — no telemetry, no central pooling, ever.
