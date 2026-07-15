<script setup lang="ts">
import { samples } from '~/lib/samples'

// The footer renders inside the SeigaihaField band below (the sea footer) — the layout stands down.
definePageMeta({ footer: false })

const GITHUB = 'https://github.com/stratless-ai/stratless-cli'

// The two person-layer file-cards open as real documents (rendered from web/content/samples).
const openFile = ref<string | null>(null)
const activeSample = computed(() => (openFile.value ? (samples[openFile.value] ?? null) : null))

// The CLI version, read from cli/package.json at build (see nuxt.config.ts) — never hand-typed.
const version = useRuntimeConfig().public.version

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
          "Reads your coding assistant's own history and tells you what it decided for you — in plain English. Runs on your machine. No API key.",
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
        stratless reads your chats and teaches your AI who you are — so it stops talking over your
        head or under it.
      </p>

      <div class="term realterm" role="img" aria-label="Terminal showing stratless profile — the profile stratless writes about the person, loaded into the assistant">
        <div class="term-bar">
          <div class="term-dots"><span class="d-r" /><span class="d-y" /><span class="d-g" /></div>
          <div class="term-title">my-app — -zsh — 92×20</div>
        </div>
        <pre class="term-body"><code><span class="t-arrow">➜</span>  <span class="t-path">~/my-app</span> <span class="t-c">stratless profile</span>

<span class="t-d"># who you are working with — loaded into your assistant every session</span>

They are not fluent in the tech, and the tech is never what
stalls them — <span class="t-b">altitude is</span>. Concrete, nameable architecture
lands; abstract strategy framings get redirected.

On implementation they give short orders — <span class="t-you">"go," "ok," "commit"</span>
— and rely on you for the how.

<span class="t-b">Failure signal</span>  go abstract or long and they don't argue,
they redirect. That pivot means you left ground level:
<span class="t-b">drop the frame, give the next move.</span>

<span class="t-ok">↳ loaded</span>  <span class="t-d">your assistant now talks to a person, not a blank.</span>

<span class="t-arrow">➜</span>  <span class="t-path">~/my-app</span> <span class="term-cursor" /></code></pre>
      </div>

      <!-- PROFILER HERO PASS (profiler-0.2.0): headline, sub-head, and the terminal above now show
           the profiler — the terminal is a faithful excerpt of real `stratless profile` output
           (~/.claude/HUMAN.md). STILL OLD-PRODUCT / next chunks: the "there's no trick" REVEAL
           section below, the nuxt.config.ts title/description + JSON-LD, and the docs tree — all
           still sell `why`. Before the live flip: re-pull the profile snapshot from the then-current
           HUMAN.md (it refreshes every session). -->

      <div class="cta-row">
        <Btn href="#install" primary>Install</Btn>
        <Btn :href="GITHUB" target="_blank" rel="noopener">Read the source</Btn>
      </div>
      <p class="free-note cursor">MIT. No account, no API key, no cloud. 900 lines you can audit in an afternoon.</p>
    </div>
  </section>

  <!-- THE PERSON LAYER — what stratless is about: the file every repo is missing. -->
  <section class="section layer">
    <div class="container narrow">
      <p class="eyebrow">The person layer</p>
      <h2>Every repo has an AGENTS.md.<br />None has a HUMAN.md.</h2>
      <p>
        <code>AGENTS.md</code> tells your AI about your <strong>code</strong> — your stack, your
        conventions, this repo. Everyone has one. Nothing tells it about <strong>you</strong> — what
        you know, how you think, what you're really after. That file is empty.
        <strong>stratless writes it</strong> — <code>HUMAN.md</code> — and your assistant loads it
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
      <p class="quiet center files-note">Real files — click to open. <code>HUMAN.md</code> is stratless's actual profile of its own maker.</p>
    </div>
  </section>

  <!-- INSTALL — one command. -->
  <section id="install" class="section install">
    <div class="container">
      <p class="eyebrow center">One command</p>
      <div class="cmd"><code>npx stratless init</code></div>
      <p class="cmd-meta center">v{{ version }} · MIT · <a :href="`${GITHUB}/releases`" target="_blank" rel="noopener">changelog ↗</a></p>
      <p class="quiet center cmd-note"><code>init</code> stops Claude Code's 30-day reaper and archives your history first — whatever's already gone is gone.</p>
      <div class="three">
        <div class="card">
          <code class="k">stratless profile</code>
          <p>The briefing <strong>your AI</strong> reads — what you know, how you think, what you're building. Loads at the start of every session.</p>
        </div>
        <div class="card">
          <code class="k">stratless report</code>
          <p>The mirror <strong>you</strong> read — where the AI talked over your head, where you went quiet, and how it's trending. In plain English.</p>
        </div>
        <div class="card">
          <code class="k">stratless stop</code>
          <p>Turn it off, or exclude a project, anytime. Nothing ever leaves your machine — being able to shut it up is half of why you can trust it.</p>
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
        a chat has to store the chat — Claude Code keeps yours in <code>~/.claude/projects</code>.
        <strong>Nobody reads it.</strong>
      </p>
      <p>
        stratless reads it. It finds the exact edit that wrote your line, pulls up the words
        <em>you</em> said at the time, and shows you the receipt. <strong>Nothing is generated.</strong>
        It's quoting.
      </p>
      <p>
        The one sentence that <em>is</em> generated — the <em>“So what”</em> — is written by the
        assistant you already have, on your own plan, grounded in your own diff. If it can't answer
        honestly, <strong>it says nothing at all.</strong>
      </p>

      <div class="verdicts">
        <div><code class="v-ok">✓ matched</code><span>found the decision, and <code>git blame</code> agrees</span></div>
        <div><code class="v-mid">~ likely</code><span>found something, but the witnesses disagree — and it tells you how</span></div>
        <div><code class="v-you">yours</code><span>no assistant edit wrote this. <strong>You did.</strong></span></div>
        <div><code class="v-bad">lost</code><span>the conversation that explains this line was <strong>deleted</strong></span></div>
      </div>
      <p class="quiet">Four answers. Three of them are refusals. It would rather say nothing than guess.</p>
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
  padding-top: calc(3.25rem + 58px);
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
  gap: 1.4rem;
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
  line-height: 1.6;
  margin: 0;
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
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 0.79rem;
  line-height: 1.7;
  color: #e6e2d6;
  -webkit-font-smoothing: antialiased;
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
.cmd {
  margin: 0 auto 2.6rem;
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
  font-size: 0.9rem;
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
  margin: -1.9rem auto 0;
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
  margin: 0.7rem auto 2.6rem;
  max-width: 34rem;
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
</style>
