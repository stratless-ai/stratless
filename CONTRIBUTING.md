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

Open a [discussion](https://github.com/stratless-ai/stratless/discussions) before writing code.
Unsolicited feature PRs may be declined on direction alone, kindly: that is a statement about
scope, never about your work.

Every PR to `main` goes through the same gates, mine included:

- CI must be green — `typecheck · test` and `a stranger clones it and it runs` both have to pass
  before the merge button unlocks. They run on every PR, not just ones that touch `cli/`.
- PRs merge as a **squash**, so your branch lands as one commit with your authorship intact.
- `main` takes no direct pushes, no force-pushes, and cannot be deleted.

First PR from a new contributor waits on a maintainer to approve the CI run. That is GitHub's
default for public repos, not a comment on you.

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

Releases are maintainer-only (a tag ritual with its own gates: only an admin can create a `cli-v*`
tag, and once created it can never be moved — the npm provenance signature binds a published
tarball to one exact commit). Contributions are accepted under the MIT license (see
[LICENSE](LICENSE)).

Everyone here is covered by the [Code of Conduct](CODE_OF_CONDUCT.md); report anything that
breaks it to sun@stratless.com.
