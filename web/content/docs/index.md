---
title: Install
---

# stratless

**Your AI wrote your product. Ask it why.**

stratless reads your coding assistant's own conversation history — the one it keeps on your disk
and **deletes after 30 days** — and links any line of your code back to the decision that made it.

It runs on your machine. There is no account, no API key, no cloud, and no server.

## Install

```
npx stratless init
```

That does two things, and the second one is urgent:

1. **Stops the reaper.** Claude Code deletes your transcripts after 30 days — *per file*, so your
   history rots from the back even in a project you use every day.
2. **Archives everything it can still reach.** Whatever has already aged out is gone. This is the
   only part of stratless you cannot do later.

## The three commands

```
stratless init     stop the 30-day reaper · archive your history
stratless stats    what your assistant has actually been doing
stratless why      the decision that made this line
```

## Requirements

- **Node 18+**
- **Claude Code** — it's the only assistant supported today. Cursor, Windsurf, Cline and Codex all
  keep local logs too, and readers for those are next.
- **No API key.** If you want the plain-English *"So what"* line, stratless borrows the assistant
  you already have (`claude -p`), on your own subscription. If you don't have one, it degrades to
  showing you the quoted history and says nothing it can't back up.
