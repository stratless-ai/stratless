---
title: Install
---

# stratless

**Your AI has no idea who it's talking to.** So it explains everything at one altitude: over your head, or under it.

stratless reads your coding assistant's own session history, the conversations it already keeps on your disk, and judges whether understanding actually transferred in each exchange. From that it writes a **HUMAN.md**: a short profile of how you work, what you know, and where you get stuck. Your assistant loads it at the start of every session, so it meets you at your level.

It runs on your machine. There is no account, no API key, no cloud, and no server.

## Install

```
npx stratless init
```

That does two things, and the first one is urgent:

1. **Stops the reaper.** Claude Code deletes your transcripts after 30 days, per file, so your history rots from the back even in a project you open every day. `init` stops that and archives everything it can still reach. Whatever has already aged out is gone. This is the only part of stratless you cannot do later.
2. **Turns it on.** From here, stratless keeps your history. Add `--auto` and it also judges what's new in the background after each session, rebuilding your profile once enough has changed; plain `init` arms nothing you didn't ask for.

## The commands

```
stratless init       keep your history safe (add --auto for background refresh)
stratless profile    see the model of you (--read: your copy; profile looks, update loads)
stratless update     judge what's new; rebuild + load the profile when due (--now: always)
stratless patterns   the evidence behind your profile: every claim with its receipts
stratless stop       turn it off, and unload the profile
stratless status     stratless's own state: on or off, and what it has cost
stratless stats      raw counts, instant, free, no tokens
```

Full reference on the [Commands](/docs/commands) page.

## Requirements

- **Node 18+**
- **Claude Code**, the only assistant supported today. Others roll out one batch at a time. See [Assistants](/docs/assistants).
- **No API key.** stratless borrows the assistant you already have (`claude -p`) to read your history, on your own subscription. Nothing new to install, and no separate bill.
