# Changelog

All notable changes to `stratless` are recorded here — written by hand, for the person installing it,
not scraped from commits. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and each version matches its `cli-v*` git tag.

## [0.3.4] — 2026-07-17 — the plumbing: what the cold-start build stands on

Phase 1 of the cold-start build (spec §12). No new features — the release is eight acceptance
criteria passing, three of them bugs the Phase 0 measurement sitting caught in the shipped CLI.

### Fixed
- **"MOST RECENT" meant oldest.** Since 0.3.1, the writer's most-recent evidence block received
  the OLDEST 25 judgments of a newest-first list — every pattern-era profile had its
  current-direction evidence backwards. Now selected by timestamp, newest first, regardless of
  caller order, with a test that pins the ordering (C10).
- **The meter's blind spot is closed.** A call that degraded to the plain-text fallback used to be
  recorded at zero cost, and a call that lost its model pin silently ran on your account's default
  model at frontier rates. Both are now counted — `status` shows `fallback calls: N unmetered · M
  ran on your default model` the moment either exists, and the ledger records which model actually
  ran (C11).
- **The borrow is tool-less.** Every borrowed `claude` call — judge, mine, audit, grade, write —
  now runs with `--tools ""`. The borrowed model sometimes took the writer prompt literally,
  attempted a real file write, and returned permission chatter instead of your profile; it no
  longer has hands (C9).
- **A failed call's error message can no longer be mistaken for an answer.** A broken model pin
  exits 0 with an error envelope whose prose ("There's an issue with the selected model…") the
  judge would have cached as a verdict and the writer would have reasoned from. The envelope's
  `is_error` flag is now honored: the call is refused and the ladder advances to the next metered
  rung instead. (Found by this release's own review pass, verified against the live CLI.)

### Changed
- **Every store is written atomically** (temp + rename): judgments, patterns, state, usage,
  renders, settings, HUMAN.md, CLAUDE.md. A crash mid-write leaves the old file or the new one,
  never a torn one (C2). Writes follow symlinks and preserve the file's mode — a dotfiles-repo
  link to your CLAUDE.md or settings.json survives, and your chmod stays yours.
- **A damaged spend-cache refuses loudly instead of re-billing you.** A corrupt judgments.json or
  patterns.json used to read as "empty" — which would silently re-spend your entire history on the
  next run. Now every spending command refuses with the file's path and how to move it aside, and
  `status` labels the cache unreadable instead of showing 0 (C2).
- **One spender at a time.** `update`, and a building `profile`/`report`, take a lock; the
  after-session hook and a hand-run update can no longer race each other's writes over the
  judgment cache. A second runner says `another stratless run is active` and exits clean; stale
  locks from crashes are detected (with PID-reuse protection) and stolen (C4).
- **Rate limits bend the run, they don't break it.** A streamed batch that hits a 429/overload now
  backs off exponentially and retries the remaining items in a fresh session, bounded, losing
  nothing — a rate-limit storm costs minutes, not evidence (C6).

### Added
- **The stopwatch.** Per-turn, per-stage, per-run wall-clock recorded in `state.json` on every
  spend — so the cold-start door (0.4.0) can quote minutes measured on YOUR machine, never typed.
  Includes a pure ETA that refuses to estimate any stage it hasn't measured (C8).
- **The detached-spawn primitive** the Phase 2 worker will stand on: spawn a process that survives
  its parent, with the absolute path to your `claude` captured at spawn time (C5). Unused by any
  command yet — built and tested ahead of the worker.

## [0.3.3] — 2026-07-17 — looking is free, evidence is readable, and the tool talks properly through a pipe

### Changed
- **Looking is free.** `stratless profile` and `stratless report` now print the last built
  rendering instantly, at zero spend, under a header carrying the build's own date and numbers.
  Only `update` — and an explicit `--now`, or a first-ever look — spends. One word keeps one
  meaning: `--now` = spend now, skip nothing.
- **The bill is announced, never discovered.** Before any run makes a fresh read, it says so
  first: `about to read 37 new exchanges on your own claude (each read once, cached forever)`.
- **Clean pipes.** Output through a pipe, with `NO_COLOR` set (and non-empty, per the spec), or
  under `TERM=dumb` carries zero escape codes — bold and dim stripped too, stricter than the
  NO_COLOR spec on purpose. `stratless status | grep loaded` finally behaves.
- `-h` now works alongside `--help` and `help`; the help screen leads with the getting-started
  line and ends with the docs link; `report` closes by pointing at its evidence.

### Added
- **`stratless receipt <n>` — prove any claim.** `patterns` now numbers every claim and each one
  says `prove it: stratless receipt 3`. The receipt command dereferences a claim back to the raw
  exchanges behind it — what you asked, what it said, how you reacted — re-read from your own
  transcripts (archive first). Hash prefixes work git-style. Free; zero model calls. And when a
  receipt points at a transcript the 30-day cleanup deleted before your archive existed, it says
  exactly that: the honest failure is the `init` lesson.
- **A version check you consented to, and nothing ambient.** `stratless status --check` asks npm
  for the latest version — user-initiated, on-screen, for everyone; plain `status` stays fully
  offline. `--auto` users (who explicitly armed background activity) get a cached once-daily check
  riding the background refresh, disclosed at arming time. Plain-`init` users make zero registry
  calls, ever — and the test suite proves the unarmed path can't reach the network. The privacy
  page now tells this tiered truth in full.

## [0.3.2] — 2026-07-17

The self-correction release. Until now the profile asserted its confidence; from here it earns it.

### Added
- **The grader.** Every pattern is a dated prediction ("this will keep happening"), and each
  rebuild now grades it against the window's new evidence: **confirmed** (new receipts landed),
  **silent** (the topic never came up — never counted against a claim), or **surprised** (evidence
  shows the opposite; the mistake carries its own receipts). A separate mind on Sonnet, streamed;
  strict rules ("absence of the behavior is NOT the opposite of the behavior") tuned in three
  controlled A/Bs on identical evidence.
- **Balanced revision.** One surprise costs confidence, never standing; a second inside two weeks
  flags the statement back to the miner: revise it to fit ALL the evidence, or retire it (retired
  claims release their evidence for future patterns; revised ones re-earn their audit from zero).
  Validated on a real month-apart backtest: June-mined claims graded against July caught exactly
  what they should — statements that overreached ("always X") meeting the fuller truth.
- **The report tells you when the file was wrong.** New surprises appear in `stratless report` as
  honest updates, scaled to their weight — a first counter-example gets a clause, a claim under
  revision gets the story. HUMAN.md itself stays clean: the AI reads current truth, you read the
  diary.

### Changed
- **HUMAN.md speaks only in facts about you.** Pipeline bookkeeping (audit tallies, trend labels,
  confidence classes) no longer appears in the profile — the writer uses it to weigh what to say
  and how firmly, and says it in calibrated language instead. Real frequencies of your own behavior
  stay when they carry meaning.

### Fixed
- Audit tallies were silently resetting on every mine (pattern ledgers now survive re-aggregation).
- An async pipe error in the streaming layer could kill a whole run mid-batch (found by the
  backtest; completed turns now always survive and the remainder falls back).

## [0.3.1] — 2026-07-17

The streaming release. 0.3.0's dogfood measured where the money actually goes: every judge and
audit call re-booted the whole Claude Code harness — ~30k tokens and ~10 seconds of startup for a
one-line question, 99% luggage. 0.3.1 pays the toll once.

### Changed
- **Judging and auditing now stream through ONE `claude` process per batch.** The instructions ride
  the session's system prompt (sent once, cached); each judgment or audit is a turn. Measured in
  prototype: ~3.2x cheaper per verdict and no per-call boot; sessions rotate every 25 turns to
  bound context growth. The old per-call path remains as the automatic fallback (older CLIs,
  mid-batch failures) — the ladder is stream → per-call → silence, and a failed turn is skipped,
  never guessed. Streamed prompts carry a `<stratless-…>` sentinel so the pipeline can never parse
  its own sessions as your conversation.
- **The profile is SECTIONED** — the six kinds as fixed headings (WHAT THEY KNOW · HOW THEY THINK ·
  HOW THEY WORK · DIRECTION · FAILURE SIGNALS · TRIGGERS), only sections with evidence appear,
  under 350 words, with a `humanmd/v1` schema marker in the file. HUMAN.md starts looking like the
  protocol it is becoming.
- **Time is narrated.** The trend and window every pattern carries now reach the prose: "has held
  for two months, lean on it", "faded through July: who they were". And the miner now sees each
  judgment's local time tag (computed by code, never raw timestamps), so time-conditioned patterns
  ("terser in the morning") can finally emerge.
- **`report` joins the pattern era** — the human's mirror is now reasoned from the audited
  patterns and centers the trajectory: what stopped, what holds, what's new. It also gains the
  numbers-lint: both renderings now refuse to deliver an invented number.

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
