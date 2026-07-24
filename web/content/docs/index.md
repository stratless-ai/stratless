---
title: Install
---

# stratless

**Your AI has no idea who it's talking to.** So it explains everything at one altitude: over your head, or under it.

stratless reads your coding assistant's own session history, the conversations it already keeps on your disk, and records what you actually did in each exchange. From that it writes a **HUMAN.md**: a short profile of how you work, what you know, and where you get stuck. Your assistant loads it at the start of every session, so it meets you at your level.

It runs on your machine. There is no account, no API key, no cloud, and no server.

## Install

```
npx stratless init
```

That does two things, and the first one is urgent:

1. **Stops the reaper.** Claude Code deletes your transcripts after 30 days, per file, so your history rots from the back even in a project you open every day. `init` stops that and archives everything it can still reach. Whatever has already aged out is gone. This is the only part of stratless you cannot do later.
2. **Turns it on.** From here, stratless keeps your history, and after each session it reads what is new in the background and keeps your profile current. `stop` turns that off whenever you want.

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
- **No API key.** stratless borrows the assistant you already have (`claude -p`) to read your history, on your own subscription. Nothing new to install, and no separate bill.
