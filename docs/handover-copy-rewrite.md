# stratless — Handover: The Copy Rewrite (the 0.2.0 flip)

> A self-contained brief for a session whose only job is to rewrite the remaining copy from the old
> product (code-provenance, `stratless why`) to the new one (the human profiler). Read this, plus
> `official-handover.md` §1/§7/§8/§9/§10 and `build-pass-learning-profiler.md`. **Also read
> `presentation.md`** — the framework this copy executes (the Person Layer, `HUMAN.md`, "Profile, not
> Prompt", the Problem·Framework·Outcome act order, and the do-not-say list) lives there. Written 2026-07-15.

---

## The keystone — everything derives from this

> **stratless builds your AI a living model of who you are — what you know, how you think, what
> you're building — so it stops making you feel stupid.**

The assistant has no model of the person, so it only has two registers — **silence or jargon**.
stratless gives it the third thing: a picture of the person. The audience for the *profile* is the
**AI**; the audience for the *copy* is a human deciding whether to install. The pain, in the user's
own words: **"i feel stupider."**

**Voice:** specific, never a horoscope (a line that could describe anyone is a failure — cut it).
Attach the consequence, not the mechanism. Plain words. The product would rather refuse than lie —
the copy should carry that same spine. Do **not** lock a single tagline; choose it during this pass.

---

## What's already done (do NOT redo)

The three READMEs are rewritten and now play distinct roles — keep them that way:

- **`README.md`** (root) — the monorepo/project view: keystone, repo layout, the "read the source,
  it's small, that's the trust argument" pitch, develop steps.
- **`cli/README.md`** — the npm package page: leads with `npx stratless init`, shows a real profile
  as the payoff, the command table, the mechanism, a hard privacy section.
- **`web/README.md`** — dev-facing; product-description line already fixed.

---

## What remains (this pass's work)

**Package copy:**
- `package.json` (root) — `description`.
- `cli/package.json` — `description` (line 4) **and** `keywords` (lines 33–40): drop `provenance`
  and `git-blame`; add profiler-shaped terms.
- `web/package.json` — `description`.

**The public site (this is the bulk):**
- `web/nuxt.config.ts` — `TITLE` + `DESC` (site-wide SEO/OG copy — high priority, sets the OG card).
- `web/pages/index.vue` — the hero `<h1>` still reads *"Your AI wrote your product. Ask it why."*;
  the sub-copy; and the `✓ matched` verdict demo block. **Replace the `why` demo with a profile
  demo** — a profile is the new money shot (use the §8 sample as the reference for tone).
- `web/content/docs/` — the entire tree assumes the old product. Plan a fresh docs set around
  `init` / `profile` / `report`, not `why`:
  - `1.why.md` — the whole page is the old `why` command. Repurpose or replace.
  - `2.stats.md`, `3.init.md` — keep the commands, rewrite around the profiler.
  - `4.how-it-works.md` — currently the git-blame mechanism; rewrite to read → judge → synthesize.
  - `5.limits.md`, `6.privacy.md`, `index.md` — re-point to the profiler + the privacy invariant.

---

## The command surface the copy should describe

Describe **what ships at the flip**, not vaporware. As of this writing:
- **Built and working:** `init`, `profile`, `report`, `stats`.
- **To be killed (not yet done):** `why` (and `cli/src/match.ts`) — do not mention it either way.
- **Designed, not yet built:** `update` (auto-refresh via a silent Stop hook), `stop` / `pause`
  (trust control). Only put these in copy once they ship — reconcile the command list to reality at
  the moment of the flip.

The mechanism to describe (all local, no server, no separate bill):
1. **Read** — Claude Code's own transcripts (`~/.claude/projects`) into `(AI turn → human reaction)`
   pairs.
2. **Judge** — borrow the user's own `claude -p` (Haiku): *did understanding transfer, about what?*
   One line, cached forever — each exchange read once, ever.
3. **Synthesize** — the whole pile → `profile` (the AI's copy) + `report` (the human's copy).

Privacy is load-bearing copy: **nothing leaves the machine** — not conversations, not judgments, not
the profile. No telemetry, no pooling, ever (the invariant from `build-pass-learning-profiler.md` §2).

---

## The one rule that sequences this (handover §9)

Draft copy whenever — it's cheap and reversible. But the **public flip goes live together**: the new
site and the new published CLI ship in the same move, or the site sells a profiler nobody can yet
install (the quiet-lie trap).

- **`cli/README.md` + `cli/package.json` publish *with* the CLI** — they go live on the npm publish
  (tag `cli-v<version>`), which is the careful one-way door.
- **The site deploys on push to `main` touching `web/**`** (`web.yml` → `nuxi generate` → Cloudflare
  Pages, smokes `/` and `/docs/`). So site copy is reversible in the tree but **live the moment it
  lands on `main`** — stage the site flip to coincide with the CLI publish.

**Discipline (CLAUDE.md):** never auto-commit; leave the tree green + uncommitted; Sun commits.

---

## The reference profile (tone + the site's new hero demo)

Use this as the model for the landing hero and the `profile` docs — specific, not a horoscope. Full
version in `official-handover.md` §8; the shipped tool prints it under a `WHO YOU'RE WORKING WITH`
header with a `(stratless · N sessions · M exchanges)` byline.

```
WHO YOU'RE WORKING WITH                    (stratless · 84 sessions · 3,756 exchanges)

Fluent builder, not a beginner — uses api / commit / schema / deploy casually, 900+×.
Don't explain the stack. They ship.

What stalls them is never the tech — it's MEANING. "what does this mean for us?" not
"what is X". Attach the consequence or don't say it.

Failure signal: "i feel stupider" / "cant keep up" / going quiet. Every time = you
went abstract or long. Back up, get concrete.
```
