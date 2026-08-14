# stratless

**stratless turns your logs into skills your AI actually gains.**

Your coding assistant has no idea who it's talking to. stratless reads the conversations you've
already had, measures what you do repeatedly, what went wrong, and what you keep having to ask
for — then proposes skills from that evidence, each with the count that earned it, and installs
them on one typed yes.

```
npx stratless
```

That's the free read — what your AI already knows about you, computed on your machine, changing
nothing. When you want to keep it, `npx stratless init` archives your history and builds the
evidence after asking once; `stratless tune` is the sitting that turns it into skills.

No account. No API key. No cloud. The reading and the pattern-finding happen on your own disk; the
only borrowed thing is your own assistant (`claude` or `codex`), which names what the maths found.
**Nothing leaves your machine.**

You need four things, and you probably have all of them: **Claude Code or Codex** installed and
signed in (the `claude` or `codex` command), **Node 18+**, **macOS or Linux**, and a few sessions of
history on this machine. Native Windows is not supported yet; run stratless inside WSL. Use both
assistants and each pair gets its own evidence, built only from the history you made together —
nothing measured in one tool is ever presented to the other.

---

## What it builds

The evidence lives at `~/.stratless/HUMAN.<assistant>.md` — a plain-text brief on how you actually
work, internal to stratless: the sitting reads it, nothing loads it into your assistant. Your
shorthand decoded, what to offer you before you ask, what to catch for you, how to talk to you.
Every line is observed from your own history with the real count behind it:

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
  anything. (265× · slip 28×)

## What to catch for me

- catch anything left unverified, uncommitted, or
  unconfirmed as done and check or lock it in before
  continuing:
  - remote or deployed state unverified (192×)
  - uncommitted work needs a commit first (155×)
  - completion claim needs double-check (126×)

## How to talk to me

- treat a bare "yes, run X" as full authorization; don't ask
  for restatement — and when the coding is finished and a run
  or test is next, check the scope with me before
  proceeding. (205×, fading · slip 16×)
```

Not a rules sheet you wrote. A brief on a person, derived from your real history and nothing you
declared, and it sharpens as that history grows. From it, `stratless tune` proposes the skills the
evidence supports — and every proposed line must cite this file's measurements or it dies.

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
stratless init       keep your history, and build your record's evidence
stratless tune       the sitting: measure, hear the proposal with receipts, one yes installs
stratless update     read what is new, keep the evidence current
stratless stop       turn it off, and remove everything installed
stratless status     its own state, and what it has cost (--check: newer version?)
```

`mirror` is the run-it-now, change-nothing door: it reads your live history and shows the free read,
with no setup and no archive, so bare `npx stratless` (no verb) runs it too. `stratless --version`
(or `-v`) prints the installed version.

The complete option list is deliberately small:

```
stratless mirror --share       print the screenshot-safe card (no repo or session names)
stratless update --daily       let automatic rebuilds run at most daily; update now too
stratless update --weekly      let automatic rebuilds run at most weekly; update now too
stratless update --rebuild     clear the built map on a typed yes, then rebuild everything
stratless status --check       check whether a newer npm version exists
stratless help                 show command help (-h and --help work too)
stratless --version            print the installed version (-v works too)
```

Unknown commands and flags are refused. Colour turns itself off when output is piped, or when
`NO_COLOR` is set.

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
4. **The sitting.** `stratless tune` holds one sitting per pair: it measures that record five
   ways — rituals, lessons, rules, wins, arrivals — asks that pair's own assistant to propose
   skills from the evidence, and disposes of every claim by code: no citation, no skill; no
   verbatim quote, no quote; every count stamped from the receipts. You see the whole report,
   and one typed yes installs the skillpack through that tool's own skill door —
   `~/.claude/skills/` or `~/.codex/skills/`, same format, and nowhere else; styles ship as
   always-on skills, and stratless never writes your instructions files. The after-session
   refresh keeps the evidence current; `stratless stop` removes everything installed, from
   every door.

   Codex keys hook approval by position. If you add another `SessionEnd` hook after stratless and
   later run `stratless stop`, removing stratless shifts that hook; stop warns that Codex will ask
   you to approve the later hook again rather than leaving the surprise for your next session.

   Before signalling a running refresh, `stop` verifies that the PID really belongs to that worker.
   If it cannot prove that, it still removes the hooks and the tune, but it leaves the
   process alone, names the PID, and exits non-zero rather than claiming everything is off.

It spends your own plan's tokens, never a separate bill (`stratless status` shows the running
total). It reads all of your history, deduped and cached, so the first build is the one real cost
and every update after only pays for what is new — plus, while a profile is still young, a few
cents-sized map rebuilds as your history grows into it: announced in `status`, covered by the one
consent, and self-stopping as the map matures. If the assistant can't answer honestly, it writes
nothing: a confidently-wrong profile is the one failure that would end this, so silence always beats
a guess. Model-authored wording may contain no numerals at all; every quantitative receipt is added
by code, and a response that crosses that boundary is refused, and the previous evidence stands.

## Supported assistants

stratless supports **Claude Code** and **Codex** today. Claude Code history is read from
`~/.claude/projects` and its generated skills are installed under `~/.claude/skills`. Codex history
is read from `~/.codex/sessions` and its skills go under `~/.codex/skills`. Each assistant gets a
separate record built only from the conversations you had with that assistant.

The after-session refresh is installed through each tool's own hook mechanism. Codex asks you to
approve that hook; stratless does not bypass the prompt. Claude Code's expiring live transcripts are
why `init` archives first. Codex does not currently need that rescue, but stratless still keeps an
owned, deduplicated archive for consistent updates.

## Honest limits

- Only Claude Code and Codex are supported. Other assistants are ignored.
- stratless can only learn from transcript history still present on this machine. Deleted, excluded,
  or never-recorded conversations cannot be recovered.
- The evidence is derived from observed conversations, so it can be incomplete or wrong. Read the
  receipts before accepting a tune; declining changes nothing.
- Skills can improve fit and consistency. They do not make the underlying model more intelligent or
  guarantee a correct result.
- This is a reading of one human-and-assistant pair, not a comparison, score, benchmark, or population
  claim.

## Writing a skill by hand

You do not need stratless to make a skill. Create one folder in your assistant's skills directory
and put a `SKILL.md` inside it:

```md
---
name: verify-before-handoff
description: Use when a coding task is complete and the result needs to be handed back.
---

Run the relevant checks, inspect the final diff, and state what remains unverified.
```

The `description` is the trigger the assistant sees up front; the body is loaded when the trigger
matches. Keep the trigger specific and the body actionable. A stratless tune uses the same ordinary
format—it only earns the content from repeated evidence and installs it for you after approval.

## Privacy

Everything runs on your machine. **Your conversations, the moments stratless derives, and your
profile never leave it**, not for telemetry, not for "aggregate insight," not ever. There is no
server, no account, nothing to sign up for. Three things touch the network and the direction matters:
the local engine comes **in** once at `init` (with your consent — the runtime from
registry.npmjs.org and the model weights from huggingface.co, both pinned and checksummed, then
permanently offline), the version check comes **in**, and the only thing that goes **out** is the
borrowed call to your own assistant, on your own plan, the same place your code was already going.

The evidence is a plain text file, and every installed skill carries its receipts in the file
itself. All of it is yours: read it, edit your copy, or delete it.

---

MIT. Free forever.
