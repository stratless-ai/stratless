# Changelog

All notable changes to `stratless` are recorded here — written by hand, for the person installing it,
not scraped from commits. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and each version matches its `cli-v*` git tag.

## [Unreleased]

## [0.2.1] — 2026-07-15

### Added
- **`stratless --version`** (and `-v`) — print the installed version.

### Changed
- **Bounded cold start.** The profile is now built from a recent window (the newest ~200 exchanges)
  rather than the whole backlog — it converges there anyway. This keeps every run and every
  after-session refresh fast and safe no matter how deep your history goes; the first profile costs the
  same whether you have 100 exchanges or 100,000. (Previously, a full pass over a large backlog could
  stall or crash the machine.)

### Removed
- **`--backfill`.** The unbounded "judge everything now" flag was the thing that could spawn thousands
  of `claude` calls back-to-back and take a laptop down. The bounded window replaces it — it drains a
  little each run and through the after-session hook.

## [0.2.0] — 2026-07-15

The pivot. stratless became a **person-layer profiler**: it reads your coding assistant's own
transcripts, judges whether understanding transferred in each exchange, builds a model of *you*, and
loads it into your assistant so it stops talking over your head — or under it.

### Added
- The profiler pipeline: read transcripts → judge each exchange (a borrowed `claude -p`, cached forever)
  → synthesize a profile → load it.
- `stratless profile` and `stratless report` — the AI's copy of the profile, and yours.
- `stratless update` — re-read what's new, rebuild the profile, and load it.
- `stratless stop` — a true off-switch: removes the after-session refresh **and** unloads the profile
  from CLAUDE.md, while keeping your HUMAN.md.
- **HUMAN.md** as the canonical artifact (`~/.claude/HUMAN.md`), with CLAUDE.md carrying a one-line
  `@import` redirect — one profile, many tools.
- An optional after-session refresh: a background rebuild when a Claude Code session ends.

### Changed
- **Recency-weighted synthesis** — the profile reflects your *current* direction, not the historical
  average. (It had been confidently describing a product already pivoted away from.)

### Removed
- `stratless why` — the old point-at-a-line command, and its git-blame engine.

## [0.1.0] — 2026-07-14

The first, wrong product: a **code-provenance tool**. `stratless why <file>:<line>` pointed at a line
and returned the decision that made it. Superseded entirely by the 0.2.0 profiler pivot — kept here for
honest history.
