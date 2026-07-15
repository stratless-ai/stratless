# stratless — Assistant Adapter Triage

> Feasibility triage of 8 AI coding assistants against the **Source / Brain / Sink** seam (build-pass
> §9): can we do with each what we did with Claude Code? Researched 2026-07-15 by 8 parallel agents,
> one per tool, each verified against *current* (2025–2026) docs/source — not training memory. This
> doc informs *which* adapters to build and *when*; per §9 the recommendation is still **build the
> seam + the Claude Code reference first, defer the N adapters** until the profile is proven beyond
> N-of-1.
>
> **The triad recap.** *Source* = whose logs (local, parseable, resumable transcripts). *Brain* =
> who does the inference (a scriptable `claude -p` equivalent to borrow). *Sink* = where the profile
> lands (a file the tool auto-loads each session).

---

## Ranked summary

| Tool | S / B / S | Verdict | Effort | The catch |
|---|---|---|---|---|
| **Aider** | ✓ / ✓ / ✓ | **GO** | S | Cleanest fit — all three native. Small userbase; slow releases. |
| **Gemini CLI** | ✓ / ✓ / ✓ | **GO** | S–M | JSONL on by default, `gemini -p`, `GEMINI.md`. Internal schema (JSON→JSONL Apr '26). |
| **Codex CLI** | ✓ / ✓ / ✓ | **GO** | M | Full-replay JSONL, `codex exec`, `AGENTS.override.md`. GB-scale files; undocumented schema. |
| **Cline** | ✓ / ✓ / ✓ | **GO** | S–M | CLI 2.0 `cline --json -y`, `.clinerules`. Corruption bug deletes history; split stores. |
| **Copilot** | ✓ / ✓ / ✓ | **GO** | S–M | New CLI has *documented* store ("Chronicle") + `copilot -p` + global instructions. VS Code path fragile; cloud-sync default. |
| **Cursor** | ◐ / ✓ / ✓ | **PARTIAL** | M | CLI is clean JSONL; mainstream *IDE* chat is undocumented SQLite w/ data-loss reports. Biggest userbase, fragilest source. |
| **Zed** | ◐ / ◐ / ✓ | **PARTIAL** | M | Transcripts recoverable (SQLite+zstd, undocumented). No *shipped* headless brain — bring your own. |
| **Windsurf** | ◐ / ✗ / ✓ | **PARTIAL** | S* | **Mid-rebrand to "Devin" this month.** Transcripts are an opt-in hook that may not survive the rename. |

*(Reference: **Claude Code** = ✓/✓/✓, the baseline the seam is refactored out of.)*

---

## Five cross-cutting findings (these matter more than any single row)

1. **The CLI/GUI split is total — and the triad predicted it.** Every CLI is a clean GO; every GUI
   is a PARTIAL. CLIs are scriptable (they're their own Brain) *and* store cleaner transcripts; GUIs
   store undocumented DB blobs and have no native Brain. Source/Brain/Sink wasn't just a triage
   lattice — it's a genuine predictor of viability.
2. **Sink is nearly free and converging on a de-facto standard.** Almost every tool auto-loads a
   markdown instructions file, and they increasingly read *each other's* (`AGENTS.md` / `CLAUDE.md` /
   rules). One profile file could inject into several tools at once. The "apply" edge is the easy one.
3. **Source is the universal risk and the real maintenance burden.** *Every* tool's transcript format
   is undocumented, internal, and unversioned — and several already changed shape in 2026 (Gemini
   JSON→JSONL, Copilot json→jsonl, Zed JSON→SQLite). **So the per-Source canary ("refuse, don't lie"
   on format drift) is mandatory for every adapter, not optional.** `canary.ts` is vindicated hard.
4. **The Brain bottleneck resolves in stratless's favor: bring-your-own wins.** The GUIs mostly
   shipped *companion* CLIs that could serve as brains — but cloud-backed and separate; Zed shipped
   none. So the design of *borrowing whatever `-p` is present, or a local model (Ollama)* is the
   robust path regardless of which tool you're reading.
5. **Competitive signal.** Copilot already ships `/chronicle improve` — a first-party, *interactive,
   single-tool* version of stratless's idea. It validates the space and warns incumbents are circling.
   The differentiation they haven't built: **cross-tool, automatic, and local-forensic.**

---

## Per-tool detail

### Aider — GO (Effort S) — the cleanest fit
- **Source ✓** — `.aider.chat.history.md` (Markdown, self-parsing grammar: `# ` session header,
  `#### ` user, `> ` tool/system, plain = assistant; Aider ships its own `split_chat_history_markdown()`).
  Also `.aider.input.history`; opt-in `--llm-history-file` (raw LLM exchange). `--restore-chat-history`.
- **Brain ✓** — `aider --message "…" --yes-always [files]` (or `--message-file`). Model-agnostic via
  LiteLLM (`--model`, incl. Ollama) → **can be its own judge**.
- **Sink ✓** — `.aider.conf.yml` `read:` key auto-loads a file every session (searched home → repo →
  cwd); or per-run `--read`.
- **Risk** — slowed release cadence (last tag v0.86.0, Aug 2025); minor doc drift (`--yes` vs
  `--yes-always`); exact session-boundary header format unconfirmed (inspect a real file).

### Gemini CLI — GO (Effort S–M)
- **Source ✓** — `~/.gemini/tmp/<project_hash>/chats/session-<id>.jsonl` (JSONL, **on by default**;
  records: `session_metadata`, `user`/`gemini` messages, `$set` patches, `$rewindTo` markers;
  first-party `loadConversationRecord()`). Default 30-day retention (`general.sessionRetention`).
  `--resume` / `--list-sessions`.
- **Brain ✓** — `gemini -p "…"`, `--output-format json`, stdin piping; `--yolo` / `--approval-mode`
  for unattended.
- **Sink ✓** — `GEMINI.md` hierarchy (`~/.gemini/GEMINI.md` global + project), auto-loaded;
  `context.fileName` configurable; or `GEMINI_SYSTEM_MD` env for a full system-prompt override.
- **Risk** — internal JSONL schema (changed shape Apr 2026); parser must walk multi-record types and
  **fail loud** on unknown records.

### Codex CLI — GO (Effort M)
- **Source ✓** — `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` (JSONL; full replay is how
  `codex resume` works; `CODEX_HOME` overrides root). Files reach **GB scale** → stream-parse; cold
  files possibly zstd (unverified).
- **Brain ✓** — `codex exec "…"` (alias `codex e`); `--json` (NDJSON), `-o/--output-last-message`,
  `--ephemeral` (don't write a rollout), stdin `codex exec -`, `codex exec resume`. `CODEX_API_KEY`.
- **Sink ✓** — `~/.codex/AGENTS.override.md` (global, cleanest); precedence chain down to cwd;
  `model_instructions_file` (config.toml) for full replace; size cap `project_doc_max_bytes` (32 KiB).
- **Risk** — undocumented internal schema; `--json`/`--output-schema` reportedly *silently ignored*
  under MCP/tools (issue #15451) → smoke-test before relying on structured judge output.

### Cline — GO (Effort S–M)
- **Source ✓** — VS Code: `globalStorage/saoudrizwan.claude-dev/tasks/<task-id>/` →
  `api_conversation_history.json` + `ui_messages.json` + `task_metadata.json` (plain JSON per task).
  Standalone CLI 2.0: `~/.cline/data/tasks/` (same shape, **separate store**).
- **Brain ✓** — Cline CLI 2.0: `cline "…"` one-shot, `cline --json "…"` (NDJSON), `--yolo`/`-y`;
  headless on `--json`/piped stdin/redirected stdout. BYO key (`cline auth --provider … --apikey`,
  incl. Ollama-local). Caveat: headless is in the **CLI binary**, not the VS Code extension.
- **Sink ✓** — `.clinerules` (project `.clinerules/` or global rules dir), auto-appended each task;
  YAML frontmatter glob conditions. (Memory Bank is a *convention on top of* `.clinerules`.)
- **Risk** — no documented/versioned schema (issue #7742); a corruption bug has **silently deleted**
  history folders (issue #7101); two split stores → an adapter for one misses the other's users.

### Copilot — GO via the CLI (Effort S–M)
- **Source ✓ (CLI) / ◐ (IDE)** — GitHub Copilot **CLI** ships a *documented* store, "Chronicle":
  `~/.copilot/session-state/` (per-session events/JSONL) + SQLite `~/.copilot/session-store.db`,
  resumable (`copilot --resume`), queryable (`/chronicle search`). VS Code Copilot Chat:
  `workspaceStorage/<hash>/chatSessions/` (JSON pre-v1.109, **JSONL v1.109+**, undocumented) + a
  "Chat: Export Chat…" command. Cloud-sync **on by default** (`remoteExport: true`), opt-out; local
  copy exists regardless. (Old `gh copilot` extension deprecated Oct 2025.)
- **Brain ✓** — `copilot -p "…" -s` (one-shot, pipe-friendly); `--no-ask-user`, `--allow-tool`,
  `--model`.
- **Sink ✓** — `.github/copilot-instructions.md` (repo); `.github/instructions/*.instructions.md`
  (path-scoped); `AGENTS.md`/`CLAUDE.md` (settings-gated); **`~/.copilot/copilot-instructions.md`**
  (CLI global — cleanest).
- **Risk** — VS Code `chatSessions` format undocumented (already changed once). Note the first-party
  rival: `/chronicle improve`.

### Cursor — PARTIAL (Effort M) — biggest userbase, fragilest source
- **Source ◐** — **IDE** (mainstream): SQLite `state.vscdb` (global
  `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` + per-workspace
  `workspaceStorage/<hash>/state.vscdb`), `cursorDiskKV`/`ItemTable` keys `composerData:<id>`,
  `bubbleId:…` with JSON-blob values — **undocumented, reverse-engineered, data-loss reports.**
  **CLI** (`cursor-agent`): `~/.cursor/projects/<project>/agent-transcripts/<session>/<session>.jsonl`
  — clean JSONL, resumable. Two non-syncing stores.
- **Brain ✓** — `cursor-agent -p "…"`, `--output-format json`/`stream-json`, `--model`. Cloud-backed
  (`CURSOR_API_KEY`), not local weights. `-p` hangs reported.
- **Sink ✓** — `.cursor/rules/*.mdc` (`alwaysApply: true` = guaranteed inject); also auto-loads
  `AGENTS.md`/`CLAUDE.md`. User Rules global path unconfirmed. Precedence Team > Project > User.
- **Risk** — the IDE chat schema is undocumented/fragile and *separate* from the clean CLI JSONL. An
  adapter must **pick a lane** (CLI vs IDE) or maintain both.

### Zed — PARTIAL (Effort M)
- **Source ◐** — SQLite (`sqlez`/`ThreadStore`/`ThreadsDatabase`) under the Zed data dir
  `db/0-stable/` (macOS `~/Library/Application Support/Zed/db/0-stable/`, Linux
  `~/.local/share/zed/db/0-stable/`), **message bodies zstd-compressed**. OSS `zed-chat-export`
  decodes it (schema undocumented/unversioned; verified v0.225.9). Lower-effort alt: Zed's built-in
  "Open Active Thread as Markdown" + Thread History sidebar.
- **Brain ◐** — shipped `zed` CLI is editor-only (no headless). Only headless path is `eval_cli`
  (build-from-source, eval/benchmark-only, unsupported); open request #59146 for a real one. Ollama
  supported but interactive-only. **Mitigation: bring your own brain** (Ollama over HTTP).
- **Sink ✓** — `.rules`/"Instructions" (project; first-match priority incl. `.cursorrules`,
  `.clinerules`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`); global `~/.config/zed/AGENTS.md`.
- **Risk** — undocumented SQLite schema, liable to break on any Zed update; no supported headless brain.

### Windsurf — PARTIAL (Effort S, →M if the hook drops) — timing is the risk
- **⚠️ Mid-rebrand right now:** Cognition rebranded Windsurf → **"Devin Desktop"** (June 2, 2026);
  Cascade is being replaced by **"Devin Local"**; "Cascade remains available through July 2026."
  `docs.windsurf.com` 307-redirects to `docs.devin.ai`.
- **Source ◐** — no default full transcript ("Memories" are short notes,
  `~/.codeium/windsurf/memories/`). Opt-in **Cascade Hook** `post_cascade_response_with_transcript`
  writes full JSONL to `~/.windsurf/transcripts/{trajectory_id}.jsonl` — but requires user `hooks.json`
  config, is new (v1.9552.21), and is **Cascade-named** (may not survive Devin Local).
- **Brain ✗** — Windsurf/Devin Desktop exposes no headless inference. (The separate standalone Devin
  CLI has `devin -p "…"` but it's cloud-backed and *not* Windsurf.) → bring your own brain.
- **Sink ✓** — `~/.codeium/windsurf/memories/global_rules.md` (global, 6,000-char cap); `.devin/rules/*.md`
  / legacy `.windsurf/rules/*.md` / `.windsurfrules` (12,000-char, activation modes); enterprise
  system paths.
- **Risk** — the whole product is mid-rebrand, and the one mechanism that yields real transcripts is
  named after the agent being sunset this month. Load-bearing unknown: does the hook survive Devin Local?

---

## Recommendation

The seam clearly generalizes — build it + the Claude Code reference as planned. When the **first
non-Claude adapter** is built (deferred until the profile is proven beyond N-of-1):

- **Aider first, as the seam-proof.** Maximally *different* from Claude Code in shape (markdown
  history, `read:` config vs. JSONL + CLAUDE.md) yet Effort S and all-native — it proves the core
  imports nothing Claude-specific at the lowest cost.
- **Then Gemini CLI or Codex CLI** for reach — both GO, both major-vendor CLIs.
- **Defer the GUIs.** Cursor is the biggest prize but its mainstream surface is the fragile one;
  Windsurf is mid-rebrand. Revisit once the seam is proven.

**Honest coverage ceiling (for the copy):** stratless can cover the **CLI ecosystem cleanly**; GUI
coverage is possible but fragile and higher-maintenance. State that bound rather than implying
universal support.

**Design mandate carried out of this research:** because *every* Source schema is undocumented and
several move without notice, the per-Source **canary is required on every adapter** — parse into the
tool's own format, and if it drifts, refuse rather than lie. This is not adapter polish; it is the
condition of shipping any adapter at all.

---

## Method / provenance

8 general-purpose research agents, one per tool, run in parallel 2026-07-15. Each was instructed to
verify against *current* web docs and source (not training memory), cite URLs, and flag anything it
could not confirm. Effort ratings and paths reflect docs as of that date; every transcript format
here is an internal implementation detail, so **re-verify before building** — treat this as triage,
not a spec. Full per-tool source URLs are in the session transcript that produced this doc.
