# stratless — The Presentation: Problem · Framework · Outcome

> How stratless is presented to the world. **Three acts, always in this order.** Every public-facing
> surface — the landing page, the READMEs, the docs, the npm page, any talk or post — derives from
> this spine, in this sequence: the **problem** earns the ache, the **framework** — *The Person
> Layer* — is the named, ownable model that reframes it, and the **outcome** lands the promise.
> Locked with Sun, 2026-07-15. The engineering docs
> (`build-pass-learning-profiler.md`, `token-economics.md`, `adapter-triage.md`) substantiate this
> from beneath; this is the story on top. The copy-rewrite handover *executes* it into files.

---

## 1. Problem — the ache

*Say it so the reader thinks "that's me."*

AI is **supposed** to make you more capable — that's the whole promise. Instead, too often, it makes
you feel **less**. You come to it to reach your goal faster, and you leave the session feeling slower,
smaller, like *you're* the one who can't keep up.

The mechanism of the pain: the assistant has no model of who it's talking to, so it has only two
registers — **silence or jargon**. It talks over your head or under it, and it never notices. And
because it sounded confident and smart, the dumbness must be *yours* — you can't even blame the tool
cleanly. So it isn't annoyance. It's a small betrayal, repeated every day.

In the user's own words: **"i feel stupider."** The tool that promised to elevate you is quietly
diminishing you.

*This is the keystone — the wound the whole product dresses.*

---

## 2. Framework — The Person Layer

*The named, ownable model — stratless's flag. The reframe that makes the outcome inevitable. This is
the thought-leadership framework (the way "StoryBrand" or "Strategic Choice Cascade" is a framework),
not the code architecture. Lead the middle act with THIS, not the mechanism.*

**In one line:** AI context has layers — and the top one, *who you are*, is missing. stratless builds
it. Call it **The Person Layer.**

### The picture (the mental model)

Two layers of context, stacked — three with the raw model as the floor. Each layer up is more
specific to *you*, and today the stack stops one rung short of you. *(ASCII is the spec until a clean
visual is rendered; the stack is the framework's hero diagram.)*

**Three-layer ladder — canonical** (shows *why* the person layer is the inevitable next rung):

```
                                  more "yours" ▲
  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐      │
  ┊  PERSON  — who you are        ┊   ← HUMAN.md — EMPTY today; stratless builds it.
  ┊  what you know · how you think┊      │
  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘      │
  ┌───────────────────────────────┐      │
  │  PROJECT — what you build      │   ← AGENTS.md, rules. everyone's here.
  │  code · conventions · this repo│      │
  └───────────────────────────────┘      │
  ┌───────────────────────────────┐      │
  │  MODEL   — the domain          │   ← the raw AI. general knowledge.
  │  general coding knowledge      │      │
  └───────────────────────────────┘  general┘
```

**Two-layer shorthand — the punchy public cut** (drop the model floor; sharpest contrast for a hero):

```
  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
  ┊  PERSON  — who you are      ┊   ← HUMAN.md — empty → stratless
  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
  ┌─────────────────────────────┐
  │  PROJECT — what you build    │   ← AGENTS.md, rules (everyone's here)
  └─────────────────────────────┘
```

### The layers, defined

- **Model layer** — the raw AI: general knowledge, trained on everything. The engine.
- **Project layer** — *what* you're building: code, conventions, this repo. This is `AGENTS.md` and
  rules files; the whole industry poured its effort here, and it's standardizing fast.
- **Person layer** — *who* you are: what you know, how you think, your altitude, what you're really
  after. Its file is **`HUMAN.md`**, the counterpart to `AGENTS.md`. **Nobody has built this. It is empty.**

The vertical logic is a **ladder of specificity**: the model knows the *domain*, the project layer
makes it know *your code*, and the person layer would make it know *you*. Each rung is more yours;
the top rung is missing.

### The argument (why this reframes everything)

The empty top layer is the *exact* reason the AI talks over your head or under it — **it knows your
code but not you.** Every rival is optimizing the *human* (prompt courses, "learn to prompt") or the
*project* layer (better rules files). stratless optimizes the missing one: **the machine's model of
the person.** You don't compete with `AGENTS.md` — you own the layer *above* it.

The file makes it concrete: **every repo has `AGENTS.md`; none has `HUMAN.md`** — that's the missing
layer, and stratless writes it. (`HUMAN.md` is private — *visible to your coding assistants, invisible to
people*; the privacy rule and the individual-private team model are in build-pass §9.)

### The shift, in four words: Profile, not Prompt

The **Prompt Era** puts the burden on you — you learn to talk to the machine and re-explain yourself
every session, and nothing accrues. The **Profile Era** shifts the burden to the machine — it reads
who you are once, it accrues, it meets you. Three shifts: **ephemeral → persistent · human-adapts →
machine-adapts · output → comprehension.** *("Profile" means a model of a person — never a config
file or a rules sheet.)*

### How the Person Layer gets built — and why you can trust it

The framework *names* the missing layer; this is *how* stratless fills it, trustworthily. Three
things the reader must believe:

- **It reads what's already there.** Every assistant that can resume a chat has to store the chat.
  stratless reads those transcripts — the record of every time understanding did or didn't transfer —
  that the industry treats as exhaust and deletes. It is **forensic**: it reconstructs from traces on
  your disk; it never watches you live.
- **It builds the layer on your own machine, with no trick.** No server, no API key, no account, no
  training. It borrows the assistant you already have, spends your own plan, and **nothing ever leaves
  your machine** — not the conversations, not the judgments, not the profile; not for telemetry, not
  ever. The whole tool is small enough to read in an afternoon — the line count is the trust argument.
- **It measures the right thing.** One question per exchange — *did understanding transfer, and about
  what?* — not "did the AI sound smart." It models your **comprehension, not your approval**, so it
  makes the AI *meet* you, not flatter you.

The shape, in four words: **read → judge → synthesize → load.** And it improves two ways at once —
your copy knows *you* better every day (local), and the tool gets better for everyone as the maker
sharpens it (shipped as code) — never by pooling anyone's data.

*This is the framework you own (The Person Layer) and the mechanism that earns it. It sets up the
promise in Act 3.*

---

## 3. Outcome — the promise

*What the world walks away with. Not information — a changed relationship with the AI.*

stratless builds your AI a living model of who you are — what you know, how you think, what you're
building — and loads it in before you say a word. So your assistant stops starting from zero, stops
talking over your head or under it, and starts meeting you as **someone it already knows.**

The outcome in one phrase: **continuity of being understood.** You stop re-introducing yourself every
session; the burden of being understood finally *accrues* instead of resetting. And it follows you —
one profile of the *person*, private and portable, across every tool you use.

The pain, inverted: the tool that made you feel stupid now makes you feel **met**. You reach your
goal without being made to feel small on the way.

*This is the payoff — the problem of Act 1, answered.*

---

## The throughline

Working articulation (the exact tagline is still open — choose it during the landing rewrite):

> **AI is supposed to help you reach your goal — instead it makes you feel stupid. stratless builds
> your AI a model of who you are, so it stops.**

**Never reorder the acts.** Lead with the ache (recognition), then present the framework — **The
Person Layer** (the stacked-layers diagram is its hero visual; *"Profile, not Prompt"* is its
four-word shorthand) — then land the promise (the changed relationship). The **efficiency** angle —
fewer conversational turns, lower token cost — is a *secondary* prop for skeptics, never the opener.
The human pain is primary. And never let the framework collapse into "a config / rules sheet" — it's
a *layer you own* and a *model of a person*, not a settings file.

**Do not put in the presentation** (from the Gemini review, `reference-img/`): team/central data
pooling, "anonymized profile export," enterprise gateways, a JSON-schema "config" framing of the
profile. Each breaks the invariant or the portrait; each is a do-not-say.

---

## Honest state (internal note — not for the live copy)

The outcome is validated on **N-of-1** (the maker's own logs read sharply; untested at scale — see
handover §11). This is the narrative to *grow into*, earned by the wound being real and the mechanism
being sound — not a claim of proven scale. Present the promise with conviction; hold the honest state
in the build docs.
