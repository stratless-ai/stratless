# Changelog

All notable changes to `stratless` are recorded here — written by hand, for the person installing it,
not scraped from commits. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and each version matches its `cli-v*` git tag.

## [Unreleased]

## [0.8.1] · 2026-08-01 · the same history, wherever it lives

A profile should describe you, and nothing else. This one quietly described your filesystem too.

### Fixed
- **Your profile depended on your files' timestamps, not just on your history.** 0.8.0 fixed half of
  this: transcripts are now read in one total order on every filesystem. But the order they were read
  in still decided the order of the pile, and the clustering step picks its starting points by
  position — so anything that changed a file's modification date without changing a single byte
  rebuilt you into different patterns with different counts. Restoring a backup did it. Copying
  `~/.claude` to a new laptop did it. `rsync` without `-t` did it. Measured on identical transcripts:
  the same eight conversations split 32/128 one way and 56/104 the other, with a whole section of the
  profile present in one and absent in the other. The pile is now ordered by each moment's own
  timestamp and content, so the same history produces the same profile on any machine, after any copy
  or restore. Your next rebuild may shift some counts once as the true order takes effect; after that
  it stops moving for reasons that are not you.

## [0.8.0] · 2026-07-31 · the profile leaves home

Your profile stops living inside one assistant's directory, and starts being served to any
assistant that asks. Two halves of the same claim: **the file is yours, not a tool's** — so it
moves out of `~/.claude` into your own directory, and `stratless mcp` hands it to anything that
speaks the Model Context Protocol, without stratless knowing the first thing about that tool's
files. Reaching a new assistant used to mean writing an adapter for it. Now it's a config line.

### Fixed
- **Two machines reading the same history could build different profiles.** Transcripts were ordered
  by modification time alone, which leaves sessions written in the same millisecond tied — and a tied
  sort falls back to whatever order the filesystem happened to return. Since the clustering step picks
  its starting points by position, that reordering could split the same history into different
  patterns with different counts. Reading now has one total order on every filesystem. Nobody would
  have noticed this as a bug; it would have shown up as a profile that quietly disagreed with itself
  between machines.

### Changed
- **Your profile moved to `~/.stratless/HUMAN.md`, and it moves itself.** It used to live at
  `~/.claude/HUMAN.md` — inside one assistant's directory, from the days when there was only one.
  Two things were wrong with that. Uninstalling Claude Code took your profile with it, though the
  profile is yours and describes you, not that tool. And plenty of people keep `~/.claude` in a
  dotfiles repo to sync settings between machines, which put a behavioural read of how you work one
  `git add -A` away from being published. It now sits with everything else stratless makes, in a
  directory nobody syncs. You do nothing: the next stratless command moves the file and re-aims the
  one-line import in your `CLAUDE.md` at its new home, once, silently. If you turned the profile off
  with `stratless stop`, it stays off — the move never re-loads what you unloaded. A file we cannot
  prove we wrote is never touched, and a profile you deliberately redirected with
  `STRATLESS_HUMAN_MD` is left exactly where you pointed it.

### Added
- **`stratless mcp` — your profile, in any assistant that speaks MCP.** Reaching a new tool used to
  mean teaching stratless where that tool keeps its context file and how it wants it written. This
  goes around that entirely: one local server speaking the Model Context Protocol over stdio, and any
  client that speaks it reads your profile with stratless knowing nothing about its files. Point a
  client at `{"command": "stratless", "args": ["mcp"]}` once. It serves the profile two ways, because
  clients differ: a short note at connect time asking the assistant to read your profile before doing
  real work, and one read-only tool that returns the profile itself. The note stays short on purpose —
  that channel is truncated (measured at exactly 2048 characters in one client), and half an
  instruction is a wrong instruction, so the note says what to *call* and the tool carries what to
  *know*. It reads `HUMAN.md` when asked, so a rebuild reaches every connected client at once. One
  tool, read-only, no writes of any kind: your profile is derived by arithmetic from your own history,
  so there is nothing for an assistant to edit. No profile yet means it says so and tells the
  assistant to treat you as unknown rather than guess. Local, over a pipe, no network, and idle until
  a client starts it.
- **The free read now sees your fleet.** Two rows join `stratless mirror`, both computed on the same
  local pass, both absent unless they apply to you: `work it handed off` counts the times your
  assistant gave part of a job to another agent instead of doing it itself and names the kinds it
  used most, and `skills it loaded` counts the packaged procedures it pulled in. Neither is inferred
  — the agent type comes from the spawn's own record, the skill from the load's own — and a spawn or
  load that named nothing is still counted rather than given a label we invented. Both stay in your
  terminal and never reach the `--share` card, because an agent type or a skill name can be bespoke.
  `skills it loaded` is deliberately phrased from the assistant's side: a skill enters the record the
  same way whether you typed its name or your assistant chose it, so the row never claims the reach
  was yours.

## [0.7.1] · 2026-07-30 · the file says who wrote it

### Changed
- HUMAN.md's managed header now names the stratless version that wrote it — `# (managed by
  stratless 0.7.1: …)` — read from the package at write time, never typed. When a profile ever
  looks wrong, the file itself now answers the first question: which version made this?
- The machine marker says what it is: `<!-- format: humanmd/v3 -->` (was the bare
  `<!-- humanmd/v3 -->`). Same contract for adapters, now readable by the person whose file it is.

### Removed
- The dormant streaming batch harness (`stream.ts`, built 0.3.1). It kept one borrowed `claude`
  session open to answer hundreds of one-liner judge questions without re-paying the ~30k-token
  harness boot per call — an economics fix for an engine that no longer exists. v3's three model
  calls are one-shot batches; nothing has called it since the judge retired. The measured lesson
  lives in git.

## [0.7.0] · 2026-07-30 · the tune keeps itself true

Your profile stops being a snapshot and becomes a tune. One loop now runs on every refresh:
wherever the AI measurably failed you — in your own recorded words, never our opinion — a patch
enters the file, tested against its own birth baseline, and **deleted the moment the failure
stops**. The wording is voiced once and re-stamped forever, so the daily refresh costs nothing.
The file gets shorter as you get better.

### Added
- **A row can now deepen — and then thin itself.** When the engine measures a gap — a standard you
  demonstrably hold (in your own calm words) that sometimes arrives only as a late correction —
  the row holding that standard gains a when-clause: *"…offer to enter plan mode first — and when
  work is starting and I haven't set a plan yet, stop and plan first."* Its receipt gains a second
  count, `(234×, met · slip 25×)`: the slips are the times the standard arrived late. The decode
  key gains the situation to catch unprompted — the state you never announce, which is exactly why
  it is a gap. Nothing here is our opinion of who you should be: a gap can only exist where BOTH
  sides are in your own history (the reaching and the late catch), arithmetic decides what exists,
  and the model's one job is wording the clause — once, at birth; it never re-rolls. Every clause
  carries its own retirement test: when the gap closes or the stumbles stop on their own, the
  clause and its slip count disappear. **The file gets shorter as you get better** — an
  accumulating memory cannot say that. Most profiles will carry zero or one of these; that is the
  honest count, not a shortage.
- The person-layer schema marker steps to `humanmd/v3` (the when-clause, the slip receipt, and the
  situation triggers are a schema change).
- **The tuning-service loop.** Your profile is the tune your AI reads; the engine now runs one
  loop that keeps it true: wherever the AI measurably failed YOU — moving before your plan was
  down, explaining denser than you could absorb — a patch enters the tune, worded once, tested
  against its own birth baseline on every refresh, and **deleted the moment the failure stops.
  The file gets shorter as the pairing gets better.** Two failure modes are live. *Wrong time*
  prints as the when-clauses and slip receipts above. *Wrong altitude* reads your own ask
  rituals (mined from your history — no shipped phrasebook) and the explanations that came
  straight back ("i don't understand"), and prints two lines in the decode key: your
  comprehension signature with its honest counts (*my questions circle a mechanism → drop a
  level… (563× across 88 conversations, 52 didn't land)*), and — where zones of chosen
  outsourcing exist — *where I never ask questions, I don't want lessons*. No topic is ever
  named, nothing about you is ever graded: **every patch records a failure of the AI, never a
  state of you.** Everything that decides what exists is arithmetic against your own corpus; the
  model's one job is wording each patch, once, at birth. (The moment record carries the answer
  channel that makes this readable: every assistant answer's salient terms and true length.)

### Changed
- **Your profile's wording is voiced once, then re-stamped forever.** Every rebuild used to phone
  the model to re-route and re-word all your rows — the cost that priced daily refreshes out, and
  the reason an unchanged row could flip sections or reword itself between two builds on
  near-identical history. Now the words freeze the first time they are written (cached locally in
  `voiced.json`, keyed to the category generation they voiced), and every later rebuild is pure
  arithmetic: counts, trends, and slip receipts stay alive while the wording never moves. A
  steady-state `stratless update --daily` costs nothing; the model is asked again only for a
  genuinely new category — or after a full re-discovery, where naming already pays.
- **A fading offer/catch row is now checked against what the assistant actually did before it
  prints.** The moment record already knew every tool the assistant ran; it now also records which
  tools you refused (`denied`, resolved from the denial record itself — nothing guessed). When your
  asking for something fades, the engine reads the other side of the conversation: if the assistant
  kept doing the thing and you kept accepting it, the row is stamped **`met`** instead of `fading` —
  the asking faded because it stopped being needed. Offer and catch rows only carry a trend word the
  engine confirmed from both sides; a bare count there means the trend is unproven, not absent.
  "How to talk to me" rows keep their one-sided trend — they describe you rather than instruct.
  Measured on the reference archive before the code was written: the plan-first row that shipped as
  "fading" was in truth met — asks fell to 0.55× while plan-mode actions held at 1.20×, with zero
  refusals of plan mode in 103 uses.
- **Moment shape v3** (supersedes the v2 note below in the same unreleased cycle): the moment
  record gains the answer channel — the assistant answer's salient terms and its true length.
  Existing history re-derives itself from your transcripts on the next quiet refresh — free, no
  model, nothing leaves the machine, and your paid assignments are untouched.
- **Moment shape v2.** Existing history re-derives itself from your transcripts on the next quiet
  refresh — free, no model, nothing leaves the machine, and your paid assignments are untouched.

### Removed
- The `STRATLESS_SYNTH_EVERY` and `STRATLESS_SYNTH_MODEL` environment knobs. Both had been inert
  since the flush gate replaced the synthesis counter — the docs promised levers the code no longer
  read. The real levers are `stratless update --daily|--weekly` and, for the exact interval,
  `STRATLESS_FLUSH_MAX_AGE_MS`. The models each stage runs on are pinned in code, on purpose.

### Fixed
- The offline test seam's stand-in fingerprints all carried different dimensionalities (a `map`
  argument leak), which no consumer noticed until the topic discriminator became the first code to
  depend on the fake geometry. Test-only; real fingerprints were never affected.

## [0.6.3] · 2026-07-28 · the mirror reads you back

The free read used to count you: messages, days, medians. Now it also quotes you.
`what you keep typing` shows your most-repeated messages, exactly as you typed them,
computed like everything else here: arithmetic on your own history, on your machine,
nothing sent anywhere.

### Added

- New rows in the full `mirror` read (bare `npx stratless`), all computed locally:
  `a median day`, `what you keep typing` (exact-text repeats, shown only in your
  terminal), `screenshots sent`, `friction days`, `not counted against you` (the
  permission stops and system blocks that are excluded from your friction rate,
  shown instead of silently dropped), the repo and branch spread beside
  `busiest repo`, and `tools it ran for you` (total tool calls plus the mix).

### Unchanged on purpose

- The `init` door's short teaser and the `--share` card are byte-identical to 0.6.2.
  The card carries only universal numbers: no repo names, no session titles, and
  never anything you typed.

## [0.6.2] · 2026-07-27 · many hands, same fingerprints

A full build now takes ~2.7 minutes — and unlike every speedup before it, this one changes
nothing else. No rebuild, no migration, no download: your patterns, your profile, and every
fingerprint stay byte-for-byte what they were.

### Changed
- **Fingerprinting fans out across up to 4 workers on multi-core machines.** Each worker runs its
  own copy of the local runtime and fingerprints its share of your history one text at a time.
  This is safe *because* of 0.6.1: a fingerprint no longer depends on which texts are processed
  together, so splitting the work cannot change a single bit — and that is enforced, not assumed:
  the pooled path ships gated on producing hash-identical output to the sequential path, verified
  on a real archive. Measured: the fingerprint stage dropped from ~2.4 minutes to ~47 seconds,
  and the one paid call (naming) is now the longest single stage of a build. Machines with few
  cores, small daily refreshes, and any pool failure all fall back to the sequential path
  automatically — slower, never wronger.

## [0.6.1] · 2026-07-27 · one text at a time

Builds got 2.3× faster by deleting an assumption, and fingerprints became fully reproducible.

### Changed
- **Fingerprinting now processes one text at a time, and a full build takes ~4.5 minutes instead
  of ~10.5.** The engine used to feed the model batches of 32, a habit inherited from hardware
  that processes batches in parallel. On the WASM runtime nothing is parallel, and a batch must be
  padded so every text matches its longest member — measured on a real archive, 73% of the
  fingerprinting work was computing padding. One text at a time computes exactly what each text
  needs: measured 3.7× faster on the fingerprint stage, ~2.3× on the whole build. The spend is
  unchanged (~$0.25 — the fast part and the slow part are both free and local).
- **Fingerprints are now fully reproducible: same text, same fingerprint, always.** The compressed
  model tunes itself per batch, so a text's fingerprint used to depend slightly on which texts
  shared its batch. With no batch, that's gone — a fingerprint depends on the text alone, on any
  machine, in any order. This is the property that makes future caching and parallel fingerprinting
  safe, and it's now named in the engine's version stamp.
- **Because the fingerprints changed, your patterns need one rebuild** — the same announced,
  versioned migration as 0.6.0, and the rebuild itself is now the faster kind (~4.5 min). The next
  refresh tells you; one `stratless update` rebuilds from your existing history. Nothing you
  collected is lost. Quality was gated before shipping: same number of patterns, signature
  behaviours intact, every moment still placed.

## [0.6.0] · 2026-07-27 · nothing arrives until you say yes

The npm package returns to **zero runtime dependencies**. 0.5.0's one dependency made a first-time
`npx stratless` download 116MB — ~90% of it native binaries and image codecs the tool never runs.
Now `npx stratless` costs you the tool alone, and everything the pattern-finding needs arrives
once, at `init`, after your yes, itemized in the consent line.

### Changed
- **The engine arrives at consent, not with the package.** Saying yes at `init` fetches two things
  into `~/.stratless/`: `@stratless/runtime` (~3MB — transformers.js and the ONNX WASM backend,
  pre-bundled by us, from registry.npmjs.org) and the bge-small model weights (~34MB, from
  huggingface.co). Both are pinned to exact versions and checksums in the published code; a
  download that doesn't match its pin is refused, never installed. Nothing else ever downloads,
  and the background refresh still fetches nothing, ever.
- **The fingerprinting runtime is now WASM, permanently — standard over speed.** 0.5.0 believed it
  ran on WASM; it actually ran a native binary that computes slightly different numbers on every
  chip. WASM computes identical bits on every machine, which is the right foundation for a profile
  that calls itself measured. The cost is honest: a full build now takes ~10 minutes instead of ~4.
  The spend is unchanged (~$0.25 — the slow part is free and local).
- **Because the runtime changed, your patterns need one rebuild.** The engine now stamps its frozen
  state with the exact runtime and model that computed it, and refuses to mix stamps — silently
  cross-matching two runtimes would quietly corrupt your counts. After updating, the next refresh
  tells you plainly; one `stratless init` (fetches the ~3MB runtime; your model is already on
  disk) and one `stratless update` rebuilds from your existing history. Nothing you collected is
  lost.

### Added
- `@stratless/runtime` — a new companion package holding the pre-bundled WASM runtime. You never
  install it yourself; the CLI fetches and verifies it at consent. Upstream licences ship inside.

## [0.5.0] · 2026-07-26 · a brief, not a portrait

Two changes that go together. Your profile stops describing you and starts telling your assistant
what to do, and the engine that finds the patterns now runs on your own machine.

### Changed
- **`HUMAN.md` is now a brief, not a description.** Four parts: *In the moment* — your shorthand
  decoded live, phrase by phrase. *What to offer me before I ask* — the things you reliably want set
  up or handed over, so your assistant offers them unprompted. *What to catch for me* — what you
  reliably challenge or refuse, so it pre-empts instead of waiting to be corrected. *How to talk to
  me* — the register you work in, matched rather than smoothed over. No section is guaranteed: the
  file carries whatever your history actually supports, never a heading filled for its own sake.
- **Every line is one instruction with its receipt.** `- offer a quick sketch of the idea before
  building it out. (218×, rising)` — the count is what separates a measured profile from a written
  prompt, and the trend rides beside it. The evidence sentences and example quotes moved out of the
  file: your recurring phrases now live inside the instructions themselves, and a "how to talk to
  me" line still has to be backed by a real quote to ship at all — it just isn't printed.
- **The patterns are found locally.** A small embedding model groups your moments on your machine;
  the model is borrowed only to *name* the groups and *word* the brief. A cold build now takes a few
  minutes and spends cents. Naming last is deliberate: a model asked to invent categories can be led
  by its prompt into finding whatever the prompt implies, and one that only names what the maths
  already grouped cannot — and nothing can be *dropped* on a model's opinion either.

### Added
- **A local model, fetched once at `init`.** `stratless init` downloads ~34MB of model weights in the
  foreground, after your consent. It is the first runtime dependency stratless has ever had.
  **Nothing about you leaves your machine** — the weights come in, nothing goes out — and the
  after-session refresh is unable to fetch anything at all, enforced in code rather than left true by
  habit. `npx stratless` (the free mirror) needs no model and never touches one.
- **A format-drift alarm.** If Claude Code's transcript format ever changes under stratless, the
  build refuses loudly instead of quietly writing a profile from an empty read. Refuse, don't lie.

### Fixed
- A pasted terminal prompt (your machine's own hostname) can no longer enter your shorthand as if it
  were something you say.
- The shorthand list no longer runs straight into the first section heading.

## [0.4.4] · 2026-07-24 · one read, not two

`stats` and `mirror` printed the same portrait, so `stats` is retired into `mirror`. They were never
really two things: `stats` read a frozen snapshot of your history taken at `init` time, while `mirror`
reads it live, so `mirror` already showed everything `stats` did and then some.

### Changed
- **`mirror` is now the one read.** It picked up the one thing `stats` had that it lacked: the
  `profile captures X%` coverage line, shown once you have built a profile. When a profile exists the
  footer points you at `stratless update` to refresh it; before that, at `stratless init` to build it.

### Removed
- **`stats` is retired.** Typing it now points you at `stratless mirror`. That is seven commands, down
  from eight.

## [0.4.3] · 2026-07-24 · the run-it-now free read

A way to see your number before you commit to anything. `stratless mirror` reads your live history and
shows the free read on the spot, with no setup, no archive, and nothing spent. It changes nothing on
your machine, so you can run it, see it, and share it.

### Added
- **`stratless mirror`**: a read-only free read of you and your AI, computed from your live history in
  `~/.claude/projects`. No `init`, no archive, no model call, no spend, and it writes nothing. Works
  the first time you ever run stratless.
- **`stratless mirror --share`**: a clean, screenshot-ready card of the universal numbers (scale, how
  you write, the two friction numbers, your top tool). It leaves out anything that could name a repo
  or a project, so it is safe to forward.

### Changed
- **Bare `npx stratless` (no command) now shows the mirror**, not the help wall. `stratless help`
  (or `--help`) still prints the full command list.

## [0.4.2] · 2026-07-24 · weekly by default

0.4.1 gave you the cadence choice. This makes weekly the default, not daily. It reads your whole
history, so a lighter default is the right call. `stratless update` still rebuilds right then,
whenever you want it fresh.

### Changed
- Auto-rebuild defaults to weekly now, not daily. Your turns still get collected free every session;
  the profile just rewrites on the weekly tick. `stratless update --daily` if you want it more often.
- The profile dropped its em dashes. Plain commas and colons now.

## [0.4.1] — 2026-07-23 — auto-rebuild, once a day (your call)

0.4.0 rebuilt your profile every time a session ended, so a busy multi-session day meant a rebuild
every few minutes — near-identical work for a few cents each. Now it rebuilds at most once a day, and
you decide the cadence.

### Changed
- **Auto-rebuild is a once-a-day cooldown now**, not a per-session trigger. Your turns are still
  collected for free every session; the profile just gets rewritten on the daily tick instead of on
  every session boundary. `stratless update` still rebuilds instantly whenever you want it fresh.

### Added
- **Pick your cadence:** `stratless update --daily` or `stratless update --weekly` sets how often the
  profile may auto-rebuild on its own (default daily). `stratless status` shows the current setting.

## [0.4.0] — 2026-07-23 — the discovery pipeline, and a profile you can read

The miner is gone. In its place is a pipeline that reads your own words and shows its work: it gathers
the recurring MOMENTS from your history, DISCOVERS the kinds of things you do from those moments (never
from a list we wrote), ASSIGNS each moment to the kinds it fits, COUNTS them, and WRITES the profile. It
costs a fraction of the old engine, and you can follow every step. This release also makes the read side
whole: you can see at a glance who the profile thinks you are, how fresh it is, and how you and your
assistant actually work together.

### Added
- **A version stamp.** `HUMAN.md` carries a `# built <UTC>` header, and `profile` and `status` show the
  same stamp, so you can always tell whether you are reading the latest rebuild.
- **`status`: recent builds.** A short trajectory of your last few rebuilds (when each ran, how your
  history grew), so a stale profile can never hide.
- **`stats`: the measured portrait of you.** Global across every conversation: how much you write, the
  span, how often you cut the assistant off, how much of you the profile covers. It used to report the
  assistant's code output in a single project, which was the wrong thing to measure for a tool about you.
- **A loading cursor on every wait** (the build, the history read, the version check), so nothing ever
  looks hung.
- **The cold-start door.** `init` shows you a free read of yourself and an honest cost estimate, then
  takes one yes before the one-time build. Installing turns the silent after-session refresh on.

### Changed
- **The engine is the discovery pipeline** (moments, discover, assign, count, write), replacing the
  miner. Categories are minted from your own pile and re-discovered when they stop fitting you.
- **The profile refreshes on a trigger, not every turn** (a new session, a daily ceiling, or a hand-run
  `stratless update`), so steady-state cost stays near zero.
- **`status` spend is cleaner.** The retired mining stages collapse into one honest line instead of five.
- **`report` folded into `profile --read`.** The human-facing prose copy is now a subfunction of
  `profile`, not its own command, and it renders LAZILY: your profile earns the build, and the read
  is written only when you ask for it, once per build, over exactly the evidence the loaded profile
  saw. It can no longer describe a different window than the profile you are running, and it never
  re-reads your history. Typing `stratless report` points you at `stratless profile --read`.
- **`profile --now` retired.** `profile` now only *looks* (one clear rule: `profile` looks, `update`
  loads). The old `profile --now` was a paid look that never loaded and never re-mined (it re-synthesized
  from stale patterns), so it could show a fresh-looking profile your assistant never saw. To rebuild and
  load, use `stratless update` (or `update --now` to force it). Typing `profile --now` points you there.

### Removed
- **The miner, the auditor, the grader, and the verdict.** The whole mine-audit-grade engine (about $24
  a build) is gone; the discovery pipeline does the same job for a fraction.

## [0.3.5] — 2026-07-18 — the worker: the work moves off your terminal

Phase 2 of the cold-start build. The machinery no longer lives inside the command you typed — it
lives in ONE background worker that commands merely wake. Nothing runs when there is nothing to
do; there is no daemon.

### Changed
- **`update` is now a doorbell.** It wakes the background worker and — in a real terminal —
  watches it, printing the same progress lines as before. The difference shows only at the edges:
  Ctrl-C (or closing the terminal) detaches the *display*; the work continues and the profile
  still lands. The detach message prints the whole kill ladder: watch with `status`, stop
  everything with `stop`. The after-session hook rings the same doorbell and returns instantly.
- **`stop` now stops a RUNNING refresh too, within seconds.** The off switch means spending halts
  now — not after the current build finishes. Killing never wastes what was spent: every judgment
  already made is banked, and restarting re-reads at most one chunk.
- **`status` shows a live worker** (`running now  judging 12/31 · pid N`) and labels the last
  run honestly (`stopped by you`, or `failed` with the reason).
- **Kill-safe to one chunk, for real (C3).** Judged verdicts are now banked per streamed session
  as they land — a crash, sleep, or kill loses at most the twelve-turn chunk in flight, never the
  whole batch. (The Phase 2 gauntlet test caught the old behavior losing the entire batch.)
- **Typos refuse instead of quietly running something else.** `stratless update --npw` used to run
  a plain update while you believed you had forced a rebuild. Unknown flags and stray arguments
  now exit loudly, with a did-you-mean — and a mistyped command (`stratless updat`) gets the same
  courtesy, suggesting the nearest verb.
- **The borrowed model pin is absolute.** A stage pinned to sonnet (mining, writing, grading) or
  haiku (judging) now runs on that model or REFUSES — it never silently falls back to your account
  default. Left unchecked, a failed pin could land the priciest stage on the priciest model (if you
  default to Opus) at frontier rates, invisibly. Override stays yours via `STRATLESS_SYNTH_MODEL`;
  a CLI without JSON output still answers, but on the same pinned model.

### Added
- **Every run hands you its receipt.** A finished `update` closes with what it actually spent —
  `this run: 1.2M tokens · ≈ $0.21 at API rates · claude-haiku-4-5 ×31 · claude-sonnet-5 ×3` —
  tokens first, models by their ground-truth names (which model RAN, not which was asked for).
  Refused and stopped runs get their receipt too; a run that spent nothing owes none. `status`
  keeps the most recent run's receipt (`last run spend`), so the hook's silent spends stay
  readable. Announced before, metered during, accounted after.
- **The artifact-shape lint** (the second half of the tool-less-borrow guarantee, pulled forward
  after a chatter reply was loaded as a real HUMAN.md in the wild): a profile that opens with
  assistant chatter, or a pattern-era profile without its section headings, is REFUSED like an
  invented number — nothing malformed ever loads.
- **The flat-memory walk (C1):** the archive is read one transcript at a time, newest first —
  memory stays flat whether your history holds 200 exchanges or 20,000. This is the read the
  cold-start release (0.4.0) will stand on.

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
