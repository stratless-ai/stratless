# stratless

**stratless builds your AI a living model of who you are (what you know, how you think, what
you're building), so it stops talking over your head, or under it.**

Your coding assistant has no idea who it's talking to. So it only has two registers: silence, or a
wall of jargon. stratless gives it the missing third thing, a picture of *you*, read from the
conversations you've already had.

No model. No server. No API key. No account. It reads the transcripts already on your disk and
borrows the `claude` you already have to make sense of them. **Nothing leaves your machine.**

---

## What's in here

```
cli/    the tool. TypeScript, no runtime dependencies. npm: `stratless`
web/    stratless.com — Nuxt, no modules, prerendered to static HTML
```

Install and usage live in **[cli/README.md](cli/README.md)**. The pitch lives at
**[stratless.com](https://stratless.com)**.

## Read the source — that's the point

This thing reads your entire conversation history, so the first question any sensible person asks
is *"is it phoning home?"* The whole tool is in `cli/`, small enough to read in an afternoon and
satisfy yourself that it isn't. That is not a slogan. **The line count is the trust argument.** At
fifty thousand lines nobody checks, and *"trust me"* is the one thing we're not allowed to say.

## Develop

```
pnpm install
pnpm test        # the CLI's tests
pnpm dev:web     # stratless.com, locally
```

The `cli/` is published standalone and must stay dependency-free. Never auto-commit. The tree is
left green and uncommitted for a human to review.

---

MIT. The profile is yours, it's a plain text file, and it's free forever.
