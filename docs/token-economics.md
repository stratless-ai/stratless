# stratless — Token Economics & the `usage` Meter

> A discussion-and-plan doc for a **solo session** dedicated to cost and token usage. Subordinate to
> `official-handover.md` and `build-pass-learning-profiler.md` (which points here from its §6). This
> captures what was *measured* on 2026-07-15, the *cost model* those measurements imply, the design
> of a user-facing `usage` meter, and the plan for the dedicated session. Nothing here is built yet.

---

## 1. Why this deserves its own session

stratless reads your whole history **and spends your plan's tokens**. For a product whose entire
pitch is *"here's the receipt, there's no trick,"* the token cost isn't a footnote — it's a
first-class trust surface. Getting it right means: knowing the real numbers, having levers to keep
them low, and showing the user exactly what stratless consumes. That's a session's worth of work,
not a paragraph.

---

## 2. Verified findings (measured 2026-07-15)

Real measurements from `claude -p` on the build machine. **Caveat:** these were run from inside a
live Claude Code environment; a clean benchmark from a neutral shell is the dedicated session's
first task (§7).

**(a) `claude -p --output-format json` returns exact usage — the meter can read truth, not estimate.**
The JSON carries `usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
`cache_read_input_tokens`), a `total_cost_usd`, and a per-model `modelUsage` breakdown (which model
ran, its in/out tokens, its `costUSD`). So the ledger and the live per-run receipt read the real
number from the horse's mouth.

**(b) The dominant cost is Claude Code's harness, not our prompt.** Every `claude -p` call loads
**~17–24k tokens** of built-in tool schemas + system prompt before it sees our ~1k judge prompt. It
is **largely irreducible**: `--system-prompt "…"` + `--setting-sources ""` still loaded ~17.7k
(the built-in tool schemas load regardless — the help text confirms "built-in tools … still apply").

**(c) Measured costs (API-equivalent; a subscription pays quota, not these dollars):**

| Call | tokens | cost |
|---|---|---|
| bare, **Opus** default (no `--model`) | 2 in · 7,163 create · 15,002 read · 4 out | **$0.080** |
| bare, **Haiku**, warm-ish | 10 in · 7,257 create · 17,098 read · 36 out | **$0.017** |
| **Haiku, cold** (system prompt changed → all creation) | 10 in · 17,688 create · 0 read · 31 out | **$0.036** |
| **Haiku, warm** (harness served from cache_read) | ~1k in · ~17k read · ~30 out | **~$0.003** |

The harness cache has a **1-hour TTL**. So the first call in a run pays cache-creation (~$0.035
Haiku); every call after, within the hour, pays cache-read (~$0.003). Warm sequential batches are
cheap; the enemy is **cold cache** — calls spread >1h apart, each paying a fresh creation.

**(d) Revised backlog estimate: ~$11–15 of Haiku (API-equivalent), not the earlier ~$5.** The delta
is entirely harness cache-read overhead (~17k tokens/call), not the judge prompt. On a subscription
this is **quota against Claude Code's rate limits, not a dollar bill** — the real question is whether
heavy judging trips weekly/5-hour caps (needs measurement, §7).

---

## 3. The cost model, per feature

| Feature | Model | Per-call token shape | Frequency | Cost driver |
|---|---|---|---|---|
| `init`, `stats` | none | 0 | on demand | **free** — never spends a read |
| **judge** | Haiku | ~1k prompt **+ ~17k harness** / ~30 out | once ever per exchange (or per batch — §4) | harness cache-read; cold-start per session |
| **pattern-miner** | Sonnet | mined patterns in / small out | per update (gated) | reads the pile — unless capped (§4) |
| **synthesize** profile/report | Sonnet | pile-or-patterns in **+ ~17k harness** / ~300 out | per generation (gated) | pile size × frequency + harness |
| **update** (hook) | Haiku + Sonnet | a batch of judges + one synthesis | per session, background | judging batch + one synthesis |

Two truths fall out: **output tokens are negligible everywhere** (a judgment is one line, a profile
~300 tokens) — the story is all input; and **every model call, judge or synthesize, pays the ~17k
harness** — so the number of *calls* matters as much as their content.

---

## 4. The levers (ranked)

1. **Batch N exchanges per `claude -p` call — the biggest lever.** Judge 15 pairs in one call and
   the ~17k harness is amortized ~15× (≈1.1k overhead/judgment instead of 17k). Could cut the backlog
   cost by an order of magnitude. **Tradeoffs to design:** coarser cache granularity (rejudge the
   batch of 15 if one changes — mitigate with small, stable batches), structured multi-line output,
   and a quality check that batched judging doesn't degrade the one-line-per-pair verdict.
2. **Cache-warm sequential batching.** Judge a whole session's new exchanges in one warm run so only
   the first call pays cache-creation. This is exactly what the amortize-over-sessions hook should do
   — one warm batch per session, not dribbled calls.
3. **Gate synthesis cadence.** One session's handful of new exchanges barely moves the profile — so
   re-synthesize on a threshold (≥N new judgments, or once/day), not every session. Each synthesis
   also pays the ~17k harness, so frequency is the driver.
4. **The pattern-miner caps synthesis input.** With the miner (build doc §3a), the writer reads the
   small mined `patterns.json`, not the ever-growing raw pile — so synthesis input stays roughly flat
   whether the corpus is 3k or 300k exchanges. The learning architecture *is* the cost-control
   architecture.
5. **Pin models per feature → deterministic, publishable cost.** Haiku for judge, Sonnet for
   miner/synthesis. If synthesis runs on "whatever the user's default is," the token evidence varies
   per user and can't be documented. Pinning makes the numbers stable enough to publish.

---

## 5. Model-per-feature map (from the Q2 discussion)

| Feature | Model | Why |
|---|---|---|
| `init`, `stats` | none | file ops / raw counts |
| judge (high-volume, narrow, one line) | **Haiku 4.5** | frontier is pure waste at this shape/volume |
| pattern-miner + synthesize (rare, subtle) | **Sonnet 5** | "read the shape of a person" rewards a stronger model; near-Opus at lower cost; infrequent |

Because stratless *borrows* the user's `claude`, "which model" is just "which alias we pass to
`claude -p`" — and when Anthropic ships a better Haiku or Sonnet, every profile sharpens for free
(Clock 2). Pinning is the bridge to §6: fixed models → exact, stable numbers to show the user.

---

## 6. The `usage` meter — design

A dedicated command (distinct job from `stats`: `stats` describes *your history*, `usage` accounts
for *stratless's consumption* — passes the handover §5 guardrail). Two faces:

- **Projection (before you spend) — free, no model call.** From `stats`-style counts × measured
  per-call constants: *"your backlog is 3,756 exchanges → ~X tokens to judge, one time; steady-state
  ~Y/session."* The bill, shown before you pay it — nobody else does this.
- **Actuals (after you spend) — a ledger.** Record real per-call `usage` (from the `--output-format
  json` block) to `~/.stratless/usage.json`, aggregated: *"judged 3,756 · A in / B out · last
  synthesis C · ~$D API-equivalent."*

Plus a **live per-run receipt** printed by `update` / `profile` / `report`: *"this run: judged 40, 46k
in / 1.2k out, on your plan."*

**Unit: tokens, not dollars.** For subscription users there's no bill — there's quota — so the honest
unit is tokens (and the fraction of the plan they represent, if we can estimate it). The
`total_cost_usd` from the JSON becomes a clearly-labeled *"≈ $X at API rates"* secondary, for the
API-key minority.

**Storage:** add `usage.json` to the `~/.stratless/` layout (build doc §4).

---

## 7. Open questions for the dedicated session

1. **Clean benchmark.** Re-measure exact per-feature in/out/cost from a **neutral shell** (not inside
   a live session), for judge (single vs batched) and synthesize (raw pile vs mined patterns). Today's
   numbers are directional; publish only measured ones.
2. **Batching design + quality.** Optimal batch size; output format; does batched judging degrade the
   per-pair verdict vs one-at-a-time? Cache-granularity vs amortization tradeoff.
3. **Cross-session cache warmth.** Can we keep the ~17k harness warm across sessions, or do we accept
   one cold-start per session? Does the 1h TTL vs a `ttl: "1h"`-style option change the math?
4. **Rate-limit reality.** Does draining the backlog trip Claude Code's weekly / 5-hour usage caps?
   Measure against a real plan — this, not dollars, is the subscription user's true constraint.
5. **Pin synthesis model, or use the user's default?** Pinning Sonnet = documentable + predictable;
   user-default = best available quality but variable cost. Decide.
6. **Publish the evidence.** Turn the measured numbers into a user-facing table (the "here's exactly
   what stratless costs you" doc/page) — the trust artifact.
7. **`usage`: own command vs facet.** Standalone `stratless usage` (projection + ledger) *plus* the
   inline per-run receipt — confirm both, and the exact output.

---

## 8. Plan for the session

```
measure (§7.1)  →  model (§3, §4 with real numbers)  →  design `usage` (§6)  →  publish evidence (§7.6)
```

Order matters: nail the measured per-feature numbers first (single vs batched judge; raw vs mined
synthesis), because every downstream decision — batch size, synthesis cadence, whether the backlog
is $3 or $15, what the `usage` command projects — hangs off them. Then lock the model map and the
levers to real figures, design the meter against them, and publish the evidence table.
