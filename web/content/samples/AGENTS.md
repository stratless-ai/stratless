# stratless — agent guide

Monorepo for **stratless**: a local, private person-layer profiler. It reads your AI coding
assistant's own transcripts, judges each exchange with a borrowed `claude -p` (*did understanding
transfer, about what?*), synthesizes a profile of the person, and loads it into the assistant so it
stops talking over your head or under it. No server, no API key, nothing leaves the machine.

This is the **project layer** (this codebase). Don't confuse it with `HUMAN.md`, which is the
product's *output*: a profile of a person.

## Layout

- `cli/` — the tool. TypeScript, zero runtime deps, published standalone to npm. Has its own `cli/AGENTS.md`.
- `web/` — stratless.com. Nuxt 3, no modules, prerendered to static HTML.

## Commands (from the repo root)

```
pnpm install
pnpm -r build       # build every package
pnpm test           # the cli's tests — needs `pnpm -r build` first (tests run compiled dist/)
pnpm -r typecheck
pnpm dev:web        # run stratless.com locally   (pnpm generate = static build)
```

## Boundaries

- 🚫 **Never auto-commit.** Stage explicit pathspecs, leave the tree green and uncommitted; a human commits.
- 🚫 **Never add telemetry or central pooling.** Nothing leaves the user's machine, ever.
- ⚠️ **Ask before flipping the published cli or the live site** — both are one-way doors; don't ship an unproven change to either.
- ✅ Leave `pnpm -r typecheck`, `pnpm -r build`, and `pnpm test` green before handing work back.
- ✅ End commit messages with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
