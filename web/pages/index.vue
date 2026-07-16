<script setup lang="ts">
import { samples } from '~/lib/samples'

// The footer renders inside the SeigaihaField band below (the sea footer) — the layout stands down.
definePageMeta({ footer: false })

const GITHUB = 'https://github.com/stratless-ai/stratless'

// The two person-layer file-cards open as real documents (rendered from web/content/samples).
const openFile = ref<string | null>(null)
const activeSample = computed(() => (openFile.value ? (samples[openFile.value] ?? null) : null))

// The CLI version, read from cli/package.json at build (see nuxt.config.ts) — never hand-typed.
const version = useRuntimeConfig().public.version

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
// Everything below the fold is the REVEAL — there is no model, no cloud, no training; the
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
      <h1>Your AI knows your code.<br />It doesn't know you.</h1>
      <p class="lede">
        stratless reads your chats and teaches your AI who you are, <br />so it stops talking over your
        head or under it.
      </p>

      <div class="term realterm" role="img" aria-label="Terminal showing stratless profile printing the model of the person, then stratless update loading it into the assistant">
        <div class="term-bar">
          <div class="term-dots"><span class="d-r" /><span class="d-y" /><span class="d-g" /></div>
          <div class="term-title">my-app — -zsh — 92×20</div>
        </div>
        <pre class="term-body"><code><span class="t-arrow">➜</span>  <span class="t-path">~/my-app</span> <span class="t-c">stratless profile</span>

<span class="t-d"># who you are working with, read from your own history</span>

You're talking to a solo founder building stratless, a
human-profiler: a CLI that reads your coding-assistant
transcripts, judges them, and writes a <span class="t-b">HUMAN.md</span> the
assistant loads at session start to know who it is talking to.

They are not fluent in the tech, and the tech is never what
stalls them. <span class="t-b">Altitude is.</span> Concrete, nameable architecture
lands; abstract strategy framings get redirected. On
implementation they give short orders, <span class="t-you">"go," "ok," "commit,"</span>
and rely on you for the how.

<span class="t-b">Failure signal</span>  go abstract or long and they don't argue,
they redirect: to a concrete task, to "just summarize the
blockers," to correcting one fact and moving on. That pivot
means you left ground level. <span class="t-b">Drop the frame, give the next move.</span>
And they gate real decisions on verification.

<span class="t-d">not loaded yet · load it into your assistant: stratless update</span>

<span class="t-arrow">➜</span>  <span class="t-path">~/my-app</span> <span class="t-c">stratless update</span>

<span class="t-ok">↳ loaded</span>  <span class="t-d">your assistant now talks to a person, not a blank.</span>

<span class="t-arrow">➜</span>  <span class="t-path">~/my-app</span> <span class="term-cursor" /></code></pre>
      </div>

      <!-- PROFILER HERO, two beats: `stratless profile` prints the model (a faithful excerpt of real
           output — re-pull it from the then-current HUMAN.md when refreshing the showcase), then
           `stratless update` loads it. profile LOOKS, update LOADS — the terminal teaches the split. -->

      <div class="cta-row">
        <Btn href="#install" primary>Install</Btn>
        <Btn :href="GITHUB" target="_blank" rel="noopener">Read the source</Btn>
      </div>
      <p class="free-note cursor">MIT. No account, no API key, no cloud. ~1,500 lines you can audit in an afternoon.</p>
    </div>
  </section>

  <!-- THE PERSON LAYER — what stratless is about: the file every repo is missing. -->
  <section class="section layer">
    <div class="container narrow">
      <p class="eyebrow">The person layer</p>
      <h2>Every repo has an AGENTS.md.<br />None has a HUMAN.md.</h2>
      <p>
        <code>AGENTS.md</code> tells your AI about your <strong>code</strong>: your stack, your
        conventions, this repo. Everyone has one. Nothing tells it about <strong>you</strong>, what
        you know, how you think, what you're really after. That file is empty.
        <strong>stratless writes it</strong> (<code>HUMAN.md</code>), and your assistant loads it
        every session.
      </p>
    </div>
    <div class="container">
      <div class="file-icons">
        <button type="button" class="file-icon" aria-label="Open AGENTS.md" @click="openFile = 'AGENTS.md'">
          <svg class="fi-glyph" viewBox="0 0 44 54" aria-hidden="true">
            <path class="fi-doc" d="M11 4 H27 L37 14 V45 Q37 49 33 49 H11 Q7 49 7 45 V8 Q7 4 11 4 Z" />
            <path class="fi-fold" d="M27 4 V14 H37" />
            <path class="fi-mark" d="M18 27 l-4 5 l4 5 M26 27 l4 5 l-4 5 M25 25 l-6 14" />
          </svg>
          <span class="fi-name">AGENTS.md</span>
          <span class="fi-tag">your code</span>
        </button>
        <button type="button" class="file-icon accent" aria-label="Open HUMAN.md" @click="openFile = 'HUMAN.md'">
          <svg class="fi-glyph" viewBox="0 0 44 54" aria-hidden="true">
            <path class="fi-doc" d="M11 4 H27 L37 14 V45 Q37 49 33 49 H11 Q7 49 7 45 V8 Q7 4 11 4 Z" />
            <path class="fi-fold" d="M27 4 V14 H37" />
            <circle class="fi-mark" cx="22" cy="30" r="4" />
            <path class="fi-mark" d="M14 44 a8 8 0 0 1 16 0" />
          </svg>
          <span class="fi-name">HUMAN.md</span>
          <span class="fi-tag">you</span>
        </button>
      </div>
      <p class="quiet center files-note">Real files. Click to open. <code>HUMAN.md</code> is stratless's actual profile of its own maker.</p>
    </div>
  </section>

  <!-- INSTALL — one command. -->
  <section id="install" class="section install">
    <div class="container">
      <p class="eyebrow center">One command</p>
      <div class="install-lead">
        <div class="cmd"><code>npx stratless init</code></div>
        <p class="cmd-note"><code>init</code> stops Claude Code's 30-day reaper and archives your history first. Whatever's already gone is gone.</p>
      </div>
      <p class="cmd-meta center">v{{ version }} · MIT · <a :href="`${GITHUB}/releases`" target="_blank" rel="noopener">changelog ↗</a></p>
      <div class="three">
        <div class="card">
          <code class="k">stratless profile</code>
          <p>The briefing <strong>your AI</strong> reads: what you know, how you think, what you're building. Loads at the start of every session.</p>
        </div>
        <div class="card">
          <code class="k">stratless update</code>
          <p>Re-read what's new, rebuild your profile, and load it now, without waiting for a session to end.</p>
        </div>
        <div class="card">
          <code class="k">stratless stop</code>
          <p>Turn it off anytime. Nothing ever leaves your machine, and being able to shut it up is half of why you can trust it.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- THE REVEAL — knowing how it works makes it better, not worse. -->
  <section class="section reveal">
    <div class="container narrow">
      <p class="eyebrow">There's no trick</p>
      <h2>The conversation was on your disk the whole time.</h2>
      <p>
        There's no model. No cloud. No training. No inference bill. Every assistant that can resume
        a chat has to store the chat, and Claude Code keeps yours in <code>~/.claude/projects</code>.
        <strong>Nobody reads it.</strong>
      </p>
      <p>
        stratless reads it. It walks each session into pairs, what the assistant said and how you
        reacted, and asks the <code>claude</code> you already have one question: did that land? Your
        <em>"wait, what does this mean"</em> is a wall. Your <em>"ok, next"</em> is a clear.
        <strong>It reads the reaction, not the answer.</strong>
      </p>
      <p>
        Thousands of those become your <code>HUMAN.md</code>, written by the assistant you already
        have, on your own plan. If a reaction carries no honest signal, it records nothing.
        <strong>A confident guess is the one thing that would end this.</strong>
      </p>

      <div class="verdicts">
        <div><code class="v-ok">cleared</code><span>it landed, you moved on</span></div>
        <div><code class="v-mid">partial</code><span>half landed, you circled back</span></div>
        <div><code class="v-bad">stuck</code><span>it didn't; you pushed back or went quiet</span></div>
        <div><code class="v-you">none</code><span>no signal, pure logistics</span></div>
      </div>
      <p class="quiet">Four verdicts. The one it learns from most is <code>stuck</code>.</p>
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

  <!-- THE SEA — footer inside the wave band. -->
  <SeigaihaField>
    <SiteFooter bare />
  </SeigaihaField>

  <FileModal
    :open="!!openFile"
    :name="activeSample?.name"
    :html="activeSample?.html"
    @close="openFile = null"
  />
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
  font-size: clamp(2.1rem, 5.2vw, 3.6rem);
  line-height: 1.12;
  letter-spacing: -0.02em;
  margin: 0;
}
.lede {
  max-width: 34rem;
  color: var(--ink-2);
  font-family: var(--font-read);
  font-size: 0.9rem;
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
  font-size: 0.82rem;
  color: var(--mid);
  margin: 0;
}

/* ── the terminal: a real shell, the trick performed ── */
.term {
  width: min(46rem, 100%);
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
  font-size: 0.74rem;
  color: #b9b3a3;
  letter-spacing: 0.01em;
}
.term-body {
  margin: 0;
  padding: 1.15rem 1.25rem 1.4rem;
  /* A fixed-height shell you scroll inside — the profile is longer than the window, like real output. */
  max-height: 19rem;
  overflow: auto;
  overscroll-behavior: contain;
  font-family: var(--font-mono);
  font-size: 0.79rem;
  line-height: 1.7;
  color: #e6e2d6;
  -webkit-font-smoothing: antialiased;
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
  padding-top: 1rem;
  /* The hero CTA jumps here. The header is sticky at 58px, so without this the eyebrow lands
     UNDER it. DocsShell sets the same on its headings for exactly this reason. */
  scroll-margin-top: 80px;
}
.install-lead {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.4rem;
  flex-wrap: wrap;
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
  font-size: 1rem;
  background: none;
  padding: 0;
}
.three {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 1.1rem;
}
.card {
  border: 1.5px solid var(--ink);
  border-radius: 8px;
  background: var(--paper-2);
  padding: 1.2rem;
}
.card .k {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 0.8rem;
  background: none;
  padding: 0;
}
.card p {
  margin: 0.6rem 0 0;
  font-family: var(--font-read);
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--ink-2);
}
.cmd-meta {
  margin: 0 auto 2.8rem;
  font-family: var(--font-mono);
  font-size: 0.78rem;
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
  font-size: 0.72rem;
  line-height: 1.5;
  color: var(--mid);
}

/* ── the person layer ── */
.layer .narrow {
  text-align: center;
}
.layer h2 {
  font-size: clamp(1.5rem, 3.2vw, 2.1rem);
  line-height: 1.25;
  margin: 0.4rem 0 1.2rem;
}
.layer p {
  font-family: var(--font-read);
  line-height: 1.7;
  color: var(--ink-2);
  margin: 0;
}
.layer strong {
  color: var(--ink);
}
.layer code {
  font-family: var(--font-mono);
  font-size: 0.92em;
}
.file-icons {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 2.6rem;
  margin-top: 2.2rem;
}
.file-icon {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  background: none;
  cursor: pointer;
  padding: 0.7rem 1rem 0.6rem;
  border-radius: 12px;
  transition: transform 0.13s ease, background 0.13s ease;
  -webkit-tap-highlight-color: transparent;
}
.file-icon:hover {
  transform: translateY(-3px);
  background: color-mix(in srgb, var(--ink) 4%, transparent);
}
.file-icon:focus-visible {
  outline: 2px solid var(--accent-deep);
  outline-offset: 2px;
}
.fi-glyph {
  width: 38px;
  height: 47px;
  filter: drop-shadow(0 4px 7px rgba(20, 18, 12, 0.14));
}
.fi-doc {
  fill: var(--paper-2);
  stroke: var(--ink);
  stroke-width: 2;
  stroke-linejoin: round;
}
.fi-fold {
  fill: none;
  stroke: var(--ink);
  stroke-width: 2;
  stroke-linejoin: round;
}
.fi-mark {
  fill: none;
  stroke: var(--ink);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.file-icon.accent .fi-doc,
.file-icon.accent .fi-fold,
.file-icon.accent .fi-mark {
  stroke: var(--accent-deep);
}
.fi-name {
  font-family: var(--font-mono);
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--ink);
}
.file-icon.accent .fi-name {
  color: var(--accent-deep);
}
.fi-tag {
  font-family: var(--font-read);
  font-size: 0.78rem;
  color: var(--mid);
}
.files-note {
  margin-top: 1.9rem;
}
.files-note code {
  font-family: var(--font-mono);
  font-size: 0.85em;
}

/* ── the reveal ── */
.reveal h2 {
  font-size: clamp(1.5rem, 3.2vw, 2.1rem);
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
.verdicts {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin: 1.8rem 0 0.9rem;
}
.verdicts div {
  display: flex;
  gap: 0.9rem;
  align-items: baseline;
  font-family: var(--font-read);
  font-size: 0.9rem;
  color: var(--ink-2);
}
.verdicts code {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  font-weight: 700;
  min-width: 5.5rem;
  background: none;
  padding: 0;
}
.v-ok { color: #2f7d32; }
.v-mid { color: #8a6d1f; }
.v-you { color: #1f6f8b; }
.v-bad { color: #9b2c2c; }
.quiet {
  font-size: 0.85rem;
  color: var(--mid);
  margin: 0;
}

/* ── the roadmap marquee ── */
.roadmap .narrow {
  text-align: center;
}
.rm-h {
  font-size: clamp(1.4rem, 3vw, 2rem);
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
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.rm-note code {
  font-family: var(--font-mono);
  font-size: 0.85em;
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
