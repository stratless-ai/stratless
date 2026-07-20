# How stratless works, start to finish

Every stage, in the order it runs, with the file that owns it. Written 2026-07-20.

**The one job:** read the conversation between a human and their AI, and write `HUMAN.md` — so the
AI understands the human without the human having to explain themselves.

---

## The roles

Eight hands touch the file. Each one does a different job, and none marks its own work.

| | role | file |
|---|---|---|
| **listens** | decides who is speaking | `reader.ts` |
| **counts** | tallies what needs no interpretation | `mirror.ts` |
| **sees** | witnesses one moment | `judge.ts` |
| **thinks** | finds what recurs across moments | `miner.ts` |
| **doubts** | re-reads the evidence and evicts what does not fit | `miner.ts` → `auditPatterns` |
| **remembers** | holds every pattern to its prediction over time | `miner.ts` → `gradePatterns` |
| **delivers** | writes the file | `synthesize.ts` |
| **refuses** | blocks anything malformed from ever loading | `synthesize.ts` lints · `canary.ts` |

**Missing, and worth knowing:** nothing reads the finished file back and asks *"is this person
actually like this?"*, and nothing asks *"did holding this file make the AI understand them better?"*
Every existing check validates the previous **stage**; the chain stops exactly where it meets a human.

---

## The flow

### 1 · Install — `init.ts`

Turns off Claude Code's 30-day transcript reaper, copies everything to `~/.stratless/archive` so
history stops expiring, and with `--auto` installs a **Stop hook**. That hook is the only thing that
ever starts stratless by itself.

### 2 · A session ends — the doorbell

The hook runs `stratless update`. `index.ts` checks the lock and, if nothing is running, spawns a
detached worker and hands your terminal straight back.

### 3 · The worker — `loop.ts` · `worker.ts`

`worker.ts` takes a hard-linked lock — **one worker, ever** — and captures the absolute path to your
`claude`. `progress.ts` narrates to disk so a terminal can tail it. `stopwatch.ts` times each stage;
`usage.ts` snapshots the meter so the run can hand back a receipt.

### 4 · Read — `reader.ts` → `exchange.ts`

**`reader.ts` is the only thing that decides what counts as you talking.** It walks both roots
(`~/.claude/projects` and the archive), newest-modified first, and removes six things — each found by
getting it wrong first:

1. **our own footprints** — every borrowed `claude -p` call is itself logged to the folder we read
2. **subagents and bookkeeping**
3. **harness wrappers** — blocks injected into a message you never typed
4. **replays** — resuming a session rewrites its history to disk
5. **drafts** — editing before sending archives every superseded version
6. **interrupts**, separated from messages: a control action is not a message

> Seven earlier passes each decided this for themselves and produced seven different message counts,
> spanning 44%. That is why this module exists.

**`exchange.ts`** then pairs clean turns into **exchanges** — `prompt → said → reaction` — and
content-hashes each. That hash is the cache key, so a moment is read **once, ever**.

Note the overlap: your messages are shared. Message N is the *reaction* of one exchange and the
*prompt* of the next.

### 5 · Judge — `judge.ts` · `stream.ts` · `claude.ts`

**The judge is a witness, not an assessor.** It records what a moment was ABOUT and what the person
DID. It does not rule on whether they understood.

`judge.ts` fits the reading aperture to your own history, then hands the batch to **`stream.ts`**,
which spawns one `claude -p` and feeds it 8 exchanges per session, tool-less, with a JSON schema
enforcing the reply shape. `claude.ts` is the one-shot fallback when streaming dies.

Everything lands in `judgments.json`, cached forever by hash.

### 6 · Gate — `state.ts`

`synthesisDue()`: 25 fresh judgments, or 7 days. Below that the worker banks the evidence and stops.
**This is why most sessions cost cents.**

### 7 · Think, doubt, remember — `miner.ts`

- **`mine()`** — 60 judgments per call, assigns them to patterns. **5 receipts** to be admitted.
- **`auditPatterns()`** — a separate mind re-reads each pattern's receipts and **evicts** the ones
  that do not fit. The miner does not get to mark its own work.
- **`gradePatterns()`** — every pattern is a dated prediction, scored *confirmed / silent /
  **surprised***. Two surprises in fourteen days and it is revised or retired.

→ `patterns.json`

### 8 · Deliver — `synthesize.ts`

Admitted patterns plus your most recent judgments become the sectioned file. Two lints can refuse it:
**`inventedNumbers`** (every number must already appear in the input) and **`artifactShapeProblem`**
(assistant chatter never loads as a profile).

### 9 · Load — `sink.ts` · `atomic.ts`

Writes `~/.claude/HUMAN.md` and upserts a managed `@import` into `CLAUDE.md`. `atomic.ts` writes
temp-then-rename, so a crash leaves the old file or the new one, never half of each.

### 10 · Record

`state.ts` stores the gate state, the render, and the frozen build corpus. `usage.ts` emits the
receipt. The lock releases and the worker exits.

---

## Surfaces — `index.ts`

`profile` · `profile --read` · `patterns` · `receipt <n>` · `status` · `stats`.
All free, all instant, **none of them spend**. `canary.ts` refuses when the log's shape drifts.
`notify.ts` is the only network call in the product.

---

## Where the money goes

**Five stages spend: judge · mine · audit · grade · write.** Everything before them is code;
everything after them is display.

The binding constraint is **not dollars — it is plan capacity.** Borrowed calls draw on a five-hour
rolling window with overage rejected, so a large read competes with the person's own work. Roughly
140 judge calls visibly degraded that window; the full corpus is ~4,500 exchanges.

---

## Known gaps

- **`mirror.ts` has no production caller.** 22 free metrics, four seconds, zero model calls — built,
  tested, unwired.
- **The mirror→judge channel is nearly empty.** Only interrupts and tool declines pass, and those
  land on **3.6%** of exchanges.
- **Nothing checks the finished file** against the person, or against whether it helped.
- **`index.ts` (972 lines) and `miner.ts` (826)** are each doing several jobs and want splitting.
