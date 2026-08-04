# stratless

**stratless writes your AI a brief on who you are, so it stops making you feel stupid.**

Your coding assistant has no idea who it's talking to. So it only has two registers: silence, or a
wall of jargon. stratless gives it the missing third thing, a picture of *you*, read from the
conversations you've already had, and hands it over before you say a word.

```
npx stratless
```

That's the free read — what your AI already knows about you, computed on your machine, changing
nothing. When you want to keep it, `npx stratless init` archives your history and builds the full
profile after asking once.

No account. No API key. No cloud. The reading and the pattern-finding happen on your own disk; the
only borrowed thing is your own `claude`, which names what the maths found. **Nothing leaves your
machine.**

You need three things, and you probably have all of them: **Claude Code or Codex** installed and
signed in (the `claude` or `codex` command), **Node 18+**, and a few sessions of history on this
machine. That's it. Use both and they read as one person: a single profile, built from everything
you do, loaded back into each of them.

---

## What it builds

Run `stratless profile` and it shows you the brief it has built, the one `stratless update` hands to
your assistant: your shorthand decoded, what to offer you before you ask, what to catch for you, and
how to talk to you. Every line is an instruction to the AI, observed from your own history, with the
real count behind it:

```
Who you are working with              (stratless · read from your own history)

## In the moment

- "yes plan" · "can we plan" → wants a plan before code
- a new or multi-step task begins → pause and offer
  a concise plan before implementing anything

## What to offer me before I ask

- offer to enter a planning step before touching any
  implementation — and when a new or multi-step task begins,
  pause and offer a concise plan before implementing
  anything. (258× · slip 28×)

## What to catch for me

- catch unverified claims of done work; they want it
  double-checked before being told it's finished. (122×)

## How to talk to me

- treat a bare "yes, run X" as full authorization; don't ask
  for restatement — and when the coding is finished and a run
  or test is next, check the scope with me before
  proceeding. (203×, fading · slip 16×)
```

Not a rules sheet you wrote. A brief on a person, derived from your real history and nothing you
declared, and it sharpens as that history grows.

It also thins. A when-clause and its slip count disappear once the gap they mark closes. And the
decode key can carry two lines measured from how your own questions land: your comprehension
signature — how explanations must arrive for you, with the honest counts behind it — and, for the
zones of your work you never enter at all, a line marking your silence there as chosen
outsourcing: do the work, skip the teaching. Neither line ever names a topic or grades what you
know, and each thins away as the failures it marks stop happening.

## The commands

One note first: `npx` runs stratless without installing it, so after `npx stratless init` the bare
`stratless` won't be on your PATH. Either install it properly, `npm install -g stratless`, or keep
prefixing every command below with `npx `. Both work.

```
stratless mirror     a free read of you and your AI, changes nothing (--share for a card)
stratless init       keep your history, and build your profile
stratless profile    see the model of you, free and instant
stratless update     read what is new, rebuild and load the profile
stratless stop       turn it off, and unload the profile
stratless status     its own state, and what it has cost (--check: newer version?)
stratless mcp        serve the profile to any MCP client (for their config, not for typing)
```

`mirror` is the run-it-now, change-nothing door: it reads your live history and shows the free read,
with no setup and no archive, so bare `npx stratless` (no verb) runs it too. `stratless --version`
(or `-v`) prints the installed version.

`init` is the one thing you can't do later. Claude Code **deletes your transcripts after 30 days**,
per file, so your history rots from the back even in a project you use every day. `init` stops that
and copies everything somewhere safe. (Codex has no such timer; `init` still keeps its own copy, and
it will ask Codex to approve the after-session refresh rather than turn it on behind your back.) Everything else reads from there. Saying yes to the full build
also fetches the local pattern-finding machinery, once (~3MB runtime + ~34MB model, itemized before
you answer); after that, every build runs offline. That is the **only** download door: the npm
package itself has zero dependencies, and nothing heavier arrives until you say yes.

## How it works, there's no trick

No model of ours. No server. No training. No separate bill.

1. **Read.** Every session your assistant has is already on your disk, in `~/.claude/projects` or
   `~/.codex/sessions`.
   stratless walks each one into moments: what you typed, and what the assistant was doing.
2. **Cluster.** A small open-weights model on your machine turns each moment into a fingerprint, and
   the recurring kinds of thing you do fall out as groups — arithmetic, a few minutes, free, and it
   reaches nothing. **Derived, not pre-matched**: there is no category list to sort you into,
   because a list we wrote would be our model of a generic person, not a reading of you. Then your
   own assistant is borrowed for the only judgments left: naming what the maths found, and wording
   your profile — the two small calls that are all it ever spends.
3. **Count.** Every count is plain arithmetic: how often, over what span, rising, fading, or `met`,
   which means the asking faded because the assistant already does the thing, read from both sides
   of the conversation. The model names, the code counts, so no number in your profile is a guess.
4. **Load.** `stratless update` writes one profile per assistant — `~/.stratless/HUMAN.claude-code.md`, `~/.stratless/HUMAN.codex.md` — each derived only from that assistant's own history, and points your
   assistant's config at it, so your next session starts already knowing you. The after-session
   refresh keeps it current; `stratless stop` turns that off and unloads it.

   Codex keys hook approval by position. If you add another `SessionEnd` hook after stratless and
   later run `stratless stop`, removing stratless shifts that hook; stop warns that Codex will ask
   you to approve the later hook again rather than leaving the surprise for your next session.

It spends your own plan's tokens, never a separate bill (`stratless status` shows the running
total). It reads all of your history, deduped and cached, so the first build is the one real cost
and every update after only pays for what is new — plus, while a profile is still young, a few
cents-sized map rebuilds as your history grows into it: announced in `status`, covered by the one
consent, and self-stopping as the map matures. If the assistant can't answer honestly, it writes
nothing: a confidently-wrong profile is the one failure that would end this, so silence always beats
a guess.

## Privacy

Everything runs on your machine. **Your conversations, the moments stratless derives, and your
profile never leave it**, not for telemetry, not for "aggregate insight," not ever. There is no
server, no account, nothing to sign up for. Three things touch the network and the direction matters:
the local engine comes **in** once at `init` (with your consent — the runtime from
registry.npmjs.org and the model weights from huggingface.co, both pinned and checksummed, then
permanently offline), the version check comes **in**, and the only thing that goes **out** is the
borrowed call to your own assistant, on your own plan, the same place your code was already going.

The profile is a plain text file. It's yours: load it into any other assistant, read it, or delete
it.

---

MIT. Free forever.
