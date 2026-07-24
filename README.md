<div align="center">

<img alt="stratless" src="assets/logo-light.png#gh-light-mode-only" height="54">
<img alt="stratless" src="assets/logo-dark.png#gh-dark-mode-only" height="54">

<br><br>

**stratless builds your AI a living model of who you are (what you know, how you think, what you're building), so it stops talking over your head, or under it.**

[![npm](https://img.shields.io/npm/v/stratless?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/stratless)
[![tests](https://img.shields.io/github/actions/workflow/status/stratless-ai/stratless/cli.yml?branch=main&label=tests)](https://github.com/stratless-ai/stratless/actions/workflows/cli.yml)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-0-3fb950)](cli/package.json)
[![license](https://img.shields.io/npm/l/stratless?color=3fb950)](LICENSE)

[stratless.com](https://stratless.com) &nbsp;·&nbsp; [npm](https://www.npmjs.com/package/stratless) &nbsp;·&nbsp; [How it works](#how-it-works-theres-no-trick) &nbsp;·&nbsp; [Privacy](#privacy)

</div>

---

Your coding assistant has no idea who it's talking to. So it only has two registers: silence, or a wall of jargon. stratless gives it the missing third thing, a picture of *you*, read from the conversations you've already had.

```
npx stratless init
```

No account. No API key. No cloud. It reads transcripts already on your disk and borrows the `claude` you already have to read them. **Nothing leaves your machine.** All you need: Claude Code installed and signed in, Node 18+, and a few sessions of history.

## What it builds

<p align="center">
  <img src="assets/profile-hero.svg?v=2" alt="A sample stratless profile printed in a terminal, in sections When something has gone wrong and How they work, each line carrying its real count and a quote: insists on a plan before any code (256 times); muses openly about direction (876 times); gives a short signal to authorize the next step (727 times). Then stratless update loads it and the assistant talks to a person, not a blank." width="620">
</p>

Run `stratless profile` and it shows you the picture above, the one `stratless update` hands to your assistant. Not a rules sheet you wrote. A model of a person, reasoned from your real history, and it sharpens as that history grows.

Install and the full command list live in **[cli/README.md](cli/README.md)**.

## How it works, there's no trick

No model of ours. No server. No training. No inference bill. Four steps, all on your machine:

| Step | What happens |
| :--- | :--- |
| **1 · Read** | Every session is already on your disk in `~/.claude/projects`. stratless walks each one into moments: what you typed, and what the assistant was doing. |
| **2 · Discover** | It finds the recurring kinds of thing you actually do, from your own history and nothing it shipped. Derived, not pre-matched: there is no category list to sort you into. |
| **3 · Count** | Each moment is counted: how often, over what span, rising or fading. Every number is counted by code, never guessed. |
| **4 · Load** | It writes `~/.claude/HUMAN.md` and points your assistant's config at it, so your next session starts already knowing you. `stratless update` refreshes it; `stratless stop` unloads it. |

If the assistant can't answer honestly, it writes nothing: a confidently-wrong profile is the one failure that would end this, so silence always beats a guess.

## Read the source, that's the point

This thing reads your entire conversation history, so the first question any sensible person asks is *"is it phoning home?"* The whole tool is in `cli/`, open source under MIT, so you don't have to take that on trust: you can read exactly what it does and confirm the only network call is to your own assistant. *"trust me"* is the one thing we're not allowed to say.

## Privacy

Everything runs on your machine. **Your conversations, the moments stratless derives, and your profile never leave it**, not for telemetry, not for "aggregate insight," not ever. There is no server, no account, nothing to sign up for. The only network call is to your own assistant, on your own plan, the same place your code was already going.

The profile is a plain text file. It's yours: load it into any other assistant, read it, or delete it.

## What's in here

```
cli/    the tool. TypeScript, no runtime dependencies. npm: stratless
web/    stratless.com. Nuxt, no modules, prerendered to static HTML
```

## Develop

```
pnpm install
pnpm test        # the CLI's tests
pnpm dev:web     # stratless.com, locally
```

The `cli/` is published standalone and must stay dependency-free. Never auto-commit. The tree is left green and uncommitted for a human to review.

---

MIT. The profile is yours, it's a plain text file, and it's free forever.
