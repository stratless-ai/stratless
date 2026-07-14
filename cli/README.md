# stratless

**Your AI wrote your product. Ask it why.**

```
$ stratless why src/lib/auth.ts:174

  const payload = { p: 'console', acct: opts.acct, exp: Date.now() + …

  ✓ matched  100% · written 2026-07-09

  You said   "lets plan it out properly first and enter plan mode for this…"
  It said    "Now I have the full GitHub flow. My plan for Layer 2: switch the sessio…"

  So what    Console sessions expire after 30 minutes with no refresh, so anyone
             testing the console during launch gets logged out mid-session and
             has to re-authenticate.

  git: 22a504fa 2026-07-09 — feat(api): accounts + Google login
```

Nobody decided 30 minutes. It got picked for you, on a Thursday, while you were thinking
about something else. **Now you know.**

---

## Install

```
npx stratless init
```

No account. No API key. No cloud. It reads files that are already on your disk.

---

## What it does

```
stratless init     stop the 30-day reaper · archive your history
stratless stats    what your assistant has actually been doing
stratless why      the decision that made this line
```

### `stratless stats`

```
  Your assistant, in this project

    lines it wrote            189,592
    edits it made               6,348
    files it touched            1,073
    sessions                       80
    days                           36
```

You wrote none of that. You have never read most of it.

### `stratless why <file>:<line>`

Point at any line. Get the conversation that made it, in your own words, and what it
costs you — in plain English.

Four answers, and three of them are refusals:

| | |
|---|---|
| **✓ matched** | found the decision, and `git blame` agrees |
| **~ likely** | found something, but the witnesses disagree — and it tells you how |
| **yours** | no assistant edit wrote this. **You did.** |
| **lost** | the conversation that explains this line was **deleted** |

---

## There's no trick

There's no model. No cloud. No training. No inference bill.

**The conversation was on your disk the whole time.** Every assistant that can resume a
chat has to store the chat — Claude Code keeps it in `~/.claude/projects`. Nobody reads it.

stratless reads it. It finds the exact edit that wrote your line, pulls up the words *you*
said at the time, and shows you the receipt. **Nothing is generated.** It's quoting.

The one sentence that *is* generated — the *"So what"* — is written by **the assistant you
already have** (`claude -p`), on your own plan, and grounded in your own diff. If it can't
answer honestly, it says nothing at all.

**Knowing how it works makes it better, not worse.**

---

## Why `init` matters, today

**Claude Code deletes your transcripts after 30 days.** Per *file* — so your history rots
from the back even in a project you use every day.

On the machine this was built on, everything before 9 June was **already gone**. Months of
decisions. The reasoning behind code that is still running in production. Deleted on a timer
nobody knew about.

`stratless init` stops the reaper and copies everything somewhere safe. It takes two seconds
and it is the only part of this you can't do later.

---

## What it can't do

- **Claude Code only, for now.** Cursor, Windsurf, Cline and Codex all keep local logs too —
  readers for those are next.
- **It can't explain code it never saw.** If you wrote the line, it says so. If the
  transcript was reaped before you ran `init`, it says that too.
- **A short, generic line can't be traced.** It'll widen to the surrounding block **and tell
  you it did.** A lead, not a fact.

It would rather refuse than guess. That's the whole point.

---

## Privacy

Everything runs on your machine. Your transcripts never leave it. There is no server, no
account, no telemetry, and nothing to sign up for.

The only network call is the optional *"So what"* line, which goes through **your own
assistant, on your own key or subscription** — the same place your code was already going.

---

MIT. Free forever.
