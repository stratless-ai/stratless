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

// Two, deliberately (Sun, 2026-08-10): only the assistants stratless actually reads and
// measures are named anywhere on this site. The eight-logo roadmap marquee argued with the
// copy's own claim; a tool joins this row when its leg ships, not before. `logo` is a local
// monochrome mark in /public/logos (simple-icons, recolored via CSS mask).
const brands = [
  { name: 'Claude Code', logo: 'claudecode' },
  { name: 'Codex', logo: 'openai' },
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
          'Reads your own AI logs and derives skills your assistant loads: real habits earned from your history, receipts on every line. Runs locally, nothing leaves your machine.',
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
      <p class="eyebrow">Nothing declared. Everything counted.</p>
      <!-- Three slots, three jobs: the eyebrow is why believe it (the method, and the one line that
           survives any future product), the h1 is what you get, the lede is how plus the pain it
           kills. Solo V2 (2026-08-10): the h1 sells the artifact (skills, the category people
           already install), the lede carries the differentiator (derived, receipts) and the felt
           outcome. "Get your AI to understand you" retired with the profile-as-product era. -->
      <h1>Turn Your Logs Into Skills.</h1>
      <p class="lede">
        Not someone else's skill pack. <br />Derived from how you actually work, with the receipts
        to prove it, so your AI stops failing you the same way twice.
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
        <pre class="term-body" tabindex="0" role="region" aria-label="stratless free read and tune prescription, printed to the terminal"><code><span class="t-arrow" aria-hidden="true">➜</span>  <span class="t-path">~</span> <span class="t-c">npx stratless</span>

  <span class="t-b">You and your AI, measured</span>

    <span class="t-d">you and your assistant</span>    6,177 messages · 52 active days
    <span class="t-d">a median day</span>              122 messages
    <span class="t-d">span</span>                      2026-06-09 → 2026-07-30
                              · longest streak 52 days
    <span class="t-d">how you write</span>             median 17 words · 8% four words
                              or fewer · 42% questions
    <span class="t-d">what you keep typing</span>      "go" 23× · "continue" 19× · "sure" 11×
    <span class="t-d">screenshots sent</span>          210
    <span class="t-d">course corrections</span>        2.44 / 100 messages
    <span class="t-d">tool declines</span>             57
    <span class="t-d">friction days</span>             47 of 52 active days
    <span class="t-d">not counted against you</span>   69 permission stops · 34 system blocks
    <span class="t-d">busiest repo</span>              stratless · across 6 repos · 52 branches
    <span class="t-d">tools it ran for you</span>      29,101 calls · Bash 38% · Edit 27%
    <span class="t-d">work it handed off</span>        636 agent runs · Explore 46%
    <span class="t-d">skills it loaded</span>          54 times · research 17%

  <span class="t-d">Nothing was changed on your machine.</span>

<span class="t-arrow" aria-hidden="true">➜</span>  <span class="t-path">~</span> <span class="t-c">stratless tune</span>

  <span class="t-b">Your tune — claude-code pair</span>

  <span class="t-b">Stage 3 · 6 skills + 3 styles</span>

  <span class="t-d">SKILLS — habits at their moments</span>
    ⚙ <span class="t-b">ask-assistant-to-verify-remote-state</span>  <span class="t-d">(198×)</span>  <span class="t-ok">new</span>
    ⚙ <span class="t-b">give-minimal-continuation-signal</span>  <span class="t-d">(207× · slip 16×)</span>  <span class="t-ok">new</span>
    ⚙ <span class="t-b">request-a-plan-before-implementing</span>  <span class="t-d">(270× · slip 28×)</span>  <span class="t-ok">new</span>
    ⚙ <span class="t-b">ask-how-to-set-up-integration</span>  <span class="t-d">(288×)</span>  <span class="t-ok">new</span>

  <span class="t-d">STYLE — always on</span>
    ≈ <span class="t-b">check-in-on-session-progress</span>  <span class="t-d">(230×)</span>  <span class="t-ok">new</span>
    ≈ <span class="t-b">give-terse-followup-directive</span>  <span class="t-d">(329×)</span>  <span class="t-ok">new</span>

  <span class="t-d">5 rows stay rows — the map carries them, the tune does not.</span>

  <span class="t-d">every receipt is your own count · remove any time: stratless stop</span>

  Install? <span class="t-d">[y/N]</span> <span class="term-cursor" aria-hidden="true" /></code></pre>
      </div>

      <!-- THE TWO-BEAT SCENE — the landing page in miniature, performed. Beat 1 (above the shell's
           fold): `npx stratless`, the command the pill below sells, printing the AUTHOR'S REAL
           mirror run verbatim (minus the spinner and the `profile captures` row, which belongs to
           the after-state). Beat 2 (the scroll reward, Solo V2): `stratless tune` — the DOOR,
           printed from the author's real run (the spinner dropped, two skills and one style
           trimmed as whole lines; every remaining line verbatim, order preserved), ending at the
           real prompt: Install? [y/N] with the cursor blinking on the unanswered question. The
           skill names here must agree with the blessed sample (content/samples/skill.md) — the
           one-sample law covers this beat. Re-pull BOTH beats when the mirror or door format
           changes: the terminal must never say what a real run would not. -->

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
      <p class="eyebrow center">Try it free · Type into your terminal</p>
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
          <span class="fname">~/.stratless/HUMAN.md</span>
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
        <code>~/.claude/projects</code>, and <strong>probably nobody reads them.</strong><br>
        Stratless reads what you did and the things you'd do again and again.
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
            <span class="flow-arrow" />
            <span class="flow-step">moments</span>
            <span class="flow-arrow" />
            <span class="flow-step">cluster</span>
            <span class="flow-arrow" />
            <span class="flow-step">count</span>
            <span class="flow-arrow" />
            <span class="flow-step">write</span>
            <span class="flow-arrow" />
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
      <p class="quiet reveal-cap"><strong>Derived, not pre-matched. Minutes to build. </strong><NuxtLink to="/docs/how-it-works">how it works&nbsp;→</NuxtLink></p>
    </div>
  </section>

  <!-- THE ROADMAP — a monochrome marquee of where HUMAN.md is headed. Two read, many reached. -->
  <section class="section roadmap">
    <div class="container narrow">
      <p class="eyebrow center">Reads Claude Code and Codex</p>
      <h2 class="rm-h">Made for your AI. Meant for you.</h2>
    </div>
    <div class="duo" aria-hidden="true">
      <span v-for="b in brands" :key="b.name" class="brand">
        <span v-if="b.logo" class="brand-logo" :style="{ '--m': `url(/logos/${b.logo}.svg)` }" />
        <span class="brand-name">{{ b.name }}</span>
      </span>
    </div>
    <div class="container narrow">
      <p class="quiet center rm-note">The two assistants stratless reads today, and the only two it names. Skills install to Claude Code now; Codex follows once it is measured against the real tool.</p>
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
  /* Fill the first screen exactly. The -58px margin cancels the nav, so the band's top edge sits at
     document y=0 and 100svh ends it precisely at the fold — no strip of the install section peeking
     under the horizon. `svh`, deliberately, not the other two: `dvh` re-lays-out the whole hero when
     a mobile URL bar hides, which is a layout shift check:fonts would fail; `vh` measures the tallest
     viewport and overflows past that same bar on iOS. It is a MIN, so a short screen still grows the
     band rather than clipping the terminal. */
  min-height: 100svh;
  /* the extra height goes above and below the content, not all at the bottom. Column keeps
     .hero-inner full-width (align-items defaults to stretch) so .container's max-width still rules;
     the asymmetric padding (74px top vs 56px bottom) lands the composition a touch above true
     centre, which is where a hero wants to sit. */
  display: flex;
  flex-direction: column;
  justify-content: center;
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
  /* Without this, the <pre>'s longest line (~546px of unwrappable mono) is the page's minimum
     width: it propagates up through the centered flex column and mobile browsers widen the layout
     viewport to ~580px — the whole site renders clipped on phones. Containment stops the intrinsic
     width at this box, so the declared width above actually rules. */
  contain: inline-size;
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
/* the glyph lives in CSS so the phone layout below can turn → into ↓ without a second markup run */
.flow-arrow::before {
  content: '→';
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
.duo {
  /* two named assistants, centered and still — the marquee retired with the eight-logo roadmap
     (2026-08-10): a page that shows eight tools while the copy claims two argues with itself */
  display: flex;
  justify-content: center;
  gap: 3rem;
  margin: 2.4rem 0 1.6rem;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
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
/* ── phones (2026-08-07): same markup, a different cut of it. The 72-column terminal is a
   desktop artifact — clipped, shrunken or swipe-gated it reads as breakage, so phones don't
   get it; the hero is the words and the CTAs, one fog-banded screen. The proof stays: the
   reveal's boundary diagram (stacked, ↓ for →) still ends at the real HUMAN.md. ── */
@media (max-width: 640px) {
  .term {
    display: none;
  }
  /* the lede's <br> is a desktop couplet break; on a narrow rag it strands half-lines */
  .lede br {
    display: none;
  }
  .flow {
    flex-direction: column;
    gap: 0.45rem;
  }
  .flow-arrow::before {
    content: '↓';
  }
}
</style>
