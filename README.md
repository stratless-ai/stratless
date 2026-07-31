<div align="center">

<img alt="stratless" src="assets/logo-light.png#gh-light-mode-only" height="54">
<img alt="stratless" src="assets/logo-dark.png#gh-dark-mode-only" height="54">

<br><br>

**stratless turns your own AI conversations into a brief your assistant reads — what to offer you, what to catch for you, how to talk to you — so it stops talking over your head, or under it.**

[![npm](https://img.shields.io/npm/v/stratless?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/stratless)
[![tests](https://img.shields.io/github/actions/workflow/status/stratless-ai/stratless/cli.yml?branch=main&label=tests)](https://github.com/stratless-ai/stratless/actions/workflows/cli.yml)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-0-3fb950)](cli/package.json)
[![license](https://img.shields.io/npm/l/stratless?color=3fb950)](LICENSE)

[stratless.com](https://stratless.com) &nbsp;·&nbsp; [npm](https://www.npmjs.com/package/stratless) &nbsp;·&nbsp; [How it works](#how-it-works-theres-no-trick) &nbsp;·&nbsp; [Privacy](#privacy)

</div>

---

Your coding assistant has no idea who it's talking to. So it only has two registers: silence, or a wall of jargon. stratless gives it the missing third thing, a picture of *you*, read from the conversations you've already had.

```
npx stratless
```

That's the free read: what your AI already knows about you, computed on your machine, changing nothing. Like it? `npx stratless init` keeps it — it stops Claude Code's 30-day transcript reaper, archives your history, and builds the full profile after asking you once.

No account. No API key. No cloud. The reading and the pattern-finding happen on your disk; the only borrowed thing is your own `claude`, which names what the maths found. **Nothing leaves your machine.** All you need: Claude Code installed and signed in, Node 18+, and a few sessions of history.

## What it builds

<p align="center">
  <img src="assets/profile-hero.svg?v=7" alt="A sample stratless profile printed in a terminal: who you're working with, one instruction per line with its real count. What to offer me before I ask: offer to confirm a specific bounded starting scope back to them before proceeding, 268 times. What to catch for me: catch any unmeasured cost claim, they want the real cost measured before it's trusted, 96 times. How to talk to me: talk in short exchanges, since a quick 'yes go ahead' means proceed now without re-explaining the plan, 149 times. Then stratless update loads it and the assistant talks to a person, not a blank." width="620">
</p>

Run `stratless profile` and it shows you the picture above, the one `stratless update` hands to your assistant. Not a rules sheet you wrote, and not a description of you either — a working brief for the AI: what to offer you before you ask, what to catch for you, how to talk to you, and what your shorthand means. Every line carries the real count behind it, and it sharpens as your history grows — a row can even gain a when-clause for a gap the engine measured, then shed it once the gap closes.

Install and the full command list live in **[cli/README.md](cli/README.md)**.

## How it works, there's no trick

No server. No training. No inference bill. Five steps, all on your machine — free maths, save for the short calls that name and word what it found, borrowed from the assistant you already have:

| Step | What happens |
| :--- | :--- |
| **1&nbsp;·&nbsp;Read** | Every session is already on your disk in `~/.claude/projects`. stratless walks each one into moments: what you typed, and what the assistant was doing. |
| **2&nbsp;·&nbsp;Cluster** | A small open-weights model on your machine turns each moment into a fingerprint, and the recurring kinds of thing you do fall out as groups. Free, offline, a few minutes. Derived, not pre-matched: there is no category list to sort you into. One short call to your own assistant names what the maths found. |
| **3&nbsp;·&nbsp;Count** | Each moment is counted: how often, over what span, rising, fading, or met (you stopped asking because the assistant already does it). Every number is counted by code, never guessed. |
| **4&nbsp;·&nbsp;Tune** | Each refresh runs the loop that keeps the profile true: wherever the assistant measurably failed you, a patch enters the file — and deletes itself the moment the failure stops. The file gets shorter as you get better. |
| **5&nbsp;·&nbsp;Load** | It writes `~/.stratless/HUMAN.md` and points your assistant's config at it, so your next session starts already knowing you. `stratless update` refreshes it; `stratless stop` unloads it. |

If the assistant can't answer honestly, it writes nothing: a confidently-wrong profile is the one failure that would end this, so silence always beats a guess.

## Read the source, that's the point

This thing reads your entire conversation history, so the first question any sensible person asks is *"is it phoning home?"* The whole tool is in `cli/`, open source under MIT, so you don't have to take that on trust: you can read exactly what it does and confirm the only three things that touch the network: your own assistant on your own plan, a one-time engine download at `init` that you're asked about first (itemized, checksum-pinned), and the opt-in version check. *"trust me"* is the one thing we're not allowed to say.

## Privacy

Everything runs on your machine. **Your conversations, the moments stratless derives, and your profile never leave it**, not for telemetry, not for "aggregate insight," not ever. There is no server, no account, nothing to sign up for.

Three things touch the network, and the direction matters: the local engine comes **in** once at `init` (with your consent — a ~3MB runtime from npm and ~34MB of model weights from Hugging Face, both checksum-pinned, then permanently offline), the version check comes **in**, and the only thing that goes **out** is the borrowed call to your own assistant, on your own plan, the same place your code was already going.

The profile is a plain text file. It's yours: load it into any other assistant, read it, or delete it.

## What's in here

```
cli/    the tool. TypeScript, zero runtime deps (the runtime arrives at init's consent). npm: stratless
web/    stratless.com. Nuxt, no modules, prerendered to static HTML
```

## Develop

```
pnpm install
pnpm test        # the CLI's tests
pnpm dev:web     # stratless.com, locally
```

The `cli/` is published standalone and carries **zero runtime dependencies** — the local embedding engine is not one: it arrives once at `init`, after your yes, pinned and checksummed (`runtime/` in this repo is that package). The bar for ever adding a real dependency is very high. Never auto-commit. The tree is left green and uncommitted for a human to review.

## Contributing

Bug reports are very welcome: [open one with the template](https://github.com/stratless-ai/stratless/issues/new/choose). Features and ideas start as a [discussion](https://github.com/stratless-ai/stratless/discussions), not a PR — the roadmap is deliberate and pre-1.0, so an unsolicited feature PR may be declined on direction alone. Found something that breaks the privacy promise? That goes **private**, via the Security tab, never a public issue.

The full guide is **[CONTRIBUTING.md](CONTRIBUTING.md)** — [SECURITY.md](SECURITY.md) for vulnerabilities, [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for everyone.

---

MIT. The profile is yours, it's a plain text file, and it's free forever.
