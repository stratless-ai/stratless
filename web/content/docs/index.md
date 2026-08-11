---
title: Install
---

# stratless

**Your AI has no idea who it's talking to.** So it explains everything at one altitude: over your head, or under it.

stratless reads your coding assistant's own session history, the conversations it already keeps on your disk, and records what you actually did in each exchange. From that it builds each pair's **evidence** — what you do repeatedly, what went wrong and cost you, what you keep having to ask for — and turns it into **skills your assistant actually gains**, through one sitting: measure, hear the proposal with the receipts behind it, one yes installs. Everything is measured inside one working relationship; nothing observed in one tool is ever presented to another.

It runs on your machine. There is no account, no API key, no cloud, and no server.

## Install

Try it first. No account, no setup, nothing touched:

```
npx stratless
```

A free read of you and your AI, computed from the history already on your disk. It changes nothing and keeps nothing. When you want to keep it:

```
npx stratless init
```

That does two things, and the first one is urgent:

1. **Stops the reaper.** Claude Code deletes your transcripts after 30 days, per file, so your history rots from the back even in a project you open every day. `init` stops that and archives everything it can still reach. Whatever has already aged out is gone. This is the only part of stratless you cannot do later. (Codex has no such timer; `init` still keeps its own copy of your rollouts.)
2. **Turns it on.** From here, stratless keeps your history, and after each session it reads what is new in the background and keeps your record's evidence current. `stop` turns that off whenever you want.

Building the full evidence is a separate yes: `init` shows you a free read and an honest quote first, and if you say yes it fetches the local engine once — a ~3MB runtime plus a ~34MB open-weights model, itemized before you answer — and the pattern-finding runs on your machine, offline, from then on. The npm package itself has zero dependencies; nothing heavier than the tool arrives until that yes.

## The commands

| command | what it does |
| --- | --- |
| `stratless mirror` | a free read of you and your AI, changes nothing |
| `stratless init` | keep your history, and build your record's evidence |
| `stratless tune` | the sitting: measure, hear the proposal with receipts, one yes installs |
| `stratless update` | read what is new, keep the evidence current |
| `stratless stop` | turn it off, and remove everything installed |
| `stratless status` | its own state, and what it has cost |

Full reference on the [Commands](/docs/commands) page.

## Requirements

- **Node 18+**
- **macOS or Linux.** Native Windows is not supported yet; run stratless inside WSL.
- **Claude Code or Codex** — the two assistants stratless reads today, and either is enough. Use both and each pair gets its own evidence, derived only from the history you made together. The sitting runs per pair and installs through each tool's own skill door. See [Assistants](/docs/assistants).
- **No API key.** Reading and grouping your history run locally; stratless borrows the assistant you already have (`claude -p`, or `codex exec`) only to name what it found, word the evidence, and propose the skills, on your own subscription. Nothing new to install, and no separate bill.
