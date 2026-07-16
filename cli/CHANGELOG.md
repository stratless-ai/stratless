# Changelog

All notable changes to `stratless` are recorded here — written by hand, for the person installing it,
not scraped from commits. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and each version matches its `cli-v*` git tag.

## [0.3.0] — 2026-07-17

The learning release. Until now the profile was re-derived from raw judgment lines on every build
and the derivation thrown away; nothing accumulated. 0.3.0 makes the derivation a persistent,
auditable artifact — the profile stops being an impression and becomes a derivation from evidence.

### Added
- **The miner.** A new pass turns your judgments into `~/.stratless/patterns.json`: named
  regularities, each carrying a real count, a time window, a trend (rising/steady/fading), a
  stability class, and — the part that matters — **receipts**: the exchange hashes that witnessed
  it. Every claim traces to replies that could have gone the other way; no receipt, no claim. The
  split is strict: **the model names, the code counts** — counts, dates and trends are computed
  deterministically and the model is never shown a number it could hallucinate. Categories emerge
  from your data (a pattern needs 5+ receipts to exist; anecdotes stay candidates); they sort into
  six fixed kinds — what you know · how you think · how you work · direction · failure signals ·
  triggers — and anything that fits none is kept `unsorted`, never forced.
- **`stratless patterns`** — every claim with its count, trend, audit tally, and receipt trail.
  Your profile's evidence, inspectable. Free; add `--all` for candidates below the evidence bar.
- **The auditor.** A separate mind — never the one that wrote a statement — re-checks every newly
  assigned receipt against its pattern ("does this judgment actually SATISFY the statement?").
  Evicted evidence is removed by code and admission is re-decided by arithmetic. Audited once,
  ever, per receipt.
- **The numbers-lint.** Every numeral in a built profile must already exist in the evidence the
  writer was shown. An invented or rounded frequency is a **refused build** — the old profile stays
  loaded, nothing lies. A wrong frequency is a lie wearing precision; now it's a build failure.
- **Dynamic aperture.** The judge's view of each exchange is sized from *your own* history (p90 of
  your real lengths × 1.2, clamped), reading head + tail of long turns — the plan and the
  conclusion — instead of a fixed head-cut sized on the author's machine. Recorded in
  `state.json`, visible.

### Changed
- **Judgments are structured (v2).** Verdict / topic / behavior fields, JSON output validated in
  code (malformed = refused, never guessed). The pipeline version now lives in the cache key, so
  this release re-judges your window **gradually, under the normal per-run budget** — an upgrade
  never re-spends your backlog at once.
- **The profile is written FROM the patterns** — audited claims with real numbers, plus a small
  recent sample for freshness. The writer's input stays the same size whether you have 200
  judgments or 20,000: the learning architecture is the cost-control architecture.
- **The parse cap rose 4,000 → 8,000 chars per field** (inside the v2 re-judge, so the identity
  churn was free). Long assistant turns keep more of their real tail.

## [0.2.4] — 2026-07-16

### Changed
- **`update` now rebuilds the profile only when it's due — the cost release.** The synthesis is the
  expensive read (~32 judge calls' worth, measured on real usage); it used to run after every
  session, even for a handful of new exchanges. Sessions now accumulate: the profile rebuilds after
  **25 new judgments** (`STRATLESS_SYNTH_EVERY` overrides), when it's over a week stale and anything
  new arrived, when no profile exists yet, or on **`stratless update --now`**. A skipped rebuild
  still judges what's new and still guarantees the profile stays loaded — the skip is invisible,
  only the cost is missing.
- **The profile is written by Sonnet, pinned — same deliberate read, ~4–6x cheaper.** Synthesis used
  to ride whatever your default model is; a frontier default spent ~$0.62 API-equivalent per rebuild
  (thinking billed at frontier rates), which was ~80% of everything stratless spent. Sonnet thinks
  just as hard about who you are for ~$0.10–0.15. `STRATLESS_SYNTH_MODEL` brings your default back
  if you want it.
- **The judge now reads the END of a long assistant turn — the part you actually reacted to.** Long
  turns were cut from the head, so the judge read the opening preamble and then your reaction to a
  conclusion it never saw. Measured on real history: 83% of turns were longer than the judge's view.
  Already-judged exchanges are not re-read; only the truncated ones re-judge, gradually, in the
  background budget.
- **Reactions that carry no signal (`none` — logistics, a thank-you) no longer reach the writer.**
  They stay cached like everything else; they just stop diluting the profile.
- **`profile` now says where the load stands.** The split is deliberate — `profile` and `report`
  *look*, `update` *loads* — but `profile` used to end in silence, leaving the impression the
  printed profile was live. It now closes with the honest state: `not loaded yet — load it into
  your assistant: stratless update`, or the loaded path and how to refresh it.
- **Every printed next-step now works in your shell.** Run stratless via `npx` and the hints say
  `npx stratless profile`; run it installed and they stay bare. (Following `npx stratless init`
  with the suggested `stratless profile` used to hit `command not found`.)
- **`stop` points back the right way.** Its parting hint now names what actually reverses it
  (`stratless update` to reload, `stratless init --auto` for background refresh) — plain `init`
  no longer arms the refresh since 0.2.3, and `status` said the same stale thing.

### Fixed
- **The usage meter no longer under-reports by ~2,000x.** It recorded only plain input tokens and
  dropped the cache tokens where the real consumption lives (~17–24k tokens of Claude Code harness
  overhead per borrowed call) — the ledger showed 484 input tokens where reality was over a million.
  `status` now reports real tokens first (a subscription spends quota, not dollars), the
  API-equivalent cost clearly labelled, and the judging / profile-build split. Existing tallies
  survive the upgrade untouched.
- **A hand-edited `~/.claude/settings.json` no longer crashes `init`.** Malformed JSON (the classic
  trailing comma) used to become a raw stack trace — and could not be distinguished from a file worth
  overwriting. `init` now refuses with a clear message and touches nothing; `stop` treats it as
  "nothing to remove".
- **`init --auto` warns when the background refresh can't actually run** — the hook calls the bare
  `stratless`, which an npx-only install doesn't put on your PATH. It now says so and names the fix
  instead of failing silently every session.
- The "report this" links printed when stratless refuses on format drift pointed at the repo's old
  name and led to a 404. They point at the real repository now.

## [0.2.3] — 2026-07-16

### Fixed
- **`profile` / `report` / `update` no longer load your whole history into memory.** They read only the
  recent window (newest transcripts first, then stop), so a large archive can no longer exhaust memory
  and hang the machine. Previously the load read and parsed *every* transcript before keeping the last
  200 — the 0.2.1 "bounded cold start" bounded only the judging, not the load. Measured on an 833 MB /
  2,292-file archive: ~165 MB and under half a second, versus the old path's out-of-memory hang.

### Changed
- **The after-session auto-refresh is now opt-in.** Plain `stratless init` sets up the archive and the
  reaper but installs *no* background hook; run `stratless init --auto` to have your profile rebuild
  itself after each session. `stratless stop` still turns it off. A tool that reads your history should
  not silently arm a background job on every session without you choosing it.

## [0.2.2] — 2026-07-16

### Added
- **`stratless status`** — stratless's own state at a glance: whether the after-session refresh is on,
  whether your profile is loaded, how many exchanges have been judged, when it last refreshed, and the
  running total it has spent on your borrowed `claude`. It reads locally and spends nothing. (`stats`
  still counts your *assistant's* activity in a project; `status` is about stratless itself.)

### Changed
- **The generated profile is now em-dash-free at the source** — the synthesis prompt avoids em and en
  dashes, and a deterministic pass strips any that slip through, so HUMAN.md stops carrying the one
  punctuation mark that reads as machine-written.

### Fixed
- Housekeeping: bumped `pnpm/action-setup` off its deprecated Node 20 runner in CI, and removed a stale
  workflow comment and a couple of stray files.

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
