# Competition & Positioning

*Where stratless sits in the market, who it's really up against, and why the lane is defensible.*
Written 2026-07-15. Grounded in a market scan the same day — sources at the bottom. Soft numbers are
labelled as soft; the uncomfortable findings are kept in on purpose. This is a doc you can show.

---

## Bottom line

- **The whole field optimizes one direction — human → AI.** Prompt engineering, AGENTS.md, context
  files: all of it teaches the *human* to feed the machine better. stratless flips it: **AI → human** —
  the machine adapts to the person. Same destination everyone wants, opposite road, uncontested.
- **The red ocean (project context / AGENTS.md) is provably crowded.** A Linux-Foundation standard,
  ~60k repos, 25–30 tools, and a cottage industry of linters fighting "context rot."
- **The blue ocean (the person layer) is provably sparse** — not empty, not crowded. A $15 consumer
  product, one open template, an informal convention, and platform memory that stores facts but doesn't
  adapt. **Nobody is doing earned, judged profiling from actual behaviour.** That gap is ours.
- **The real rival is not those small products — it's platform-native memory** (Claude / ChatGPT /
  Gemini). It's free, built-in, and auto. We beat it on three structural axes it can't easily cross:
  **portable, owned, and earned.**
- **The deepest moat is a position the labs structurally can't hold:** local, user-owned profiling that
  never phones home. A server-side company can't credibly promise that — which is why they'd sooner
  *recommend* a neutral local tool than build the creepy version themselves.

---

## 1. The axis flip (the thesis)

Every mainstream answer to "make AI coding better" is really *"make the human better at instructing the
AI."* Prompt engineering, AGENTS.md, `.cursorrules`, "write clearer requirements." The human does the
work of being understood; the machine stays put.

**stratless reverses the arrow.** It builds the AI a model of *who the person is* — how understanding
transfers to them, what makes them feel stupid, when the AI has gone over their head — and makes the AI
move to meet them. The person stays fixed; the machine adapts.

> Everyone else is teaching humans to speak machine. **stratless teaches machines to speak human.**

Same destination the whole field is chasing (better human-AI collaboration), opposite road — and, per
the scan below, a road that's nearly empty.

---

## 2. The red ocean — the AGENTS.md world (project context)

This is the crowded water, and it's crowded around the *project/task* layer, not the person.

- **A governed standard.** AGENTS.md shipped from OpenAI Codex (Aug 2025) and was donated to the new
  **Linux Foundation Agentic AI Foundation** in Dec 2025, alongside Anthropic's MCP and Block's goose.
  Real standard, not a fad. [LF] [agents.md]
- **Adoption.** "**60,000+ repos**" is repeated everywhere — but it traces to the project's own
  self-report; treat it as *directional, not audited*. The credible number is academic: a study mined
  **128,018 GitHub projects** and found AGENTS.md the dominant interoperable context file, with adoption
  **>2× higher in newer projects**. [arXiv 2601.18341]
- **A whole tooling scramble.** Linters (`agents-lint`, AgentLinter) and generators (`agentseed`,
  `agents-md`) have appeared to fight the core weakness — but they're early, low-star, single-maintainer.

**The core weakness of this whole layer is context rot.** A stale AGENTS.md is *worse* than a stale
README: a human reads a stale README skeptically, but an agent **obeys** a stale AGENTS.md with full
confidence — wrong build command, dead convention, followed to the letter. And it rots even untouched,
because the codebase moves around it. [dev.to/wolfejam]

**And the sharpest critique cuts the auto-generated version specifically:** an ETH Zurich study (300+
tasks) found LLM-generated context files *slightly hurt* success (−2–3%) and raised cost (~+20%), because
agents follow them too literally and mostly re-surface what they could already read off the repo. Only
**non-inferable, human-written** facts helped. [arXiv 2602.11988] — see §5 for why this *defends* us.

---

## 3. The blue ocean — the person layer

The question nobody has answered: who owns a portable profile of *the human* the agent works with?
The honest read: **sparsely populated — early and unconsolidated, not empty, not crowded.**

**Self-report files** (you describe yourself):
- **human.md** ($15, human-md.com) — closest name-match. A 15-minute interview → a "personal operating
  manual." But *wellness*-framed (triggers, recovery), not dev-workflow, and no adoption numbers.
- **personal-context-portfolio** (~440★) — an open MIT template, ten markdown files you fill in by hand.
  Most traction of any open person-file — but a template, not a living thing (1 commit).
- **USER.md** — an informal convention inside a couple of agent frameworks. Framework-local, not a standard.

**The unclaimed niche — and it's exactly ours:** every one of these does one of two things — *ask you to
describe yourself*, or *passively remember what you said*. **Nobody is doing earned, judged profiling
from actual behaviour.** Signal over self-report. That's the whitespace.

---

## 4. The real rival — platform memory

Be honest with ourselves: the 800-lb gorilla isn't the file products, it's **native memory** —
**Claude Memory** (GA Mar 2026, auto-synthesizes your conversations into a profile every 24h),
**ChatGPT Memory**, **Gemini Personal Intelligence**. Free, built-in, automatic.

But it has three structural weaknesses stratless is built to exploit:

1. **Locked in** — your Claude profile can't ride to Cursor. HUMAN.md is portable across every tool.
2. **Not yours** — it's a profile *they* hold on *their* servers; HUMAN.md is a file you own and can read.
3. **Passive, not earned** — it remembers what you *said*; stratless judges what actually *transferred*.

**The lived proof (this is the wedge in one sentence):** platform memory knows your name and your
projects — and still talks over your head. It changed what the AI *knows*, not how it *behaves*. It's a
Rolodex, not a read on you. stratless produces a *behavioural model* — "when he goes abstract, drop the
frame, give the next move" — which is the thing memory was never built to do.

So we're not competing with their memory. **We're doing the thing their memory was never built to do.**

---

## 5. The moats

1. **The trust position labs structurally can't hold.** A frontier lab profiling how you think, stored on
   its servers, is dystopian-adjacent — and they know it. A *local* tool that profiles you on your
   machine, that you own, that never phones home, is a promise a server-side company **cannot** make.
   stratless does the valuable thing that's *toxic if a lab does it directly* — so labs would sooner
   *recommend* a neutral local tool than ship it themselves.
2. **Earned, not self-report.** The differentiation is honest signal over volume — a profile *reasoned
   from behaviour*, not a form you filled in or a pile of facts you volunteered.
3. **The ETH finding, reframed — it defends us.** Their conclusion was *"value comes from non-inferable
   knowledge."* A person is the **ultimate** non-inferable knowledge — you cannot read a human off the
   codebase. Their critique targets auto-generated *project* context (redundant with the repo). The
   *person* layer is the one place auto-generation is fully justified, because there's no repo to read the
   human from. The strongest academic critique of AGENTS.md-style autogen draws a bright line around
   exactly the layer we picked.
4. **The refusal to monetize the data *is* the moat.** No pooling, no dataset sale. The instant stratless
   sells what it learns about people, it's surveillance with a nicer logo — and every lab that would've
   recommended it drops it. The privacy invariant is the business asset.
5. **Un-ownable → standard-able.** The path to ubiquity is the one AGENTS.md and MCP just ran: no lab
   adopts a competitor's product, but every lab adopts a *neutral standard* that makes their tool better
   for free. HUMAN.md's road to "recommended everywhere" is to sit *above* any one vendor.

---

## 6. Monetization, in one line

The ethical model and the business model are the same model: **free where it's personal, paid where it's
shared, never the data.** The private forensic profile is free forever (trust core + adoption wedge +
the standard); the *team* layer — shared roster, publish, freshness heartbeat, admin/SSO — is where
companies pay. The layer that must stay pure is the free one; the layer with willingness-to-pay is the
paid one. They point the same direction.

---

## 7. Honest risks (kept in on purpose)

- **Platform memory could move toward earned profiling.** The gap is structural today (different machine,
  expensive at billion-user scale) — but it's the real long-term threat, more than any file product.
- **Open-core conversion isn't free.** Free-solo has to actually pull teams into paid-team; that's the
  hard part of this model, unsolved.
- **"All frontier brands recommend it" is a mountain from zero users.** Every bit of the standard /
  acquisition vision is *downstream* of proving the method works and getting real people to feel it.
- **Standard vs. acquisition pull against each other.** The most valuable stratless (neutral, un-ownable)
  is the least cleanly acquirable. Build the standard first; the acquisition offer is what it *produces*.
- **The "60k" and other ecosystem self-reports are soft.** Cite them as directional; lean on the academic
  numbers when precision matters.

---

## 8. The Four Actions grid (the value curve)

The blue ocean is not a slogan; it is a value curve that diverges from the industry. Mapped to Blue
Ocean's **Eliminate / Reduce / Raise / Create**:

- **Eliminate** (what the industry assumes, gone entirely): the server, cloud, and account; data
  collection and telemetry (the refusal *is* the moat, not a feature); *you* authoring your own context
  (prompt engineering, rules files, filling in a profile) — stratless reads you instead; its own
  inference bill (it borrows your `claude`).
- **Reduce** (well below standard): code size and opacity (~1,500 auditable lines, not 50,000);
  dependencies (zero runtime); setup and decisions (one command, then automatic); feature breadth (a
  handful of commands that do one thing).
- **Create** (nobody offers it): the person layer (HUMAN.md); earned, judged profiling *from behaviour*
  (not self-report, not passive memory); a portable, owned, inspectable person-artifact that rides
  across tools; the AI-adapts-to-you axis.
- **Raise** (well above standard): trust and auditability; honesty (silence over a confident wrong
  answer); privacy (local, nothing leaves); personalization depth (a behavioural model, not stored
  facts); ownership (read, edit, delete, port the artifact).

**The read.** stratless scores near-zero on what the industry competes on (features, cloud,
data-leverage, owning a model) and far above on what it ignores (trust, personalization-to-*you*,
ownership, honesty). That divergence is the blue ocean. And it splits the grid into two jobs:
**Eliminate + Reduce are guardrails** — the day we add a server, collect data, bloat the code, or make
the user write their own profile, we are back in the red ocean — and **Create + Raise are where we
invest**: deepen the earned profiling and the portability, never chase the industry's competed factors.

## Sources

**AGENTS.md / red ocean:** [agents.md](https://agents.md/) ·
[Linux Foundation AAIF](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) ·
[Adoption, 128k projects (arXiv 2601.18341)](https://arxiv.org/abs/2601.18341) ·
[Efficiency, −29% runtime (arXiv 2601.20404)](https://arxiv.org/abs/2601.20404) ·
[ETH success-rate study (arXiv 2602.11988)](https://arxiv.org/html/2602.11988v1) ·
[Agent READMEs corpus (arXiv 2511.12884)](https://arxiv.org/html/2511.12884v1) ·
["Your AGENTS.md Is Already Stale"](https://dev.to/wolfejam/your-agentsmd-is-already-stale-and-your-agent-trusts-it-completely-2nfh) ·
[agents-lint](https://github.com/giacomo/agents-lint)

**Person layer / blue ocean:** [human.md](https://human-md.com/) ·
[personal-context-portfolio](https://github.com/nlwhittemore/personal-context-portfolio) ·
[USER.md convention (Stanza)](https://www.stanza.dev/courses/openclaw-personalization/agent-persona/openclaw-personalization-user-md) ·
[Claude/ChatGPT/Gemini memory compared](https://lumichats.com/blog/chatgpt-memory-vs-claude-memory-vs-gemini-personal-intelligence-2026-which-ai-actually-knows-you)
