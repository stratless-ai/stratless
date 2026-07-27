<script setup lang="ts">

const GITHUB = 'https://github.com/stratless-ai/stratless'

// The CLI version, read from cli/package.json at build (see nuxt.config.ts) so it never goes stale by hand.
const version = useRuntimeConfig().public.version

// THE ONE SAMPLE SOURCE: a real build, checked in verbatim (see AGENTS.md, "One sample profile").
// Imported raw at build time and shown in full — behind the file icon in the install band, as a modal.
import sampleRaw from '~/content/samples/HUMAN.md?raw'
const sample = sampleRaw.trim()

// The brief modal: scroll-locks the page while open, focuses the close button (so Esc lands on the
// dialog), and restores everything on close. All client-side; the prerendered page ships it closed.
const briefOpen = ref(false)
const briefClose = ref<HTMLButtonElement | null>(null)
watch(briefOpen, async (open) => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = open ? 'hidden' : ''
  if (open) {
    await nextTick()
    briefClose.value?.focus()
  }
})

// Where HUMAN.md is headed. Claude Code is live; the rest are the roadmap. `logo` is a local monochrome
// mark in /public/logos (from simple-icons, recolored via CSS mask); null = no clean official mark, so
// it shows as a text wordmark (Codex — OpenAI has no distinct Codex mark; Aider — only a filtered wordmark).
const brands = [
  { name: 'Claude Code', logo: 'claudecode' },
  { name: 'Gemini CLI', logo: 'googlegemini' },
  { name: 'Codex CLI', logo: 'openai' },
  { name: 'Cline', logo: 'cline' },
  { name: 'GitHub Copilot', logo: 'githubcopilot' },
  { name: 'Aider', logo: null },
  { name: 'Cursor', logo: 'cursor' },
  { name: 'Zed', logo: 'zedindustries' },
  { name: 'Windsurf', logo: 'windsurf' },
]

// The JSON-LD lived in nuxt.config's global head, so it asserted `url: stratless.com` on /privacy,
// /terms and all seven docs pages. It describes THE HOMEPAGE. It belongs here.
useHead({
  link: [{ rel: 'canonical', href: 'https://stratless.com/' }],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'stratless',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'macOS, Linux, Windows',
        description:
          'Reads your coding-assistant sessions and writes a HUMAN.md your AI loads every session, so it stops talking over your head. Runs locally, nothing leaves your machine.',
        url: 'https://stratless.com',
        sameAs: [GITHUB],
        license: 'https://opensource.org/licenses/MIT',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      }),
    },
  ],
})

// THE FRONT DOOR PERFORMS THE TRICK. It does not explain a philosophy.
//
// Everything below the fold is the REVEAL — no cloud, no training, no separate bill; the
// conversation was on your disk the whole time, and Claude Code deletes it after 30 days.
// Penn & Teller: transparent cups. Knowing how it works makes it better, not worse.
//
// ⛔ No manifesto. No vocation, no jedi, no strata, no "anti-slop." The graveyard is full of
//    philosophies. Ship the trick; the meaning arrives on its own.
</script>

<template>
  <!-- HERO — the trick, performed. The fog band runs from y=0: the hero bleeds up under the
       (transparent-at-top) nav, so the animation covers the header strip too. -->
  <section class="section hero">
    <FogFlowField />
    <div class="container hero-inner">
      <p class="eyebrow">Open source · runs on your machine</p>
      <!-- The signature IS the hero headline; the lede below gives it its context. -->
      <h1>Made for your AI.<br />Meant for you.</h1>
      <p class="lede">
        stratless reads your chats and teaches your AI who you are, <br />so it stops talking over your
        head or under it.
      </p>

      <!-- Not role="img": that collapsed the whole real profile below to one aria-label sentence,
           hiding the actual patterns and counts from screen readers. The content is real text, so
           expose it. The window chrome (title, traffic lights) and the prompt glyphs are decorative
           (aria-hidden); the body is a keyboard-reachable, named region because it scrolls. -->
      <div class="term realterm">
        <div class="term-bar" aria-hidden="true">
          <div class="term-dots"><span class="d-r" /><span class="d-y" /><span class="d-g" /></div>
          <div class="term-title">my-app — -zsh — 72×24</div>
        </div>
        <pre class="term-body" tabindex="0" role="region" aria-label="stratless profile, printed to the terminal"><code><span class="t-arrow" aria-hidden="true">➜</span>  <span class="t-path">~/my-app</span> <span class="t-c">stratless profile</span>

<span class="t-d"># who you are working with, read from your own history</span>

<span class="t-b">WHAT TO OFFER ME BEFORE I ASK</span>
- offer a quick sketch of the idea before building it
  out, then ask them to validate it. <span class="t-d">(218×)</span>

<span class="t-b">WHAT TO CATCH FOR ME</span>
- catch completed work presented as done and expect a
  double-check pass before it's accepted. <span class="t-d">(101×)</span>

<span class="t-b">HOW TO TALK TO ME</span>
- talk in short go-ahead bursts, they approve with a
  brief word and expect you to keep moving. <span class="t-d">(159×, rising)</span>

<span class="t-d">not loaded yet · load it into your assistant: stratless update</span>

<span class="t-arrow" aria-hidden="true">➜</span>  <span class="t-path">~/my-app</span> <span class="t-c">stratless update</span>

<span class="t-ok">↳ loaded</span>  <span class="t-d">your assistant now talks to a person, not a blank.</span>

<span class="t-arrow" aria-hidden="true">➜</span>  <span class="t-path">~/my-app</span> <span class="term-cursor" aria-hidden="true" /></code></pre>
      </div>

      <!-- PROFILER HERO, two beats: `stratless profile` prints the model (a faithful excerpt of real
           output — re-pull it from the then-current HUMAN.md when refreshing the showcase), then
           `stratless update` loads it. profile LOOKS, update LOADS — the terminal teaches the split. -->

      <div class="cta-row">
        <Btn href="#install" primary>Install</Btn>
        <Btn :href="GITHUB" target="_blank" rel="noopener">Read the source</Btn>
      </div>
      <p class="free-note cursor">MIT. No account, no API key, no cloud. Nothing leaves your machine.</p>
    </div>
  </section>

  <!-- INSTALL — two columns: the commands, and the receipt. Left: one command to run, one to keep,
       one to leave (never command cards; reference lives at /docs/commands). Right: the author's
       real HUMAN.md behind a file icon — click it and the full, unedited brief opens in a modal. -->
  <section id="install" class="section install">
    <div class="container">
      <h2 class="sr-only">Install</h2>
      <p class="eyebrow center">See it for yourself</p>
      <div class="install-cols">
        <div class="install-col">
          <div class="install-lead">
            <div class="cmd"><code>npx stratless</code></div>
            <p class="cmd-note">See what your AI already knows about you. Runs on your machine, changes nothing.</p>
          </div>
          <p class="keep-line">
            Like it? Keep it: <code>npx stratless init</code> stops Claude Code's 30-day reaper and archives
            your history. Whatever's already gone is gone.
          </p>
          <p class="keep-line">
            Turn it off anytime: <code>stratless stop</code>. Being able to shut it up is half of why you
            can trust it.
          </p>
        </div>
        <div class="install-col brief-col">
          <button type="button" class="brief-icon" aria-haspopup="dialog" @click="briefOpen = true">
            <span class="bi-doc" aria-hidden="true"><span class="bi-fold" /><span class="bi-line" /><span class="bi-line" /><span class="bi-line" /></span>
            <span class="bi-name">HUMAN.md</span>
          </button>
          <p class="brief-sub">View my own brief to the AI: the author's real <code>HUMAN.md</code>, unedited. Yours will say different things. That's the point.</p>
        </div>
      </div>
      <p class="cmd-meta center">v{{ version }} · MIT · <a :href="`${GITHUB}/releases`" target="_blank" rel="noopener">changelog ↗</a></p>
    </div>
  </section>

  <!-- THE BRIEF MODAL — the one sample source (content/samples/HUMAN.md), summoned. -->
  <Teleport to="body">
    <div v-if="briefOpen" class="brief-overlay" @click.self="briefOpen = false">
      <div class="brief-dialog" role="dialog" aria-modal="true" aria-label="the author's full HUMAN.md, a real example" @keydown.esc="briefOpen = false">
        <div class="filebar">
          <span class="fname">~/.claude/HUMAN.md</span>
          <button ref="briefClose" type="button" class="brief-x" aria-label="close" @click="briefOpen = false">×</button>
        </div>
        <pre class="filebody"><code>{{ sample }}</code></pre>
      </div>
    </div>
  </Teleport>

  <!-- THE REVEAL — knowing how it works makes it better, not worse. -->
  <section class="section reveal">
    <div class="container narrow">
      <p class="eyebrow">There's no trick</p>
      <h2>The conversation was on your disk the whole time.</h2>
      <p>
        No cloud. No training. No separate bill. Every assistant that can resume a chat has to
        store the chat, and Claude Code keeps yours in <code>~/.claude/projects</code>.
        <strong>Nobody reads it.</strong>
      </p>
      <p>
        stratless reads it, and it reads what you did, not what it said. It walks each session into
        moments and finds the kinds of thing you do again and again. Your
        <em>"wait, what does this mean"</em> is one. Your <em>"ok, next"</em> is another.
      </p>

      <div class="pipeline">
        <div><code>moments</code><span>what you typed, and what the assistant was doing</span></div>
        <div><code>cluster</code><span>the recurring things you do, found on your machine</span></div>
        <div><code>count</code><span>how often, over what span, rising or fading</span></div>
        <div><code>write</code><span>the patterns that survive become your HUMAN.md</span></div>
      </div>
      <p class="quiet">Three of the four run entirely on your machine: the grouping runs on <strong>bge-small</strong>, an open MIT model fetched once at <code>init</code> (~3MB runtime + ~34MB weights, itemized before you say yes — the npm package itself has zero dependencies), and only the naming borrows the assistant you already have. The engine comes in, nothing goes out. If a moment carries no honest signal, it records nothing. <strong>Derived, not pre-matched.</strong></p>
    </div>
  </section>

  <!-- THE ROADMAP — a monochrome marquee of where HUMAN.md is headed. Built on Claude Code. -->
  <section class="section roadmap">
    <div class="container narrow">
      <p class="eyebrow center">Built on Claude Code</p>
      <h2 class="rm-h">One file. Every assistant that reads it gets to know you.</h2>
    </div>
    <div class="marquee" aria-hidden="true">
      <div class="marquee-track">
        <span v-for="(b, i) in [...brands, ...brands]" :key="i" class="brand">
          <span v-if="b.logo" class="brand-logo" :style="{ '--m': `url(/logos/${b.logo}.svg)` }" />
          <span class="brand-name">{{ b.name }}</span>
        </span>
      </div>
    </div>
    <div class="container narrow">
      <p class="quiet center rm-note">Live on Claude Code today. Aider, Gemini, Codex, Cline, Copilot and more, coming.</p>
    </div>
  </section>

</template>

<style scoped>
/* `.eyebrow.center` was used in the template but the class existed NOWHERE — not in main.css,
   not here. The "One command" label rendered left-aligned above a centered command box. */
.center {
  text-align: center;
}
.hero {
  position: relative;
  /* Pull the band up under the 58px sticky nav (= .nav-inner's height) so the FogFlowField canvas
     starts at y=0 and the animation runs behind the header, which is transparent until you scroll
     (.nav-clear, layouts/default.vue). padding-top hands the content those 58px back.
     The nav sits at z-index 10 and the hero at auto, so the logo + links stay above the fog. */
  margin-top: -58px;
  padding-top: calc(1rem + 58px);
  /* The fog's stand-in, painted from static CSS the moment the HTML parses. The canvas needs
     hydration + two 512² noise tiles (~1s cold) and is transparent until then — without this,
     bare paper shows through the header strip and the fog visibly pops in. Same ramp as
     FogFlowField's fog palette, so the first dithered frame reads as the texture developing. */
  background:
    radial-gradient(55% 38% at 24% 32%, rgba(251, 250, 245, 0.75), transparent 70%),
    radial-gradient(48% 34% at 74% 58%, rgba(214, 218, 210, 0.8), transparent 70%),
    linear-gradient(180deg, #f0efe6 0%, #e7e7dd 45%, #d6dad2 78%, #c5ccc4 100%);
  /* the horizon where the fog band ends and paper resumes — the fog palette's deepest tone */
  border-bottom: 1.5px solid #c5ccc4;
}
.hero-inner {
  position: relative;
  z-index: 1;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.85rem;
}
/* the hero eyebrow rides the flex gap, so drop its default <p> 1rem bottom margin and
   tighten the inherited 1.62 line-height — otherwise it carries too much top/bottom air. */
.hero-inner .eyebrow {
  margin: 0;
  line-height: 1.2;
}
h1 {
  font-size: var(--fs-display);
  line-height: 1.12;
  letter-spacing: -0.02em;
  margin: 0;
}
.lede {
  max-width: 34rem;
  color: var(--ink-2);
  font-family: var(--font-read);
  font-size: var(--fs-lg);
  line-height: 1.6;
  margin: 0.666rem;
}
.cta-row {
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
  justify-content: center;
}
.free-note {
  font-size: var(--fs-sm);
  color: var(--mid);
  margin: 0;
}

/* ── the terminal: a real shell, the trick performed ── */
.term {
  width: min(37rem, 100%);
  text-align: left;
  border: 1px solid #000;
  border-radius: 11px;
  overflow: hidden;
}
/* the hero terminal is a real dark shell, floating on the paper */
.realterm {
  background: #1b1a16;
  box-shadow:
    0 30px 70px -24px rgba(20, 18, 12, 0.55),
    0 6px 16px rgba(20, 18, 12, 0.22);
}
.term-bar {
  position: relative;
  display: flex;
  align-items: center;
  padding: 0.62rem 0.85rem;
  background: linear-gradient(#3a3831, #322f29);
  border-bottom: 1px solid #000;
}
.term-dots {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 0.5rem;
}
.term-dots span {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}
.d-r { background: #ff5f56; }
.d-y { background: #febc2e; }
.d-g { background: #28c840; }
.term-title {
  position: absolute;
  left: 0;
  right: 0;
  text-align: center;
  font-family: var(--font-mono);
  font-size: var(--fs-term);
  color: #b9b3a3;
  letter-spacing: 0.01em;
}
.term-body {
  margin: 0;
  padding: 1.15rem 1.25rem 1.4rem;
  /* A fixed-height shell you scroll inside — the profile is longer than the window, like real output.
     Sized so the fold lands inside the third section: all three headings reachable, and the second
     beat (`stratless update` → loaded) stays below the fold as the reward for scrolling. */
  max-height: 24rem;
  overflow: auto;
  overscroll-behavior: contain;
  font-family: var(--font-mono);
  font-size: var(--fs-term);
  line-height: 1.7;
  color: #e6e2d6;
  -webkit-font-smoothing: antialiased;
}
/* The body is tabbable so a keyboard user can scroll it; the global focus ring (--accent-deep) is
   too dim on #1b1a16, so use the terminal's lighter blue, inset to hug the panel. */
.term-body:focus-visible {
  outline: 2px solid #6cb6d9;
  outline-offset: -3px;
}
.term-body::-webkit-scrollbar {
  width: 9px;
  height: 9px;
}
.term-body::-webkit-scrollbar-thumb {
  background: #4a473f;
  border-radius: 5px;
}
.term-body::-webkit-scrollbar-track {
  background: transparent;
}
.term-body code {
  background: none;
  padding: 0;
  font-size: inherit;
  color: inherit;
}
.t-arrow { color: #8fce6b; font-weight: 700; }
.t-path { color: #5fb3c9; font-weight: 700; }
.t-c { color: #f4f1e8; font-weight: 700; }
.t-d { color: #8b8677; }
.t-ok { color: #8fce6b; font-weight: 700; }
.t-you { color: #6cb6d9; }
.t-b { color: #f4f1e8; font-weight: 700; }
.term-cursor {
  display: inline-block;
  width: 0.55em;
  height: 1.05em;
  background: #e6e2d6;
  vertical-align: text-bottom;
  animation: term-blink 1.05s steps(1) infinite;
}
@keyframes term-blink {
  50% { opacity: 0; }
}

/* ── install ── */
.install {
  padding-top: 4rem;
  /* The hero CTA jumps here. The header is sticky at 58px, so without this the eyebrow lands
     UNDER it. DocsShell sets the same on its headings for exactly this reason. */
  scroll-margin-top: 80px;
}
.install-lead {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.7rem;
  margin: 0 auto 0.9rem;
  max-width: 42rem;
}
.cmd {
  margin: 0;
  width: fit-content;
  border: 1.5px solid var(--ink);
  border-radius: 8px;
  background: var(--paper-2);
  padding: 0.85rem 1.6rem;
  box-shadow: var(--shadow);
}
.cmd code {
  font-family: var(--font-mono);
  font-size: var(--fs-lg);
  background: none;
  padding: 0;
}
.cmd-meta {
  /* the last element of the install band now — a little air above so it reads as the section's
     footer, not the tail of the stop line */
  margin: 2rem auto 0;
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  color: var(--mid);
}
.cmd-meta a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.cmd-meta a:hover {
  color: var(--accent-deep);
}
.cmd-note {
  margin: 0;
  max-width: 15rem;
  text-align: left;
  font-size: var(--fs-xs);
  line-height: 1.5;
  color: var(--mid);
}
/* the note stacks centered under the single command box (not the left-aligned side note the old
   single-command row used). Descendant selector so it wins over .cmd-note's default left-align. */
.install-lead .cmd-note {
  max-width: 30rem;
  text-align: center;
}
/* the KEEP and the OFF-SWITCH — inline follow-up lines, deliberately NOT command cards, so there's a
   single boxed CTA above them. Each command sits inline as bold mono, not a box. */
.keep-line {
  margin: 1.3rem auto 0;
  max-width: 34rem;
  text-align: center;
  font-family: var(--font-read);
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--mid);
}
.keep-line code {
  font-size: var(--fs-code);
  font-weight: 700;
  color: var(--ink);
}

/* ── the install columns + the brief showcase ── */
.install-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2.5rem;
  align-items: center;
  max-width: 52rem;
  margin: 0 auto;
}
@media (max-width: 760px) {
  .install-cols {
    grid-template-columns: 1fr;
    gap: 2rem;
  }
}
.brief-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.9rem;
}
/* The file icon: a paper sheet with a folded corner and faint rule lines. A BUTTON — it opens the brief. */
.brief-icon {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  background: none;
  border: none;
  padding: 0.4rem;
  cursor: pointer;
}
.bi-doc {
  position: relative;
  width: 64px;
  height: 80px;
  background: var(--paper-2);
  border: 1.5px solid var(--ink);
  border-radius: 6px 14px 6px 6px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 7px;
  padding: 0 12px 14px;
  transition: transform 0.15s ease;
}
.brief-icon:hover .bi-doc,
.brief-icon:focus-visible .bi-doc {
  transform: translateY(-2px);
}
.bi-fold {
  position: absolute;
  top: -1.5px;
  right: -1.5px;
  width: 16px;
  height: 16px;
  background: var(--paper);
  border-left: 1.5px solid var(--ink);
  border-bottom: 1.5px solid var(--ink);
  border-radius: 0 0 0 6px;
}
.bi-line {
  height: 2px;
  background: var(--mid);
  border-radius: 1px;
}
.bi-line:nth-child(3) {
  width: 75%;
}
.bi-name {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  font-weight: 700;
  color: var(--ink);
}
.brief-sub {
  margin: 0;
  max-width: 20rem;
  text-align: center;
  font-family: var(--font-read);
  font-size: var(--fs-sm);
  line-height: 1.55;
  color: var(--mid);
}
.brief-sub code {
  font-size: var(--fs-code);
  font-weight: 700;
  color: var(--ink);
}

/* ── the brief modal ── */
.brief-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: color-mix(in srgb, var(--ink) 45%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4vh 1rem;
}
.brief-dialog {
  width: min(46rem, 100%);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  border: 1.5px solid var(--ink);
  border-radius: 8px;
  background: var(--paper-2);
  overflow: hidden;
  box-shadow: 0 18px 50px color-mix(in srgb, var(--ink) 35%, transparent);
}
.filebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.55rem 1rem;
  border-bottom: 1.5px solid var(--ink);
  background: color-mix(in srgb, var(--ink) 6%, var(--paper-2));
}
.fname {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  font-weight: 700;
  color: var(--ink);
}
.brief-x {
  font-family: var(--font-mono);
  font-size: 1.2rem;
  line-height: 1;
  color: var(--ink);
  background: none;
  border: none;
  padding: 0.1rem 0.3rem;
  cursor: pointer;
}
/* The whole file scrolls inside the dialog. Long provenance lines soft-wrap. */
.filebody {
  margin: 0;
  padding: 1.2rem 1.25rem 1.4rem;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--ink-2);
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
.filebody code {
  font-family: inherit;
  font-size: inherit;
  background: none;
  padding: 0;
}

/* ── the reveal ── */
.reveal h2 {
  font-size: var(--fs-title);
  line-height: 1.25;
  margin: 0.4rem 0 1.2rem;
}
.narrow {
  max-width: 42rem;
}
.reveal p {
  font-family: var(--font-read);
  line-height: 1.7;
  color: var(--ink-2);
}
.reveal strong {
  color: var(--ink);
}
/* the pipeline steps under the reveal (moments · cluster · count · write) */
.pipeline {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin: 1.8rem 0 0.9rem;
}
.pipeline div {
  display: flex;
  gap: 0.9rem;
  align-items: baseline;
  font-family: var(--font-read);
  font-size: var(--fs-md);
  color: var(--ink-2);
}
.pipeline code {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  font-weight: 700;
  min-width: 5.5rem;
  background: none;
  padding: 0;
  color: #1f6f8b;
}
.quiet {
  font-size: var(--fs-sm);
  color: var(--mid);
  margin: 0;
}

/* ── the roadmap marquee ── */
.roadmap .narrow {
  text-align: center;
}
.rm-h {
  font-size: var(--fs-title);
  line-height: 1.25;
  margin: 0.4rem 0 0;
}
.marquee {
  margin: 2.4rem 0 1.6rem;
  overflow: hidden;
  /* fade both edges so logos slide in and out instead of clipping hard */
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
}
.marquee-track {
  display: flex;
  width: max-content;
  /* the brand list is rendered twice; each .brand carries its own right margin (NOT a flex gap), so
     the two halves are identical and translateX(-50%) lands exactly on a repeat. A flex `gap` leaves
     a half-gap at the midpoint, which makes the loop visibly jump. */
  animation: marquee 42s linear infinite;
}
.marquee:hover .marquee-track {
  animation-play-state: paused;
}
@keyframes marquee {
  to {
    transform: translateX(-50%);
  }
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  /* padding (not margin) for inter-brand spacing: padding always counts in the track's max-content
     width, so both halves measure identical and the -50% loop is exact. A trailing flex margin can be
     dropped from the measured width, which drifts the loop. */
  padding-right: 3rem;
  color: var(--ink-2);
  opacity: 0.68;
  white-space: nowrap;
}
.brand-logo {
  width: 22px;
  height: 22px;
  flex: none;
  /* recolor any logo to one ink tone: paint a solid block, punch the logo shape out of it */
  background: currentColor;
  -webkit-mask: var(--m) center / contain no-repeat;
  mask: var(--m) center / contain no-repeat;
}
.brand-name {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.rm-note code {
  font-family: var(--font-mono);
  font-size: var(--fs-code);
}
@media (prefers-reduced-motion: reduce) {
  .marquee {
    -webkit-mask-image: none;
    mask-image: none;
  }
  .marquee-track {
    animation: none;
    width: auto;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.9rem 1.8rem;
  }
  .marquee-track .brand {
    padding-right: 0;
  }
}
</style>
