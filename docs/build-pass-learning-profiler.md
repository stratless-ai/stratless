# stratless — Build Pass: The Learning Profiler

> Subordinate to `official-handover.md` (the master brief). That doc defines the product and the
> pivot; this one defines *how the profiler keeps knowing more* — the trigger that feeds it, the
> two clocks it improves on, and the passes that turn a bigger pile of evidence into deeper knowing
> instead of just more dots. Written 2026-07-15, the session after the pipeline core shipped.
>
> A later 2026-07-15 discussion added three things to this doc: the **product framing** it revealed —
> the outcome and the architectural framework (§8); the **adapter seam** for going assistant-agnostic
> (§9); and **distribution & updates** (§10). **Token economics got its own session and its own doc:
> `docs/token-economics.md`** — §6 here is now just a pointer.

---

## 0. Honest state — what exists vs what this doc plans

**Built and verified this session (the pipeline core, 0.2.0 foundation):**

- `cli/src/exchange.ts` — reads the log a second way, as `(AI turn → human reaction)` pairs.
  Reuses `transcript.ts`'s message-walking. Pure, unit-tested. Finds **3,756 exchanges across 84
  sessions** on the build machine.
- `cli/src/judge.ts` — the small read: one line per exchange (*"did understanding transfer, about
  what?"*), cached by content hash at `~/.stratless/judgments.json`, checkpointed every 10. **Read
  once, ever** — verified across separate process runs (a second invocation reused 30 from cache,
  spent 1 new).
- `cli/src/claude.ts` — the single `claude -p` borrow, factored from `explain.ts`.
- `cli/src/synthesize.ts` — the big read → `profile` (the AI's copy) and `report` (the human's
  copy). Two renderings from one pile.
- `profile` / `report` wired into `index.ts`. Both produce §8-quality output on real logs.

**Designed here, NOT built:** the *learning* passes (§3 below), the amortize trigger + Stop hook
(§1), and the layered-clock profile store (§3d). This is the substance of the next pass.

**Still the old shape, untouched this session:** `why` / `match.ts` (to kill), `stats` (to expand),
`update` / `stop` / `pause` (to add), all web + package copy. Tracked in the handover §5–§7.

---

## 1. The trigger — amortize over sessions

**Decision (2026-07-15): the default refresh is amortize-over-sessions, not one cold backlog run.**

"Amortize" is the accounting word: take a big one-time cost and spread it over many small periods
so no single period feels it. The backlog is 3,756 exchanges; at ~3.5s per Haiku judge call, a
single cold run is **~3.7 hours** — a non-starter as a first-run wall. So we spread it.

**Mechanism — the silent Stop hook (handover §3 stealth).** A Claude Code Stop hook runs the moment
the assistant finishes a session. Ours prints nothing, exits clean, and runs `stratless update` in
the **background** so the person never waits on it. Each fire:

1. Load all exchanges; filter to the ones not already in the cache.
2. Judge a small batch — this session's genuinely new exchanges (~20–40) **plus a nibble off the
   old backlog** (say ~20 more).
3. Re-synthesize the profile from the now-slightly-larger judgment pile.

**The numbers.** At ~40 exchanges consumed per session, 3,756 drains in **two to three weeks of
ordinary use** — no upfront wall, no bill, nothing to watch. Crucially, the profile is useful from
**run one** (30 exchanges already produced a sharp profile), so amortizing is not "wait weeks for it
to work"; it works on day one and sharpens invisibly in the background.

**The steady state is the real payoff.** Once the backlog is gone, every session only ever adds *its
own* new exchanges — a few reads plus one synthesis, essentially free, forever. That steady state
is what makes "continuous knowing" (§2, Clock 1) sustainable rather than a recurring cost.

**Opt-in escape hatch for the impatient:** `stratless update --backfill` runs the cold backlog with
**bounded parallelism** (e.g. 4–8 concurrent `claude -p`) to chew it in ~30 min up front. Default
stays amortize; `--backfill` is a choice, never the path.

**Cost paid:** the profile is a little thin for the first few days while the backlog drains. That's
the whole downside, and it's mild.

**Primitive already in place:** `judgeAll(..., { limit })` and the `STRATLESS_JUDGE_LIMIT` env cap
the fresh calls per run — that's the knob `update` and the hook will drive. `update` itself is not
yet built.

---

## 2. How stratless knows more — the two clocks

The word "learning" hides two completely different mechanisms with completely different privacy
properties. Conflating them is exactly where a product like this quietly starts lying. Keep them
apart.

### Clock 1 — DEPTH: your local stratless knows *you* better every day

Automatic, local, private by construction. But be honest: **naive accretion doesn't get smarter** —
piling up more one-line judgments and re-reading them just yields more dots. The three passes in §3
are what turn a bigger pile into genuinely deeper knowing. This clock never leaves the machine.

### Clock 2 — CRAFT: the *product* gets better at knowing *anyone*

stratless's intelligence is not weights — it's **the prompts and the pipeline** (the judge question,
the pattern-miner, the synthesis, the self-correction loop). All of that is **code**. So the product
improves for everyone in two ways that never touch a user's data:

- **You ship better prompts.** You are user #1, dogfooding your own profile. Every weakness you see,
  you sharpen the pipeline and ship — and every user's *next local run* gets smarter on *their own*
  data. That is the flywheel, and it is the honest version of "improve every day": you improve it
  *by being a user of it*.
- **The borrowed model improves for free.** stratless rides the user's own `claude`. A better Haiku
  or Opus makes every profile everywhere sharper overnight — zero work, zero data movement.

### The forbidden third thing — central pooling

The tempting way to "improve with each user" is to pool everyone's judgments or profiles centrally
to train a better profiler. Even "anonymized," even "aggregated" — **the instant conversations or
profiles leave the machine, the promise is dead, and the promise *is* the product.** This is the
privacy form of the handover's quiet-lie trap.

> **INVARIANT: no user's conversations, judgments, or profile ever leave their machine. Not for
> telemetry, not for "aggregate insight," not for model improvement. Ever.** The two clocks above
> are sufficient; we do not need the thing that would kill us.

**Direct answer to "improve every single day with each user without storing their data":** yes, in
two independent ways at once — each user's stratless deepens on their own machine daily (Clock 1),
and the shared pipeline you ship gets better for everyone on update (Clock 2).

---

## 3. Clock 1 build — the passes that make it *learn*

These run inside `update` / the Stop hook. They add real synthesis cost and complexity — they are
not free — and they are the difference between "a profile from a bigger pile" and one that learns.

### 3a. Emergent pattern mining (two-stage synthesis)

Split synthesis in two. First a **miner** pass over the judgment pile that outputs *named, frequency-
counted* patterns (`"bounces to cost whenever the topic is infra ×40"`, `"re-asks after any framework
answer ×12"`). Then the **writer** pass reasons the profile *from* those named patterns. This is
literally handover §4's "categories must emerge, not be imposed" — and it is where "identify more and
more patterns from the user" stops being a hope and becomes a code path. A seed exists: `topTopics()`
in `synthesize.ts` is a trivial frequency count; the miner is its real version.

**Modes and their tells (contextual states).** The same person wants brutal density at 10am and
gentle, step-by-step at 11pm — a *flat* profile averages that away and serves neither. The profile
loads at session start, blind to the current moment, so it must not try to *predict* the mode; it
must **describe the person's modes and the tells that distinguish them**, and let the live assistant
read the room and switch. This is a forensic, mineable trait: reactions can differ by time-of-day,
session length, or task shape (debugging vs. conceptual learning), and the miner can surface *"terser
and more directive in the morning; more exploratory late at night."* It is the same machinery as the
failure signal — a described tell the assistant acts on — widened from one axis to several.
*(Surfaced by an outside review, 2026-07-15; a real gap in the flat-profile design.)*

### 3b. Longitudinal deltas (trends only time can show)

Exchanges are timestamped. That lets stratless see what no snapshot can: *"used to bounce on deploy
questions in June, stopped in July"* = learned it. The miner tags patterns with their time window;
the writer reports the **trajectory**, not just the current state. This is the compounding kind of
knowing, and it's the answer to "continuous knowing" being more than a growing list.

### 3c. Self-correction loop (the closest thing to real learning)

The profile makes claims (*"failure signal = a re-asked question"*). The next session confirms or
violates them. On each `update`, a pass checks new exchanges against the profile's **own prior
predictions** and treats the **misses as the highest-value signal** — that's where the model of the
person is wrong. The profile carries a *"what surprised me since last time"* delta. This makes the
profile *earn* its confidence instead of asserting it. It is per-user, local, and never leaves.

### 3d. Layered-clock storage (continuity without thrash)

Handover §4's layers run on different clocks. Store them separately so each refreshes on its own
cadence instead of the whole profile being rewritten every run:

| Layer | Refresh | Trust |
|---|---|---|
| what you **know** | every update | chases a moving target forever |
| how you **think / talk** | weeks | fairly stable |
| how you **work** | months | stable |
| **direction** (what you build & why) | only on a pivot | bedrock — lean on it hard |

The fast layer moves; direction stays put. That's continuity *with* stability — the profile deepens
without flip-flopping session to session.

### Future signal source — the override-delta (2026-07-15, from the es-v2 review)

Everything above reads ONE signal: the conversation — *(what you said → how you reacted)*. That
captures *who you are* (meaning, altitude) but is weak on *how you build* (craft, style, which
abstractions you accept). A second forensic signal fills exactly that gap: **the override-delta — what
the agent wrote vs. what you kept or rewrote.** When the agent writes `const f = () =>` and you change
it to `function f()`, you never *said* the preference — you *showed* it. It is the strongest possible
signal for the **"how you work" layer** (§3d), the one conversation reaches least.

It fits the architecture cleanly: it's *another trace already on disk*. `transcript.ts` already parses
every agent edit (`Edit` / `Write` / `MultiEdit`); git records what survived. So "agent wrote X → you
ended up with Y" is reconstructable **forensically, by diffing existing records** — never a live
file-watching daemon (surveillance, which the posture forbids; the es-v2 proposal got this wrong). It's
on-theme with "game, not test": your corrections *are* the map, and this reads them.

**The catch — it's noisier.** Not every override is a preference (bug fix vs. style; a teammate's edit
in a shared repo; a task change). The judge must separate craft-preference from bug/task and **refuse
on ambiguity**; consistency across many overrides turns noise into signal (same trick as the miner, §3a).

**Where it lands:** Phase 2+ — a *second Source dimension* feeding the how-you-work layer, built once
dogfooding shows that layer is thin. Not the first checkpoint (0.2.0).

---

## 4. What this means for the code

**New / changed modules (proposed):**

- `update.ts` — the incremental driver the hook calls: load → judge new (bounded) → run the learning
  passes → write the layered profile. `profile` / `report` become thin readers of the stored profile,
  regenerating only when stale.
- `miner.ts` — pass 3a (+ 3b time-tagging). Consumes the judgment pile, emits named patterns.
- `hook.ts` — install/remove the silent Stop hook in `~/.claude/settings.json`; `init` calls it.
- `synthesize.ts` — grows a self-correction pass (3c) and writes the layered profile (3d).

**Proposed `~/.stratless/` layout:**

```
~/.stratless/
  archive/            transcripts beyond the reaper's reach (exists)
  judgments.json      hash → one-line judgment, read once ever (exists)
  patterns.json       mined, frequency-counted, time-tagged patterns (3a/3b)
  profile.json        the layered profile + its standing predictions + hit/miss tally (3c/3d)
  profile.txt         the AI's rendered copy (exists)
  report.txt          the human's rendered copy (exists)
```

---

## 5. Open decisions

- **The fork — fold learning into 0.2.0, or ship flat-pile first?** The flat-pile profiler already
  reads well. Do the miner + self-correction + layered store land in *this* release (first shipped
  profiler genuinely learns), or ship 0.2.0 flat and add learning as 0.3.0? **Unresolved — Sun's
  call.**
- **Token economics — moved to its own doc** (`docs/token-economics.md`). The measurement that
  reframed it: each `claude -p` call carries ~17–24k tokens of irreducible harness overhead, so
  batching and cache-warmth are the levers, not prompt size. See §6.
- **Backfill parallelism factor** — how many concurrent `claude -p` for `--backfill` without
  tripping the plan's rate limits. Needs measurement (folded into the token session).
- **Adapter seam decisions** (§9) — one merged profile across tools vs one per tool; and how to
  supply a **Brain** for assistants that have no scriptable local inference CLI. Both open.

---

## 6. Token economics — moved to its own doc

Cost and token usage earned a dedicated session and a dedicated doc: **`docs/token-economics.md`**.
The headline verified this session — every `claude -p` call carries **~17–24k tokens of irreducible
Claude Code harness overhead** (built-in tool schemas + system prompt) that dwarfs our ~1k judge
prompt, so **batching and cache-warmth, not prompt size, are the real levers** — lives there in
full, with the `usage`-command design and the plan for measuring exact per-feature numbers.

---

## 7. Invariants (do not break)

- **Nothing leaves the machine** (§2 invariant). No pooling, no telemetry of content, ever.
- **Read once, ever** — never re-judge a cached exchange. The rule that keeps it cheap.
- **Refuse, don't lie** — if the assistant can't answer honestly, output nothing. Carried from
  `explain.ts` / `canary.ts`.
- **The file is free and stays free** — a text profile is copy-pasteable; never paywall it
  (handover §11).

---

## 8. Product framing — the outcome, and the framework the architecture reveals

Locked in a 2026-07-15 discussion. Two sentences that should gate every future feature and every
line of marketing copy.

### The outcome stratless packages

The *feature* is "a profile of you." The **outcome is continuity of being understood.** Today, every
session starts from zero — the assistant has no model of you, so you spend the session managing its
altitude ("no, simpler", "what does this mean for us", re-asking, going quiet). You carry the burden
of being understood, every time, and it never accrues. stratless makes it accrue instead of reset.

The code performs the arc literally: **preserve → understand → apply.**
- `init` **preserves** — fights the reaper. First act: stop throwing away who you are.
- judge + synthesize **understand** — read that history into a model of the person.
- load **applies** — make that model act on your behalf, silently, next session.

Two consequences that sharpen the product:
- **The deliverable to the human is not information — it's a changed counterpart.** `report` (what
  you read) is the *byproduct*; `profile` (what the AI loads) is the *product*. The two-renderings
  split in `synthesize.ts` encodes that the real customer is the AI.
- **The outcome is invisible by design** — the better it works, the less you notice. That's exactly
  the job `report` does that `profile` can't: it makes the invisible outcome legible enough to trust
  and to pay for.

> **Decision lens 1 (outcome):** does a feature make the user more *met* — a better preserve,
> understand, or apply — or is it "more paper"? (The rules-sheet was rejected on exactly this lens.)

**The echo-chamber guardrail — model comprehension, not approval.** "Make the user feel met" could
slide into sycophancy: a profile that says *"keep up, be a thinking partner"* might train the
assistant to only ever agree, and stop challenging assumptions. The architecture already resists
this, and the resistance is worth naming: **the judge measures *"did understanding transfer,"* not
*"did the user feel validated."*** stratless optimizes for comprehension, not for approval — a
person can understand something perfectly and hate it. So the guardrail is structural, not a bolt-on
"pushback slider" (that would be another knob — more paper). Instead, the portrait captures the
person's **relationship to disagreement** as a described trait: Sun's own profile carries *"'no'
rejects the whole frame — rethink,"* i.e. he *wants* to be challenged on direction, not patched.
That is a trait to reason from, not a metric to tune. *(Prompted by an outside review, 2026-07-15,
warning of the echo-chamber risk.)*

### The framework the architecture reveals

- **Method — forensic, not surveillance.** It reconstructs the comprehension record from traces
  already on disk; it never watches live. That is *why* it can be local and private — it reads
  evidence, it doesn't observe. Its discipline is a coroner's: refuse when the evidence is
  insufficient (the `canary.ts` / "refuse, don't lie" rule = "insufficient evidence"). The old `why`
  literally spoke in verdicts.
- **Output — telemetry for understanding.** The judge asks one question of every exchange (*did
  understanding transfer, about what?*) — a probe emitting a metric. Nobody instruments the human↔AI
  relationship. stratless is **the missing telemetry layer between a person and their AI**, produced
  by forensic means rather than live instrumentation.
- **Structure — an event-sourced projection.** The conversation log is an append-only event stream
  (source of truth, never mutated); the profile is a **projection** over it. `judge` is a memoized
  per-event transform — *"read once, ever"* is just *"each event folded into the projection exactly
  once."* `synthesize` is the fold; the cache is the checkpoint; the layered clocks (§3d) are
  multiple projections at different refresh rates; self-correction (§3c) is the projection validating
  itself against new events. Half the "open questions" are solved event-sourcing patterns once seen
  this way (amortize-over-sessions = incremental projection maintenance).
- **Posture — exhaust-to-asset, local-first, rider.** It reclaims the reaped log as the primary
  asset (`init`), keeps everything on the machine (the §2 invariant is *forced* by this, not bolted
  on), and owns no model — it borrows the host's compute (`claude.ts`), like an extension riding a
  browser.

> **Decision lens 2 (framework):** every legitimate feature is a better **source**, **projection**,
> or **load**, and must stay **local** and **borrow** rather than own. A central insights server,
> pooled training data, or a hosted profile all fail this — which is why the privacy invariant is
> structural, not a policy.

**The honest cost of the moat:** local + forensic removes all data-privacy and hosting burden and
gives ~zero marginal cost per user — but it also removes *central* telemetry on your own product. You
cannot measure whether the profile is good for other users without breaking the invariant. So "does
it stay good at scale" (handover §11) must be answered by dogfooding and design, never by watching
users. That is the price of the moat, and it is the right price.

---

## 9. The adapter seam — toward assistant-agnostic

Today stratless is Claude Code-only because Claude Code fills **three conflated roles** at once. The
seam splits them; the core pipeline stays vendor-neutral and only the edges are per-assistant.

- **Source** — *whose logs.* Discover + parse transcripts into `Exchange`s; protect them from a
  reaper; run a per-tool canary.
- **Brain** — *who does the inference.* The `claude -p` borrow.
- **Sink** — *where the profile lands.* Inject it where the tool reads it; optionally install a
  refresh trigger.

```
interface Source {                          interface Sink {
  id; detect(): boolean                       id; detect(): boolean
  parseExchanges(path): Exchange[]            injectProfile(text): void
  protect?(): ProtectResult                   installRefreshTrigger?(cmd): void
  health(exchanges): Health                 }
}                                           interface Brain {          // the borrow
                                              available(): boolean
                                              run(input, model?): string | undefined
                                            }
```

**Pipeline:** read from every present **Source** → merge into one corpus (dedupe by hash — the code
already does this) → judge/synthesize with the **Brain** → push the one profile to every present
**Sink**. One person, one profile, many tools.

**Open decisions:**
1. **One merged profile across tools, or one per tool?** Lean merged — the person is the same in
   Cursor and Claude Code — with "which tool" kept as a dimension the miner can surface if it matters.
2. **The Brain is the real bottleneck, not the parsers.** CLIs (Claude Code ✓, Codex CLI, Aider,
   Gemini CLI) can fill *all three* roles because they're scriptable. GUI/IDE tools (Cursor, Cline,
   Windsurf, Zed, Copilot) can be good **Sources** and easy **Sinks** but **not Brains** — no
   scriptable local inference — so they must borrow a separate Brain (`claude -p` if present, or an
   API-key fallback). Deciding the Brain strategy is the crux of agnosticism.

### The Sink in depth — stratless owns the *person-layer* (2026-07-15)

The triage (`docs/adapter-triage.md`) surfaced that the assistants are converging on a shared
instructions file. `AGENTS.md` is emerging as a **vendor-neutral standard** (Codex treats it as
primary; Cursor, Copilot, and Zed all read it); `CLAUDE.md` is widely read for compat; and Zed goes
furthest — its loader ingests `.cursorrules` / `.clinerules` / `copilot-instructions.md` / `AGENTS.md`
/ `CLAUDE.md` / `GEMINI.md` outright. The forces: users refuse to maintain N instruction files, and
tools race to read each other's files to demolish switching costs.

**This does not threaten stratless — it clarifies its layer.** Every one of those files is a
**project** artifact: repo conventions, build commands, "this codebase is Go, run `make test`" —
committed, team-shared, about the *code*. stratless's profile is a different layer: about the
**person** — global, private, uncommitted, following you across every project. The two **stack**:

| Layer | File | Scope | About | Owner |
|---|---|---|---|---|
| **Project** | `AGENTS.md` / `CLAUDE.md` / rules | per-repo, committed, shared | the code | the standard (commoditizing) |
| **Person** | stratless profile | global, private, per-user | *you* | **stratless** |

stratless doesn't compete with `AGENTS.md`; it fills the layer `AGENTS.md` doesn't reach. Positioning:
**stratless is the person-layer; `AGENTS.md` is the project-layer.** Consequence for the moat: because
delivery is converging on "write a file anyone can write," the **Sink is a commodity** — stratless's
defensible value is entirely *upstream* (the forensic Source read + the profile's intelligence). Never
defend on delivery.

**Sink design constraints — binding on every adapter:**
1. **Target the GLOBAL / user scope, never the project file.** The person-profile belongs in the
   user's global config. Per-tool global targets from the triage: `~/.codex/AGENTS.override.md`,
   `~/.gemini/GEMINI.md`, `~/.copilot/copilot-instructions.md`, `~/.config/zed/AGENTS.md`,
   `~/.codeium/windsurf/memories/global_rules.md`, Claude Code `~/.claude/CLAUDE.md`. **Cursor is the
   exception** — its global "User Rules" has no clean file path (lives in app settings), so Cursor's
   Sink is the awkward one to solve.
2. **Never write to a git-committed project file.** A private profile in a shared/committed
   `AGENTS.md` leaks the person into version control and pollutes the team's instructions.
3. **Write inside a delimited managed block** — `<!-- stratless:start -->…<!-- stratless:end -->` —
   so stratless updates only its own section and never clobbers what the user put in that global file.
4. **Respect size caps** (Windsurf 6k/12k chars, Codex 32 KiB). The profile is ~300 words and fits;
   the layered/growing versions must stay bounded.
5. **Output hygiene** — never let a secret or key reach a file that could be read, copied, or
   committed (the Gemini-review caution; the invisible outcome of §8 still needs a clean artifact).

**The ambitious option (flagged, not chosen):** nobody is standardizing the *person* layer; stratless
could try to seed a portable person-profile convention the way `AGENTS.md` seeded the project layer.
Standards emerge fast when they kill real pain (`AGENTS.md` did) — but it's a heavy lift for a solo
maintainer and it is *not* a moat. Realistic play: **piggyback the convergence** (write to each tool's
existing global file) and let tool-fragmentation + file-convergence make "one profile, injected once,
read everywhere" feasible. stratless is the only thing producing that one profile.

### HUMAN.md — the person-layer file, its privacy rule, and teams (2026-07-15)

The person layer gets a *name and a file*: **`HUMAN.md`**, the counterpart to `AGENTS.md`. Two files,
two sides of the conversation — `AGENTS.md` tells the AI about the agent's world (the project);
`HUMAN.md` tells it about the human. This turns the "ambitious option" above from a footnote into the
flag; the hero line becomes *"every repo has `AGENTS.md`; none has `HUMAN.md` — that's the missing
layer."* stratless writes `HUMAN.md` and points each tool's global config at it today; ecosystem
auto-read is aspirational and still not a moat, but it's a real seed (how `AGENTS.md` itself started).

**The privacy rule — sharpened (supersedes the framing of constraint #2 above):** *`HUMAN.md` is
visible to your coding assistants, invisible to people.* Machine-readable, human-invisible. Concretely:
local, **gitignored** or global user scope, **never networked**. The real constraint is
human-visibility, not the file's location — so if `HUMAN.md` ever sits in a project root (next to
`AGENTS.md`), stratless **auto-adds it to `.gitignore`** on write, so it is never committed and never
shared.

**The team model — individual, private, by default.** A team adopting stratless is **N private
`HUMAN.md`s, one per person** — each read only by *that* person's own assistants. **No pooling, ever**:
every engineer gets an AI that knows *them*, not one averaged model of "a developer." Under the privacy
rule a teammate counts as "the public," so by default nobody sees anyone else's profile. Team-*collective*
knowledge (how we work, glossary, review culture) lives on the committed/project side (`AGENTS.md`, or an
optional `TEAM.md`) — **never in a `HUMAN.md`**; you can't inherit how someone thinks, so a joiner
inherits conventions, not a person. **Guardrail:** "team" is exactly where the pressure to build the
forbidden central hub comes from (Gemini's B2B pooling, `reference-img/`) — architect any team-sharing
**peer-to-peer, no server**, so pooling is *impossible*, not merely discouraged. **Do not** add a formal
"Team layer" to the framework — keep Person/Project clean; team is the *distribution* of the person layer.

**The three renderings — same judged data, three audiences, escalating exposure.** `synthesize.ts`
already produces the first two:
- **`profile`** → the AI. Full, private, machine-facing; loads into context. *(built)*
- **`report`** → you. The mirror, human-facing. *(built)*
- **the shareable card** → teammates. A **curated, opt-in slice** you choose to expose (the
  collaboration-useful bits — "senior in backend, learning frontend, likes direct feedback" — never the
  vulnerable parts), default share-nothing, person controls the valve, shared as a *file* never uploaded
  to a hub. *(not built — the team-facing third rendering.)*

Only the third rendering ever crosses between people, and only by the person's own hand.

**Build spec:** the full implementation spec for this seam — the ports, the module map, the build order
(kill `why` first), and format-drift detection + mitigation — is in **`docs/adapter-seam-spec.md`**.

**Recommendation:** build the **seam plus one reference adapter** (Claude Code behind all three
interfaces) now; **defer the N parsers** until the profile is proven beyond N-of-1 (handover §11).
The refactor is cheap and de-risks the future; the per-tool parsers are the expensive part to hold.
Proof the seam works: nothing in `exchange` / `judge` / `synthesize` imports anything Claude-specific.

**Coverage ceiling (state it honestly):** stratless can only profile assistants that keep a
**local, parseable, resumable** log — a bound set by what's on disk, not by our effort. The triage
refined this: it's really a **CLI-vs-GUI** ceiling. CLIs keep clean local transcripts and can even
be their own Brain; GUIs keep undocumented DB blobs and have no native Brain. (My earlier prior that
Copilot was a "cloud-only no" was **wrong** — its new standalone CLI has a documented local store.)

**Triage — COMPLETE:** the go/no-go per candidate is in `docs/adapter-triage.md` (8 tools, researched
2026-07-15, verified against current docs). Headline: **every CLI is a clean GO, every GUI a PARTIAL**
— the triad predicted it exactly. Build order when adapters land: **Aider first** (seam-proof, Effort
S, maximally different from Claude Code), then **Gemini CLI / Codex CLI** for reach; **defer the GUIs**
(Cursor's mainstream surface is fragile; Windsurf is mid-rebrand to "Devin"). The universal design
mandate that fell out: **the per-Source canary is mandatory on every adapter**, because every
transcript schema is undocumented and several move without notice.

---

## 10. Distribution & updates

stratless is an npm CLI, so the raw mechanism is `npm`/`npx`. The design question is *auto vs
deliberate*, and the trust posture decides it: **a tool that reads your whole history and spends
your quota must never silently update itself.**

- **Pinned global install + a passive update-notifier.** On run, cheaply check the registry and
  print a one-line *"stratless X available: npm i -g stratless"*. The user updates on their own
  terms. The Stop hook calls the **pinned binary** (fast, stable) — not `npx` (cold-start every
  session).
- **On-disk data survives updates.** The cache (`judgments.json`) and profile persist across CLI
  versions — **version the cache format and migrate it**, so upgrading never re-spends the backlog.
- **This is the Clock 2 delivery channel** (§2). Better judge/synthesis prompts reach users only
  through a CLI update. One subtlety that couples the two: judgments are cached by *exchange* hash,
  not *prompt* version, so a materially better judge prompt won't re-judge anything automatically.
  **Put a pipeline-version into the cache key** — then an update can *choose* to re-judge, which is
  how a Clock 2 improvement actually propagates.
