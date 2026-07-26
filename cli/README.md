# stratless

**stratless builds your AI a living model of who you are, so it stops making you feel stupid.**

Your coding assistant has no idea who it's talking to. So it only has two registers: silence, or a
wall of jargon. stratless gives it the missing third thing, a picture of *you*, read from the
conversations you've already had, and hands it over before you say a word.

```
npx stratless init
```

No account. No API key. No cloud. It reads transcripts already on your disk and borrows the
`claude` you already have to read them. **Nothing leaves your machine.**

You need three things, and you probably have all of them: **Claude Code** installed and signed in
(the `claude` command), **Node 18+**, and a few sessions of history on this machine. That's it.

---

## What it builds

Run `stratless profile` and it shows you the model it has built, the one `stratless update` hands to
your assistant. Every line is observed and carries the count behind it:

```
Who you are working with              (stratless · read from your own history)

## When something has gone wrong

Insists on a plan, and plan mode, before any code gets written.
256 times · "wait. are you in plan mode?"

## How they work

Muses openly about direction and invites free-form discussion
rather than a single pointed question.
876 times · "fast to sell and painkiller?"

Gives a short signal (go, commit it) to authorize the next step.
727 times · "Go with A, fix the counts"
```

Not a rules sheet you wrote. A model of a person, derived from your real history and nothing you
declared, and it sharpens as that history grows.

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
```

`mirror` is the run-it-now, change-nothing door: it reads your live history and shows the free read,
with no setup and no archive, so bare `npx stratless` (no verb) runs it too. `stratless --version`
(or `-v`) prints the installed version.

`init` is the one thing you can't do later. Claude Code **deletes your transcripts after 30 days**,
per file, so your history rots from the back even in a project you use every day. `init` stops that
and copies everything somewhere safe. Everything else reads from there.

## How it works, there's no trick

No model of ours. No server. No training. No separate bill.

1. **Read.** Every session Claude Code has is already on your disk, in `~/.claude/projects`.
   stratless walks each one into moments: what you typed, and what the assistant was doing.
2. **Cluster.** A small open-weights model on your machine turns each moment into a fingerprint, and
   the recurring kinds of thing you do fall out as groups — arithmetic, about ninety seconds, free,
   and it reaches nothing. **Derived, not pre-matched**: there is no category list to sort you into,
   because a list we wrote would be our model of a generic person, not a reading of you. Then one
   short call to your own assistant names what the maths found — the only judgment in the pipeline,
   and the only thing that costs anything.
3. **Count.** Every count is plain arithmetic: how often, over what span, rising or fading. The model
   names, the code counts, so no number in your profile is a guess.
4. **Load.** `stratless update` writes the profile to `~/.claude/HUMAN.md` and points your
   assistant's config at it, so your next session starts already knowing you. The after-session
   refresh keeps it current; `stratless stop` turns that off and unloads it.

It spends your own plan's tokens, never a separate bill (`stratless status` shows the running
total). It reads all of your history, deduped and cached, so the first build is the one real cost
and every update after only pays for what is new. If the assistant can't answer honestly, it writes
nothing: a confidently-wrong profile is the one failure that would end this, so silence always beats
a guess.

## Privacy

Everything runs on your machine. **Your conversations, the moments stratless derives, and your
profile never leave it**, not for telemetry, not for "aggregate insight," not ever. There is no
server, no account, nothing to sign up for. Three things touch the network and the direction matters:
the model weights come **in** once at `init` (with your consent, then permanently offline), the
version check comes **in**, and the only thing that goes **out** is the borrowed call to your own
assistant, on your
own plan, the same place your code was already going.

The profile is a plain text file. It's yours: load it into any other assistant, read it, or delete
it.

---

MIT. Free forever.
