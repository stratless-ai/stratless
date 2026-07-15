# stratless — Official Handover

> **Read this first, in full, before touching code or copy.** It is the complete brief for the
> third turn of stratless: the pivot from a code-provenance tool into a *human profiler*. It
> defines the product, the mechanism, the new command surface, and every file whose copy is now
> wrong. Written 2026-07-15, from the session where the product was found by measuring Sun's own
> transcripts.

---

## 0. TL;DR

The shipped product (`stratless@0.1.0`) is the **wrong** product. It is a code-provenance tool —
*"point at a line, get the decision that made it"* (`stratless why`). Sun explicitly does not want a
reactive, point-at-a-line tool.

The **right** product: stratless reads your AI conversations and builds a **living model of who you
are** — what you know, how you think, what you're building — so your assistant stops talking over
your head or under it. Nobody is the "user." The audience is the **AI**; it loads your profile and
speaks to a person instead of a blank.

This handover is the plan to rewrite **both the functions and the copy** to that.

---

## Current state — updated later on 2026-07-15 (read this before acting on the sections below)

This handover is the **origin brief**, written at the start of the session. A lot moved after it;
where this block and a later section disagree, this block wins.

- **The profiler pipeline core IS built and verified** (not "designed," as §6 still says): `cli/src/exchange.ts`
  (the `(AI turn → human reaction)` pair parser), `judge.ts` (cached per-exchange judging), `claude.ts` (the
  borrow), `synthesize.ts` (profile + report), wired to the `profile` and `report` commands — 11/11 tests
  green. Still to build for 0.2.0: `update` / `stop`, the Stop hook, the Clock-1 learning passes, and killing `why`.
- **The 3 READMEs are rewritten** (root / `cli/` / `web/`). Still stale: `package.json` ×3 + the whole site —
  tracked in `handover-copy-rewrite.md`.
- **`why` / `cli/src/match.ts` are NOT yet killed** — still in the tree; killing them is step 1 of the seam build.
- **Live doc set** (the working docs; this handover is just their origin):
  - `build-pass-learning-profiler.md` — the 0.2.0 hub (learning passes, product framing §8, the adapter seam +
    person-layer / `HUMAN.md` §9).
  - `presentation.md` — the public spine (Problem · Framework · Outcome), with the framework **The Person Layer**
    (`AGENTS.md` ↔ `HUMAN.md`) and "Profile, not Prompt."
  - `adapter-seam-spec.md` — the build spec for the seam (ports-and-adapters; format-drift handling).
  - `adapter-triage.md` — 8-tool compatibility triage (every CLI a GO, every GUI a PARTIAL).
  - `token-economics.md` — cost model + the `usage` meter (the ~17–24k harness-overhead finding).
  - `handover-copy-rewrite.md` — the remaining marketing-copy work.
- **Corpus-number note:** §2 and §8 cite the **original hand-count — 166 sessions / 5,291 messages** — and §2's
  derived stats ("1,200 of 1,572", "233×", "912×") depend on it, so those numbers stay. The built exchange-parser
  reports **84 sessions / 3,756 exchanges** over the *same* corpus; an "exchange" is stricter than a "message"
  (it needs the assistant to have spoken between two human turns) and is deduped. Both describe the same data.
- **Fresh session? Start from `presentation.md` + `build-pass-learning-profiler.md`, not from §9 below** — the
  "CLI rebuild" of §9 is already underway.

---

## 1. The keystone

Everything — every command, every line of landing copy — derives from this one paragraph. Nail it
first; the rest is downstream.

> **stratless builds your AI a living model of who you are — what you know, how you think, what
> you're building — so it stops making you feel stupid.**

The pain it kills, in the user's own words: **"i feel stupider."** The AI has no model of what the
human knows, so it has only two registers — **silence or jargon**. stratless gives it the missing
third thing: a picture of the person.

Taglines are chosen during the landing rewrite (§7). Do **not** lock one here.

---

## 2. The turn — why the whole project changes

Measured over Sun's real corpus (166 sessions, 5,291 of his messages):

- **1,200 of 1,572 times** the assistant asked him something, he **did not answer it** — he bounced
  (asked back) or redirected (cost, direction, "are we on the right track"). The AI never noticed.
- His confusion is never "what is X" in the abstract — it's **"what does this mean for us?"** (233×).
  Explanation with no consequence attached is noise to him.
- He is **fluent**, not a beginner (`api`, `commit`, `schema`, `deploy` used casually 900+×). The
  blocker was never the tech. It was **meaning and altitude.**

The old product answered "which commit wrote this line." The real problem is "the AI doesn't know
who it's talking to." Different product. Hence the rewrite.

---

## 3. How it works (the mechanism)

No ML. No server. No API key. No database. It rides the user's own assistant, exactly like the
current `explain.ts` borrows `claude -p` for one sentence.

1. **Capture** — Claude Code already writes every session to `~/.claude/projects/**/*.jsonl`.
   `init` disables the 30-day reaper (`cleanupPeriodDays: 3650`) and archives to `~/.stratless/`.
   This half already ships and works.
2. **Judge (small read, per exchange)** — walk the log into `(AI turn → human reaction)` pairs.
   Hand each pair to the local `claude -p`: *"Did understanding transfer? About what?"* One line
   back. **Cache it — each exchange is read once, ever.**
3. **Synthesize (big read, over the pile)** — hand the whole stack of judgments to `claude -p`:
   *"Describe what he knows, what he doesn't, what he's building."* Out comes the profile.
4. **Load** — the profile is injected into the assistant's context at session start. Silent.

**Cost:** first run chews the backlog (a few hundred small Haiku reads, one time). Every session
after adds only its handful of new exchanges + one synthesis pass. It spends the user's own plan
tokens; there is no separate bill. **The rule that keeps it cheap: never re-read what's already read.**

**Trigger / stealth:** default is refresh **after each session** via a **silent Claude Code Stop
hook** (runs, prints nothing, updates the file). Pure on-demand also works and is the fallback for
assistants without hooks.

---

## 4. The profile shape

Not a rules sheet ("this is how you talk to me" — Sun rejected that outright as "more paper"). A
**model of a person**, reasoned *from*, not a list of behaviors.

**Do not impose a fixed reaction taxonomy.** We tried bucketing his reactions into 3 types and 79%
didn't fit. Categories must **emerge** from the data. The only fixed question per exchange is *"did
understanding transfer, and about what?"* — the minimum needed to learn known / not-known / goal.

The profile has **layers on different clocks**:

| Layer | Changes | Trust |
|---|---|---|
| what you **know** | fast (daily) | refresh constantly |
| how you **think / talk** | medium (weeks) | fairly stable |
| how you **work** | slow (months) | stable |
| what you're building & **why** (direction) | only on a pivot | bedrock — lean on it hard |

It never saturates: the style layer converges fast (that's the product *winning*, not going
useless), the knowledge layer chases a moving target forever.

**Two audiences, same data, two renderings:**
- **profile** = the **AI's** copy — what loads into its context.
- **report** = the **human's** copy — what Sun reads.

---

## 5. Command surface rewrite (the functions)

| Command | Status | Job |
|---|---|---|
| `init` | **keep** | turn it on + install the silent after-session Stop hook |
| `stats` | **keep, expand** | raw counts — instant and **free** (no `claude` call, no tokens). The one command that never spends a read. Add more metrics. |
| `profile` | **new** | show the AI's model of you (also the copy-paste export for any other assistant) |
| `report` | **new** | the human digest: patterns, the "you felt stupid here" moments, the trend |
| `update` | **new** | manual refresh (normally automatic via the hook); incremental — only sessions newer than the last profile |
| `stop` / `pause` | **new** | trust control: stop it, or exclude a project. If it silently reads everything, being able to shut it up is half of why people trust it. |
| `why` | **KILL** | the old point-at-a-line tool. Delete the command, the help text, and `cli/src/match.ts` (the git-blame engine) entirely. |

**Guardrail (Sun's own rule):** every command is his to maintain forever, solo. The bar to add one
is *does it do a distinct job.* This set does; much past it won't.

**Code to delete:** `cli/src/match.ts` and its tests, the `why` branch in `cli/src/index.ts`, and
the `render()` verdict UI. **Code to keep and build on:** `transcript.ts` (the JSONL parser — the
`bodiesOf` Edit/Write/MultiEdit handling is hard-won, don't regress it), `init.ts` (reaper +
archive), `explain.ts` (the `claude -p` borrow — the profiler's synthesis reuses this pattern),
`canary.ts` (format-drift refusal — still applies; if the log format changes, refuse, don't lie).

---

## 6. What's shipped vs designed (honest state — do not blur this)

- **Shipped:** `stratless@0.1.0` on npm — the OLD shape (`init` / `why` / `stats`), signed via OIDC
  provenance, zero deps. `init` is genuinely useful and stays: it protects + archives the data,
  which is the foundation the profiler reads.
- **Built this session (was "designed"):** the profiler pipeline core (§3) — `exchange.ts` / `judge.ts` /
  `claude.ts` / `synthesize.ts` + `profile` / `report`, verified on real logs. **Still designed, not built:**
  `update` / `stop`, the Stop hook, and the Clock-1 learning passes. That is the rest of 0.2.0.
- **Copy state:** the 3 READMEs are rewritten; stratless.com + the `package.json` descriptions still sell the
  code-provenance tool (§7, and `handover-copy-rewrite.md`).

---

## 7. Copy rewrite — exact targets (from a 2026-07-15 grep)

Every string below sells the old product. All must move to the keystone (§1).

**Root**
- `package.json:4` — description `"Your AI wrote your product. Ask it why."`
- `README.md` — L3 tagline, L38 `stratless why` in the command list

**Web (stratless.com)**
- `web/nuxt.config.ts:1,3` — `TITLE` + `DESC` (the site-wide SEO/OG copy — high priority)
- `web/pages/index.vue:21,48,125` — hero `<h1>Your AI wrote your product. Ask it why.</h1>`, the sub-copy, the `✓ matched` verdict demo
- `web/package.json:5` — description
- `web/README.md:6`
- `web/content/docs/1.why.md` — whole page is the old `why` command
- `web/content/docs/4.how-it-works.md` — git-blame mechanism
- `web/content/docs/index.md:7,10,32` — tagline + `stratless why` example

**CLI**
- `cli/README.md:3,42,68` — tagline, command list, verdict table
- `cli/package.json:4` description, `:38-39` keywords (`provenance`, `git-blame` → wrong)
- `cli/src/index.ts:3,5,130,133` — header comment + `--help` text

**Docs:** the entire `web/content/docs/` tree assumes the old product — plan a fresh docs set
around `init` / `profile` / `report`, not `why`.

---

## 8. The sample profile (proof the mechanism works)

Generated this session from Sun's real logs (synthesis done by the assistant; in-product it's the
local `claude -p`). It passed his own test — *"the first read feels great, it's good"* — and it
corrected two of the assistant's standing assumptions (that he's cost-driven; that he's shaky on
implementation). Use it as the reference for tone and sharpness — specific, not a horoscope.

```
WHO YOU'RE WORKING WITH — Sun          (stratless · 166 sessions · 5,291 messages)

Fluent builder, not a beginner — uses api/commit/schema/deploy casually, 900+×.
Don't explain the stack. He ships.

What stalls him is never the tech — it's MEANING. His commonest move when stuck
isn't "what is X" but "what does this mean for us?" (233×). Abstract explanation
with no line to the product is noise. Attach the consequence or don't say it.

Thinks out loud (avg message 659 chars). Not giving orders — reasoning. Be a
thinking partner. "ok" (912×) usually means "ok, and here's the next thing" — he's
driving; keep up, don't stop and wait.

"no" (26×) rejects the whole FRAME, not a detail. Don't patch — rethink.

Lives in understanding + direction, outweighing cost ~4 to 1. Holds the product.
Nearly everything he asks is really "are we still on the right track?"

Failure signal: "what does this mean" / "i feel stupider" / "cant keep up" /
going quiet. Every time = you went abstract or long. Back up, get concrete.
```

---

## 9. Build sequence

```
keystone (§1)  →  CLI rebuild (0.2.0)  →  landing + docs rewrite  →  FLIP TOGETHER
```

**The one rule that sequences it:** the landing describes what people can *install.* Draft copy
whenever (cheap, reversible), but the **public flip** — new site + new CLI — goes live together, or
the site sells a profiler nobody can download (the quiet-lie trap). The published CLI is the
careful one-way door; everything else is reversible.

---

## 10. Release & deploy mechanics (carried from this session)

- **Ship the CLI:** bump `cli/package.json` version → tag `cli-v<version>` → push the tag.
  `.github/workflows/publish.yml` runs on the tag: re-tests, checks tag == version, publishes over
  **OIDC Trusted Publishing (no token)** with `--provenance`. Needs npm ≥ 11.5.1 (the workflow
  upgrades it; Node 22 ships npm 10, which silently 404s on OIDC).
- **Verify OIDC anytime:** run `publish.yml` manually — it re-publishes the current version, npm
  authenticates then rejects the duplicate, and *"cannot publish over previously published
  versions"* is the **pass** (green by design).
- **Deploy the site:** push to `main` touching `web/**` → `web.yml` → `nuxi generate` → Pages
  deploy → smokes `/` and `/docs/`. Verified `deployed == origin/main`.
- **Secrets:** `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (Pages: Edit only). No npm token.
- **Discipline (CLAUDE.md):** never auto-commit; stage/commit explicit pathspecs; leave the tree
  green + uncommitted; Sun commits. `cli/` must stay dependency-free (it's published standalone).

---

## 11. Open questions — unproven, do not paper over

- **Monetization.** The file is free and should be — a text profile is copy-pasteable; never
  paywall it. What's left to pay for is *staying true* across assistants, continuously. Whether a
  solo human pays for that is unsettled. Old bet: "free for humans, paid by machines/teams at
  scale." A hypothesis, not a model. Don't invent a moat.
- **Does the profile stay good at scale?** One sample (Sun's) read well. N-of-1. Untested on anyone
  else.
- **Adoption.** The pain is real and probably widespread, but "millions like me" is a belief, not a
  number. The gap between *people feel this* and *people install a CLI that reads their chats* is
  where products die.

---

*End of handover (the origin brief). For current state and the live doc set, see the **Current state**
block near the top — start there, not at §9 (the CLI rebuild is already underway).*
