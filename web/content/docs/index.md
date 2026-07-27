---
title: Install
---

# stratless

**Your AI has no idea who it's talking to.** So it explains everything at one altitude: over your head, or under it.

stratless reads your coding assistant's own session history, the conversations it already keeps on your disk, and records what you actually did in each exchange. From that it writes a **HUMAN.md**: a short brief on you — what to offer you before you ask, what to catch for you, and how to talk to you. Your assistant loads it at the start of every session, so it meets you at your level.

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

1. **Stops the reaper.** Claude Code deletes your transcripts after 30 days, per file, so your history rots from the back even in a project you open every day. `init` stops that and archives everything it can still reach. Whatever has already aged out is gone. This is the only part of stratless you cannot do later.
2. **Turns it on.** From here, stratless keeps your history, and after each session it reads what is new in the background and keeps your profile current. `stop` turns that off whenever you want.

Building the full profile is a separate yes: `init` shows you a free read and an honest quote first, and if you say yes it fetches the local engine once — a ~3MB runtime plus a ~34MB open-weights model, itemized before you answer — and the pattern-finding runs on your machine, offline, from then on. The npm package itself has zero dependencies; nothing heavier than the tool arrives until that yes.

## The commands

```
stratless mirror     a free read of you and your AI, changes nothing
stratless init       keep your history, and build your profile
stratless profile    see the model of you, free and instant
stratless update     read what is new, rebuild and load it
stratless stop       turn it off, and unload the profile
stratless status     its own state, and what it has cost
```

Full reference on the [Commands](/docs/commands) page.

## Requirements

- **Node 18+**
- **Claude Code**, the only assistant supported today. Others roll out one batch at a time. See [Assistants](/docs/assistants).
- **No API key.** Reading and grouping your history run locally; stratless borrows the assistant you already have (`claude -p`) only to name what it found and write the profile, on your own subscription. Nothing new to install, and no separate bill.
