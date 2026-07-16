# stratless

**stratless builds your AI a living model of who you are (what you know, how you think, what
you're building), so it stops making you feel stupid.**

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

Run `stratless profile` and it shows you the model it has built, the one `stratless update` hands
to your assistant:

```
WHO YOU'RE WORKING WITH                    (stratless · 84 sessions · 3,756 exchanges)

Fluent builder, not a beginner. Uses api / commit / schema / deploy casually, 900+×.
Don't explain the stack. They ship.

What stalls them is never the tech. It's MEANING. Their commonest move when stuck
isn't "what is X" but "what does this mean for us?" Abstract explanation with no line
to the product is noise. Attach the consequence or don't say it.

Thinks out loud. Not giving orders, reasoning. Be a thinking partner. "ok" usually
means "ok, and here's the next thing" (they're driving; keep up, don't stop and wait).

Failure signal: "what does this mean" / "i feel stupider" / "cant keep up" / going
quiet. Every time = you went abstract or long. Back up, get concrete.
```

Not a rules sheet you wrote. A model of a person, reasoned from your real history, and it sharpens
as that history grows.

## The commands

One note first: `npx` runs stratless without installing it, so after `npx stratless init` the bare
`stratless` won't be on your PATH. Either install it properly, `npm install -g stratless`, or keep
prefixing every command below with `npx `. Both work.

```
stratless init       turn it on: keep your history, and start reading it
stratless profile    see the model of you (profile looks; update loads)
stratless report     the same picture, written for you to read
stratless update     judge what's new; rebuild + load the profile when due (--now: always)
stratless stop       turn it off: stop refreshing and unload the profile
stratless status     stratless's own state: on or off, and what it has cost
stratless stats      raw counts about your assistant in a project, instant and free
```

`stratless --version` (or `-v`) prints the installed version.

`init` is the one thing you can't do later. Claude Code **deletes your transcripts after 30 days**,
per file, so your history rots from the back even in a project you use every day. `init` stops that
and copies everything somewhere safe. Everything else reads from there.

## How it works, there's no trick

No model of ours. No server. No training. No separate bill.

1. **Read.** Every session Claude Code has is already on your disk, in `~/.claude/projects`.
   stratless walks each one into `(what the assistant said → how you reacted)` pairs.
2. **Judge.** It hands each pair to the `claude` you already have (`claude -p`, on your own plan)
   and asks one question: *did understanding transfer, and about what?* One line back, **cached**,
   so each exchange is read once.
3. **Synthesize.** It reads the whole stack of those judgments and writes the profile above.
4. **Load.** `stratless update` writes the profile to `~/.claude/HUMAN.md` and points your assistant's
   own config at it, so your next session starts already knowing you. Run it again any time to refresh,
   or `stratless init --auto` to have it refresh automatically after each session. `stratless stop`
   turns that off and unloads it.

It spends your own plan's tokens, never a separate bill (`stratless status` shows the running total).
The first run reads a recent window of your history; after that it only ever reads what's new. If the assistant
can't answer honestly, it says nothing: a confidently-wrong profile is the one failure that would end
this, so silence always beats a guess.

## Privacy

Everything runs on your machine. **Your conversations, the judgments, and your profile never leave
it**, not for telemetry, not for "aggregate insight," not ever. There is no server, no account,
nothing to sign up for. The only network call is to your own assistant, on your own plan, the same
place your code was already going.

The profile is a plain text file. It's yours: load it into any other assistant, read it, or delete
it.

---

MIT. Free forever.
