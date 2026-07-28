<script setup lang="ts">

const GITHUB = 'https://github.com/stratless-ai/stratless'

// The CLI version, read from cli/package.json at build (see nuxt.config.ts) so it never goes stale by hand.
const version = useRuntimeConfig().public.version

// THE ONE SAMPLE SOURCE: a real build, checked in verbatim (see AGENTS.md, "One sample profile").
// Imported raw at build time and shown in full — behind the HUMAN.md sheet that ends the boundary
// diagram in the reveal section, as a modal.
import sampleRaw from '~/content/samples/HUMAN.md?raw'
const sample = sampleRaw.trim()
// Split for the modal's per-line render: the brief shows as a file in a dark editor (VS Code
// Dark+), and the only tokenizing is the one rule Dark+ applies that matters for markdown —
// heading lines go blue. Everything else is the raw file, uncolored, as an editor would show it.
const sampleLines = sample.split('\n')

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
          <div class="term-title">~ — -zsh — 72×24</div>
        </div>
        <pre class="term-body" tabindex="0" role="region" aria-label="stratless free read and profile, printed to the terminal"><code><span class="t-arrow" aria-hidden="true">➜</span>  <span class="t-path">~</span> <span class="t-c">npx stratless</span>

  <span class="t-b">You and your AI, measured</span>

    <span class="t-d">you and your assistant</span>    5,912 messages · 49 active days
    <span class="t-d">a median day</span>              123 messages
    <span class="t-d">span</span>                      2026-06-09 → 2026-07-27
                              · longest streak 49 days
    <span class="t-d">how you write</span>             median 17 words · 8% four words
                              or fewer · 42% questions
    <span class="t-d">what you keep typing</span>      "go" 20× · "continue" 18× · "sure" 11×
    <span class="t-d">screenshots sent</span>          205
    <span class="t-d">course corrections</span>        2.49 / 100 messages
    <span class="t-d">tool declines</span>             51
    <span class="t-d">friction days</span>             44 of 49 active days
    <span class="t-d">not counted against you</span>   63 permission stops · 33 system blocks
    <span class="t-d">busiest repo</span>              stratless · across 6 repos · 50 branches
    <span class="t-d">tools it ran for you</span>      27,661 calls · Bash 38% · Edit 26%

  <span class="t-d">Nothing was changed on your machine.</span>

<span class="t-arrow" aria-hidden="true">➜</span>  <span class="t-path">~</span> <span class="t-c">stratless profile</span>

  <span class="t-b">WHO YOU'RE WORKING WITH</span>

  <span class="t-d">##</span> <span class="t-b">What to offer me before I ask</span>
  - offer a quick sketch of the idea before building it
    out, then ask them to validate it. <span class="t-d">(218×)</span>

  <span class="t-d">##</span> <span class="t-b">What to catch for me</span>
  - catch the urge to patch symptoms, they want the
    actual bug found and fixed first. <span class="t-d">(156×)</span>

  <span class="t-d">##</span> <span class="t-b">How to talk to me</span>
  - talk in short go-ahead bursts, they approve with a
    brief word and expect you to keep moving. <span class="t-d">(159×, rising)</span>

  <span class="t-d">not loaded yet · load it into your assistant: stratless update</span>

<span class="t-arrow" aria-hidden="true">➜</span>  <span class="t-path">~</span> <span class="t-c">stratless update</span>
<span class="t-ok">↳ loaded</span>  <span class="t-d">your assistant now talks to a person, not a blank.</span>

<span class="t-arrow" aria-hidden="true">➜</span>  <span class="t-path">~</span> <span class="term-cursor" aria-hidden="true" /></code></pre>
      </div>

      <!-- THE TWO-BEAT SCENE — the landing page in miniature, performed. Beat 1 (above the shell's
           fold): `npx stratless`, the command the pill below sells, printing the AUTHOR'S REAL
           mirror run verbatim (minus the spinner and the `profile captures` row, which belongs to
           the after-state). Beat 2 (the scroll reward): `stratless profile` → three rows pulled
           verbatim from the one blessed sample (content/samples/HUMAN.md) in the real print format
           (the header's meta paren omitted: that build's moments count rotated out of the status
           history), then `update` loads it. Re-pull BOTH beats when the sample or the mirror
           format changes: the terminal must never say what a real run would not. -->

      <div class="cta-row">
        <Btn href="#install" primary>Install</Btn>
        <Btn :href="GITHUB" target="_blank" rel="noopener">Read the source</Btn>
      </div>
      <p class="free-note cursor">MIT. No account, no API key, no cloud. Nothing leaves your machine.</p>
    </div>
  </section>

  <!-- INSTALL — one command, nothing else. The TRY is the whole ask; init/stop and the rest of the
       reference live at /docs/commands, and the sample HUMAN.md lives at the end of the boundary
       diagram below, where the pipeline that writes it finishes. -->
  <section id="install" class="section install">
    <div class="container">
      <h2 class="sr-only">Install</h2>
      <p class="eyebrow center">Try it free · changes nothing</p>
      <div class="install-lead">
        <div class="cmd"><code>npx stratless</code></div>
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
        <div class="filebody"><div v-for="(l, i) in sampleLines" :key="i" class="fline" :class="{ 'md-h': l.startsWith('#') }"><template v-if="l.startsWith('- ')"><span class="md-li">-</span>{{ l.slice(1) }}</template><template v-else>{{ l }}</template></div></div>
      </div>
    </div>
  </Teleport>

  <!-- THE REVEAL — knowing how it works makes it better, not worse. -->
  <section class="section reveal">
    <div class="container narrow">
      <p class="eyebrow">There's no trick</p>
      <h2>The conversation was always there.</h2>
      <p>
        No cloud. No training. No separate bill. Claude Code already keeps your chats in
        <code>~/.claude/projects</code>, and <strong>probably nobody reads them.</strong><br>stratless reads
        what you did, and the things you'd do again and again.
      </p>

      <!-- THE BOUNDARY DIAGRAM — the privacy claim, drawn instead of stated. Everything happens
           inside the box; the one inbound arrow (the runtime, at init) sits on the border, and
           there is no outbound arrow to point to. The prose this replaced lives in the docs
           (/docs/how-it-works, /docs/privacy), which the caption links. -->
      <!-- Not role="img" anymore: the HUMAN.md sheet at the end is a live button (it opens the
           brief modal), and an interactive element may not sit inside an aria-hidden or role="img"
           subtree. The decorative flow hides as one piece; the sr-only line narrates instead. -->
      <div class="machine">
        <span class="machine-tag" aria-hidden="true">your machine</span>
        <p class="sr-only">On your machine, your chats become moments, then clusters, then counts, and finally HUMAN.md. One runtime comes in at init. Nothing goes out.</p>
        <div class="flow">
          <span class="flow-deco" aria-hidden="true">
            <span class="mdoc-item">
              <span class="mchat"><span class="mchat-b mchat-b1" /><span class="mchat-b mchat-b2" /></span>
              <span class="mdoc-name">your chats</span>
            </span>
            <span class="flow-arrow">→</span>
            <span class="flow-step">moments</span>
            <span class="flow-arrow">→</span>
            <span class="flow-step">cluster</span>
            <span class="flow-arrow">→</span>
            <span class="flow-step">count</span>
            <span class="flow-arrow">→</span>
            <span class="flow-step">write</span>
            <span class="flow-arrow">→</span>
          </span>
          <button type="button" class="mdoc-item mdoc-btn" aria-haspopup="dialog" aria-label="HUMAN.md: read the author's real one, unedited" @click="briefOpen = true">
            <span class="mdoc" aria-hidden="true"><span class="mdoc-fold" /><span class="mdoc-line" /><span class="mdoc-line" /><span class="mdoc-line" /></span>
            <span class="mdoc-name">HUMAN.md</span>
          </button>
        </div>
        <span class="machine-io" aria-hidden="true">one runtime in at init · nothing goes out</span>
      </div>
      <!-- "Minutes" stays a ballpark word, never a typed figure: the measured build time moves
           release to release and would rot here. Exact numbers live where they are computed —
           init's consent door quotes cost and time on the person's own archive before spending. -->
      <p class="quiet reveal-cap"><strong>Derived, not pre-matched.</strong> Minutes to build. <NuxtLink to="/docs/how-it-works">how it works →</NuxtLink></p>
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
  /* the fog-side half of the hero→install seam — pairs with the landing seam rule below */
  padding-bottom: 3.5rem;
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
  margin: 0;
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
  /* A fixed-height shell you scroll inside — the scene is longer than the window, like real output.
     Sized so the fold lands inside beat 1's mirror rows (the "what you keep typing" row safely
     visible) and beat 2 (`stratless profile` → the rows → `update` → loaded) stays below the fold
     as the reward for scrolling. */
  max-height: 20.5rem;
  overflow: auto;
  overscroll-behavior: contain;
  font-family: var(--font-mono);
  font-size: var(--fs-term);
  line-height: 1.45;
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

/* ── the landing seams: every section joint totals 6.5rem, 3.5rem below the border + 3rem above
   (the hero's 3.5rem half lives on .hero). The global .section 5rem/5rem stays for other pages. ── */
.install,
.reveal,
.roadmap {
  padding-top: 3rem;
  padding-bottom: 3.5rem;
}

/* ── install ── */
.install {
  /* top = the FULL visual gap below the band (our 3rem + the reveal's 1.5rem top), because the
     hero's horizon border sits directly above: the eye measures border→eyebrow against
     meta→next-eyebrow, not padding against padding */
  padding: 4.5rem 0 3rem;
  /* The hero CTA jumps here. The header is sticky at 58px, so without this the eyebrow lands
     UNDER it. DocsShell sets the same on its headings for exactly this reason. */
  scroll-margin-top: 80px;
}
.install-lead {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.7rem;
  margin: 0 auto;
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
  /* 1rem above, mirroring the eyebrow's 1rem below, so the pill sits centered in the band */
  margin: 1rem auto 0;
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
/* The dialog interior is VS Code Dark+ — the brief is a file, and this is the editor most devs
   will recognise it in. Outer frame stays the site's (black border, like the hero terminal). */
.brief-dialog {
  width: min(46rem, 100%);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  border: 1px solid #000;
  border-radius: 8px;
  background: #1e1e1e;
  overflow: hidden;
  box-shadow: 0 18px 50px color-mix(in srgb, var(--ink) 45%, transparent);
}
.filebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.55rem 1rem;
  border-bottom: 1px solid #3c3c3c;
  background: #252526;
}
.fname {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  font-weight: 700;
  color: #cccccc;
}
.brief-x {
  font-family: var(--font-mono);
  font-size: 1.2rem;
  line-height: 1;
  color: #cccccc;
  background: none;
  border: none;
  padding: 0.1rem 0.3rem;
  cursor: pointer;
}
.brief-x:hover {
  color: #ffffff;
}
/* The whole file scrolls inside the dialog. Long provenance lines soft-wrap per line. */
.filebody {
  margin: 0;
  padding: 1.2rem 1.25rem 1.4rem;
  overflow-y: auto;
}
.filebody::-webkit-scrollbar {
  width: 10px;
}
.filebody::-webkit-scrollbar-thumb {
  background: #424242;
  border-radius: 5px;
}
.filebody::-webkit-scrollbar-track {
  background: transparent;
}
.fline {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  line-height: 1.6;
  color: #d4d4d4;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  /* an empty markdown line still holds its height */
  min-height: calc(0.8rem * 1.6);
}
/* Dark+ colours markdown heading lines blue and bold. The bullets take Dark+'s string orange
   (#ce9178) — real Dark+ gives bullets #6796e6 blue, but Sun chose feel over fidelity here. */
.md-h {
  color: #569cd6;
  font-weight: 700;
}
.md-li {
  color: #ce9178;
}

/* ── the reveal ── */
.reveal {
  /* tighter than the shared seam: the install band above is short and mostly air already */
  padding-top: 1.5rem;
}
/* centered, like the install band above and the roadmap below it */
.reveal .narrow {
  text-align: center;
}
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
/* ── the boundary diagram (moments → cluster → count → write, inside "your machine") ── */
.machine {
  position: relative;
  margin: 2.2rem 0 1.1rem;
  padding: 2rem 1.2rem 2.1rem;
  border: 1.5px solid var(--ink);
  border-radius: 10px;
}
/* the two border labels: paper-backed so they knock a gap out of the border line, like a legend */
.machine-tag,
.machine-io {
  position: absolute;
  padding: 0 0.55rem;
  background: var(--paper);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--mid);
  white-space: nowrap;
}
.machine-tag {
  top: -0.6em;
  left: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink);
}
.machine-io {
  bottom: -0.6em;
  left: 50%;
  transform: translateX(-50%);
}
@media (max-width: 480px) {
  .machine-io {
    font-size: 0.62rem;
  }
}
.flow {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.55rem 0.7rem;
}
/* the decorative run participates in the flex row as if unwrapped; only the button is live */
.flow-deco {
  display: contents;
}
.flow-step {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  font-weight: 700;
  color: #1f6f8b;
}
.flow-arrow {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  color: var(--mid);
}
/* the chat-logs mark: two speech bubbles, one from each side of the conversation, drawn with the
   same 1.5px ink stroke as the paper sheets so the diagram's icons stay one family */
.mchat {
  position: relative;
  width: 46px;
  height: 50px;
}
.mchat-b {
  position: absolute;
  width: 30px;
  height: 19px;
  background: var(--paper-2);
  border: 1.5px solid var(--ink);
}
.mchat-b::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 55%;
  height: 2px;
  border-radius: 1px;
  background: var(--mid);
}
.mchat-b1 {
  top: 3px;
  left: 0;
  border-radius: 7px 7px 7px 2px;
}
.mchat-b2 {
  bottom: 3px;
  right: 0;
  border-radius: 7px 7px 2px 7px;
}

/* the paper sheet, the old install-band file icon in miniature */
.mdoc-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
}
.mdoc {
  position: relative;
  width: 40px;
  height: 50px;
  background: var(--paper-2);
  border: 1.5px solid var(--ink);
  border-radius: 4px 10px 4px 4px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 4px;
  padding: 0 7px 8px;
  transition: transform 0.15s ease;
}
/* the HUMAN.md sheet is the modal's trigger — it HOVERS off the paper at rest, so the one clickable
   mark in the diagram announces itself before anyone mouses near it: the whole button bobs gently,
   the sheet casts a shadow, and hover adds the usual lift on top. Reduced motion drops the bob and
   keeps the shadow as the still tell. */
.mdoc-btn {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  /* easeInOutSine — each half of the cycle is a true sine arc, so the turnarounds have no dwell */
  animation: mdoc-float 3.6s cubic-bezier(0.37, 0, 0.63, 1) infinite;
  will-change: transform;
}
.mdoc-btn .mdoc {
  box-shadow: 0 8px 12px -6px color-mix(in srgb, var(--ink) 40%, transparent);
}
.mdoc-btn:hover .mdoc,
.mdoc-btn:focus-visible .mdoc {
  transform: translateY(-2px);
}
@keyframes mdoc-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mdoc-btn {
    animation: none;
  }
}
.mdoc-fold {
  position: absolute;
  top: -1.5px;
  right: -1.5px;
  width: 11px;
  height: 11px;
  background: var(--paper);
  border-left: 1.5px solid var(--ink);
  border-bottom: 1.5px solid var(--ink);
  border-radius: 0 0 0 4px;
}
.mdoc-line {
  height: 2px;
  background: var(--mid);
  border-radius: 1px;
}
.mdoc-line:nth-child(3) {
  width: 70%;
}
.mdoc-name {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  font-weight: 700;
  color: var(--ink);
}
.reveal-cap a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.reveal-cap a:hover {
  color: var(--accent-deep);
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
