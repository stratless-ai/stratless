# Contributing to stratless

stratless builds your AI a living model of who you are, locally, from your own history. It is
pre-1.0 and its direction is deliberate: scope is actively managed, and the roadmap is driven by
design work that often lives outside this repo.

The short version: **bug reports are very welcome; features start as discussions, not PRs.**

## Bugs

A precise bug report is the fastest way to help. Open an issue using the bug report template:
https://github.com/stratless-ai/stratless/issues. Include your OS, your Node version, and the
exact command you ran. Never paste transcript contents you would not want public.

Suspected security issues are different: see [SECURITY.md](SECURITY.md) and report privately,
not as an issue.

## Features and pull requests

Open an issue to discuss before writing code. Unsolicited feature PRs may be declined on
direction alone, kindly: that is a statement about scope, never about your work.

## Development

This is a pnpm workspace: `cli/` is the npm package, `web/` is stratless.com.

From the repo root (pnpm):

```sh
pnpm install
pnpm -r build      # tests run the compiled dist/, so build first
pnpm test
pnpm -r typecheck
```

The CLI standalone (npm, on purpose: CI builds it exactly like a stranger installing from npm):

```sh
cd cli
npm install
npm run build
npm test
```

## House rules

The full conventions live in [AGENTS.md](AGENTS.md) and [cli/AGENTS.md](cli/AGENTS.md). The two
every contributor must know:

1. **`cli/` stays dependency-free.** Zero runtime dependencies, permanently. A PR that adds one
   is declined on arrival; the whole tool must stay auditable in an afternoon.
2. **Docs move with code.** A PR that changes CLI behavior updates `cli/CHANGELOG.md`,
   `cli/README.md`, and `web/content/docs/` in the same PR. CI will nudge you if you forget.

Releases are maintainer-only (a tag ritual with its own gates). Contributions are accepted under
the MIT license (see [LICENSE](LICENSE)).
