# stratless — Build Spec: The Adapter Seam

> Implementation spec for the **adapter seam** — the refactor that turns stratless from a Claude-Code
> monolith into **ports-and-adapters (hexagonal)**, with Claude Code as the *one* reference adapter.
> **Scope: the seam + the Claude Code reference ONLY.** The N other adapters (Aider, Cursor, …) are a
> separate, later effort, deferred until the profile is proven beyond N-of-1 (see `adapter-triage.md`
> and `build-pass-learning-profiler.md` §9). Subordinate to build-pass §9. Written 2026-07-15.

---

## 0. Scope — what this is and isn't

**IN:** the three ports (Source / Brain / Sink), a neutral core, the Claude Code implementation behind
each port, a small registry, and the format-drift defenses (§5). This also **completes the profiler**
(builds the missing *load* step — the Sink) and **kills `why`**.

**OUT:** any non-Claude adapter. The seam's whole job is to make those cheap *later* — it builds the
socket, not the plugs. If this spec ever finds itself parsing Cursor, it has overreached.

---

## 1. The shape — before → after

**Before:** organized by *module*, with Claude Code assumptions smeared across `transcript.ts`,
`exchange.ts`, `init.ts`, `canary.ts`, and `claude.ts`. No boundary. The precious **pair state
machine** (each human message = reaction + prompt) is glued to Claude Code's JSONL format inside
`exchange.ts`; to add a tool you'd fork it and copy the smart part.

**After:** organized by *role*. A neutral **core** that imports nothing Claude-specific, with all
Claude knowledge quarantined in three `*claude*` files behind ports.

```
              ┌──────────────  CORE  (neutral — imports nothing Claude)  ──────────────┐
  index.ts ─► │  seam.ts        Turn · Source · Brain · Sink (the ports)                │
              │  exchange.ts    ⭐buildExchanges(turns) · loadExchanges(sources)         │
              │  judge.ts (cache) · synthesize.ts · the cache + profile store            │
              └────────▲────────────────────────▲──────────────────────▲────────────────┘
                       │ Source port            │ Brain port           │ Sink port
             ┌─────────┴────────┐     ┌──────────┴───────┐   ┌──────────┴──────────────┐
             │ source-claude-   │     │ brain-claude-p   │   │ sink-claude-code [NEW]  │
             │ code.ts          │     │ .ts              │   │ CLAUDE.md block + hook  │
             └──────────────────┘     └──────────────────┘   └─────────────────────────┘
   adapters.ts = registry (detect the present ones).  0.2.0: only claude-code registered.
```

Data flow: `registry.sources() → parseTurns → Turns → ⭐buildExchanges → judge (Brain, cached) →
synthesize (Brain) → registry.sinks().injectProfile`.

---

## 2. The ports (interfaces)

```ts
// seam.ts — the neutral contract. Imports nothing tool-specific.

/** The normalized unit the core understands. A Source's whole job is to produce these. */
export type Turn = { role: 'human' | 'assistant'; text: string; ts: string };

export interface Source {
  readonly id: string;                 // 'claude-code'
  detect(): boolean;                   // is this tool present on the machine?
  transcripts(): string[];             // all transcript file paths (roots walked)
  parseTurns(path: string): Turn[];    // ONE file → normalized, FILTERED turns
  protect?(): ProtectResult;           // stop the tool's reaper / archive (optional)
  health(): Health;                    // the format-drift canary for THIS source (§5)
}

export interface Brain {               // the borrow — PROVIDER-bound, not tool-bound
  readonly id: string;                 // 'claude-p' | 'ollama' | 'api-key'
  available(): boolean;
  run(input: string, model?: string): string | undefined;
}

export interface Sink {
  readonly id: string;                 // 'claude-code'
  detect(): boolean;
  injectProfile(profileText: string): void;      // write to the tool's GLOBAL user file, managed block
  installRefreshTrigger?(command: string): void; // e.g. the Claude Code Stop hook
}
```

Note the asymmetry (from build-pass §9): **Source and Sink are tool-bound** (one per assistant);
**Brain is provider-bound** (you pick one; a CLI-type tool can advertise itself as a Brain, a GUI
must borrow one). A per-tool *Adapter* = a Source + a Sink; the Brain is a separate registry.

---

## 3. The seam boundary — the one rule that must not bend

**The Source produces `Turn`s; the CORE builds pairs.** The pair state machine lives in `exchange.ts`
and is written ONCE. A Source never builds an `Exchange`. Everything format-specific (find files,
parse JSONL/SQLite, drop sidechains / tool-results / machine-injected prompts, extract text) is in the
Source; everything generic (Turns → Exchanges → judge → synthesize → cache) is in the core.

**The add-a-tool test:** adding a tool costs *one new adapter file* and *zero* edits to the core. If it
ever forces a change to `exchange.ts` / `judge.ts` / `synthesize.ts`, the seam leaked — stop and fix
the boundary.

---

## 4. Module map & build order

| Target (flat) | What it holds | Comes from |
|---|---|---|
| `seam.ts` | the ports + `Turn` (tiny) | new |
| `exchange.ts` | **generic** `buildExchanges(turns)` · `loadExchanges(sources)` · hashing/dedupe | the generic half of today's `exchange.ts` |
| `source-claude-code.ts` | `parseTurns` (JSONL→Turns), `transcripts()`, `protect()`, `health()` | today's `transcript.ts` helpers + `exchange.ts` parse + `init.ts` + `canary.ts` |
| `brain-claude-p.ts` | the `claude -p` borrow | today's `claude.ts` |
| `sink-claude-code.ts` | **NEW** — CLAUDE.md managed block + Stop hook | new (the missing *load* step) |
| `adapters.ts` | registry + `detect()` (only `claude-code` for 0.2.0) | new (tiny) |
| — delete — | `match.ts`, the `why` branch, `render()`, the `Edit` machinery | — |

**Build order** (each step keeps the tree green):
1. **Kill `why`** — delete `match.ts` + the `why` branch + `render()` + `Edit`/`loadEdits`. This
   *untangles* `transcript.ts` (its Edit-parsing was the mess); killing `why` is the first step of the
   refactor, not a separate chore.
2. **`seam.ts`** — define the ports + `Turn`.
3. **`source-claude-code.ts`** — move Claude Code's parse (→ `parseTurns`), reaper/archive (→
   `protect`), and canary (→ `health`) behind the Source port. Keep the parser tests green (they now
   test `parseTurns` + the core's `buildExchanges`).
4. **`brain-claude-p.ts`** — wrap the borrow as a Brain.
5. **`sink-claude-code.ts`** — build the new Sink (managed CLAUDE.md block per §9 constraints +
   install the silent Stop hook).
6. **`adapters.ts`** — the registry; `detect()` present adapters.
7. **Rewire `index.ts`** — dispatch through the registry.

---

## 5. Format drift — detection & mitigation  ⚠️ the load-bearing concern

Every Source reads a third-party transcript format that is **undocumented, unversioned, and changes
without notice** (the triage saw Gemini JSON→JSONL, Copilot json→jsonl at v1.109, Zed JSON→SQLite —
all in 2026). The catastrophic failure is *silent*: the format moves, we parse garbage or nothing, the
profile rots or lies, and nobody notices for weeks. **This is the one failure that ends the product,
so drift handling is a condition of shipping any adapter — not per-adapter polish.**

### Detection — layered, at runtime, in each Source's `health()`

1. **The canary (strongest signal).** Files exist on disk with conversation-shaped content, but we
   parsed **zero** turns → the format moved. Generalizes today's `canary.ts` ("I can see write-tool
   calls in the log but extracted no edits").
2. **Structural assertions.** Each parser knows its expected markers (Claude Code: `type`,
   `message.content`, `isSidechain`; Gemini: a `session_metadata` first line + `user`/`gemini`
   records). If an expected marker is absent, or an **unknown record/message type** appears, fail
   loud — never skip-and-continue silently.
3. **Parse-coverage ratio.** A 500 KB transcript that yields 2 turns is drift. Track lines-seen vs
   records-parsed; if the unparseable fraction crosses a threshold, flag.
4. **Version drift (soft signal).** Record the tool version each Source was last validated against;
   if the tool's version moved (from `--version` or a version marker in the file), surface "reading an
   unvalidated <tool> version" — a prompt to re-verify, not a hard refuse.

### Mitigation — what happens on a drift signal

1. **Refuse, don't lie (the invariant).** On a hard drift signal the Source HALTS and the pipeline
   **does not update the profile with garbage** — it freezes at last-good rather than rotting. A
   confidently-wrong profile is the product-ending failure; silence beats it every time.
2. **Fail loud.** Print a clear message ("stratless can't read <tool>'s history — the format changed")
   plus an "open an issue" link. Never degrade silently.
3. **Per-Source isolation (a seam dividend).** One tool drifting halts only that Source; the others
   keep profiling. Cursor breaking never touches Claude Code.
4. **The cache protects the profile.** Judgments are read once, ever — so drift only affects *new*
   exchanges; cached judgments and the existing profile survive. Drift degrades gracefully: no new
   evidence from the drifted Source, nothing lost or corrupted.
5. **Golden-transcript regression tests.** Each Source pins a small real sample and asserts the exact
   turns it must extract (the existing "every test is a lie it told" pattern, per Source). Catches
   drift in *our own* code on every change, and lets an adapter fix prove it didn't regress.

### "How do we know at scale?" — the honest mechanism

We can't watch every vendor's releases, and **privacy forbids central telemetry** — nothing leaves the
machine, so there is no fleet dashboard of "adapter X broke for 4% of users," and third parties won't
announce internal format changes. So detection at scale is the loop:

> **refuse loud → the user files an issue → the maintainer ships an adapter fix** (a Clock 2 update).

The refusal turns each user into a clean drift sensor: because the tool refused instead of lying, the
signal is a bug report, not a silently-wrong profile. This **is** the ongoing maintenance burden the
triage flagged — the price of being local and private, and it is the honest mechanism. Optional
maintainer discipline: re-run each Source's golden test against a tool's major releases. That's manual,
not automatable.

---

## 6. Acceptance criteria

- **Proof of seam:** `grep -rl "claude\|\.claude" src/` matches *only* the `*claude*` files and
  `index.ts` help text — nothing in `seam.ts` / `exchange.ts` / `judge.ts` / `synthesize.ts`.
- All existing tests green; the parser tests now exercise `source-claude-code.parseTurns` + the core's
  `buildExchanges`.
- A **golden-transcript** test for Claude Code (a pinned real sample → exact expected turns).
- A **drift test:** a mangled/format-shifted transcript → `health()` refuses and the profile is **not**
  updated.
- `why` / `match.ts` / `render()` / `Edit` machinery are gone.
- The **Sink** writes a managed block to the global CLAUDE.md and installs the Stop hook; a profile
  round-trips (synthesize → inject → present).

---

## 7. Open design decisions

- **Flat files vs subdirectories** (`source-claude-code.ts` vs `sources/claude-code.ts`). Lean **flat**
  — the "read the whole thing in an afternoon" trust argument favors few files.
- **Cache + profile store stay in the core** — they're keyed by content hash and are tool-independent;
  only the *Sink* renders the profile out to a tool's file.
- **Brain registry** — `claude-p` only for 0.2.0; `ollama` / `api-key` are the obvious next Brains for
  GUI-only users (the Brain bottleneck, §9).
- **Managed-block format & size** — the `<!-- stratless:start -->…<!-- stratless:end -->` block, global
  scope, never a committed project file, respecting per-tool size caps (build-pass §9 Sink constraints).
