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

Nobody decided 30 minutes. It got picked for you, on a Thursday, while you were thinking about
something else. **Now you know.**

---

## Install

```
npx stratless init
```

No account. No API key. No cloud. It reads files that are already on your disk.

```
stratless init     stop the 30-day reaper · archive your history
stratless stats    what your assistant has actually been doing
stratless why      the decision that made this line
```

---

## There's no trick

There's no model. No cloud. No training. No inference bill.

**The conversation was on your disk the whole time.** Every assistant that can resume a chat has
to store the chat — Claude Code keeps it in `~/.claude/projects`, and **deletes it after 30 days.**
Nobody reads it.

stratless reads it. It finds the exact edit that wrote your line, pulls up the words *you* said at
the time, and shows you the receipt. **Nothing is generated.** It's quoting.

The one sentence that *is* generated — the *"So what"* — is written by **the assistant you already
have** (`claude -p`), on your own plan, grounded in your own diff. If it can't answer honestly, it
says nothing at all.

Four answers, and **three of them are refusals**: `matched` · `likely` · `yours` · `lost`.

---

## What's in here

```
cli/    the tool. ~900 lines of TypeScript. npm: `stratless`
web/    stratless.com — Nuxt, no modules, prerendered to static HTML
```

**The tool is in `cli/`. It is about nine hundred lines. Read it.**

That is not a slogan — it's the point. This thing reads your entire conversation history, so the
first question any sensible person asks is *"is it phoning home?"* At 900 lines you can audit the
whole thing in an afternoon and satisfy yourself. At 50,000 nobody checks, and *"trust me"* is
exactly the thing we're not allowed to say.

**The line count is the trust argument.**

## Develop

```
pnpm install
pnpm test        # the CLI's tests
pnpm dev:web     # stratless.com, locally
```

---

MIT. Free forever.
