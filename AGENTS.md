# stratless — agent guide

Monorepo for **stratless**: a local, private person-layer profiler. It reads your AI coding
assistants' own transcripts (Claude Code and Codex today), breaks each session into moments,
discovers the recurring things you do from your own history, counts them, and writes ONE INTERNAL
EVIDENCE FILE PER HUMAN+AI PAIR (`HUMAN.<assistant>.md`), which `stratless tune` turns into native
skills for that assistant. Nothing is ever measured across assistants — what was observed working with one tool is
never presented to another (the per-record doctrine, 2026-08-03). No server, no API key, nothing
leaves the machine. (Pipeline, per record: `moments → shape → embed → cluster → name → count →
lift → write`.)

This is the **project layer** (this codebase). Don't confuse it with `HUMAN.md`, which is the
product's *output*: a profile of a person.

## Layout

- `cli/` — the tool. TypeScript, **zero** runtime deps (the embedding runtime arrives at `init`'s consent, never via npm — see `cli/AGENTS.md`), published standalone to npm. Per-assistant code sits behind `cli/src/integrations/contracts.ts`; adding one costs a file per leg and no engine edits.
- `runtime/` — `@stratless/runtime`: the embedding runtime (transformers.js + ONNX WASM), pre-bundled by us, fetched once at consent. Zero deps of its own; changes here are versioned rebuild events (see `runtime/AGENTS.md`).
- `assets/` — README artwork and the canonical real sample profile and skill.

## Commands (from the repo root)

```
pnpm install
pnpm -r build       # build every package
pnpm test           # the cli's tests — needs `pnpm -r build` first (tests run compiled dist/)
pnpm -r typecheck
```

## Boundaries

- 🚫 **Never auto-commit.** Stage explicit pathspecs, leave the tree green and uncommitted; a human commits.
- 🚫 **Never add telemetry or central pooling.** Nothing leaves the user's machine, ever.
- ⚠️ **Ask before publishing the CLI or runtime** — both are one-way doors; don't ship an unproven change.
- ✅ **Docs move with the code.** A PR that changes `cli/` behavior updates `cli/README.md` and `cli/CHANGELOG.md` in the same PR. (CI nudges: `.github/workflows/docs-nudge.yml`.)
- ✅ **One sample profile, one source.** `assets/samples/HUMAN.md` is a real build, checked in verbatim. Every README excerpt and `assets/profile-hero.svg` row comes from it in the format `cli/src/pipeline/write.ts` currently emits. Update them together or not at all; never invent rows.
- ✅ **One sample skill, one source — same law.** `assets/samples/skill.md` is a real derived artifact compiled by `cli/src/tune/compile.ts`, checked in byte-identical to the compiler output. Every README and hero excerpt quotes it; update those surfaces together or not at all.
- ✅ Leave `pnpm -r typecheck`, `pnpm -r build`, and `pnpm test` green before handing work back.
