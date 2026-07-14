<script setup lang="ts">
// The footer renders inside the SeigaihaField band below (the sea footer) — the layout stands down.
definePageMeta({ footer: false })

const GITHUB = 'https://github.com/stratless-ai/stratless-cli'

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
      <h1>Your AI wrote your product.<br />Ask it why.</h1>

      <div class="term" role="img" aria-label="Terminal showing stratless why explaining a line of code">
        <div class="term-bar"><span /><span /><span /></div>
        <pre class="term-body"><code><span class="t-p">$</span> <span class="t-c">stratless why</span> src/lib/auth.ts:174

  <span class="t-d">const payload = { p: 'console', exp: Date.now() + …</span>

  <span class="t-ok">✓ matched</span>  <span class="t-d">100% · written 2026-07-09</span>

  <span class="t-you">You said</span>   "lets plan it out properly first…"
  <span class="t-it">It said</span>    "switch the session to a signed cookie…"

  <span class="t-b">So what</span>    Console sessions expire after 30 minutes with no
             refresh, so anyone testing during launch gets logged
             out mid-session and has to sign in again.

  <span class="t-d">git: 22a504fa — feat(api): accounts + Google login</span></code></pre>
      </div>

      <p class="lede">
        Nobody decided 30 minutes. It got picked for you, on a Thursday, while you were thinking
        about something else. <strong>Now you know.</strong>
      </p>

      <div class="cta-row">
        <Btn href="#install" primary>Install</Btn>
        <Btn :href="GITHUB" target="_blank" rel="noopener">Read the source</Btn>
      </div>
      <p class="free-note cursor">MIT. No account, no API key, no cloud. 900 lines you can audit in an afternoon.</p>
    </div>
  </section>

  <!-- INSTALL — one command. -->
  <section id="install" class="section install">
    <div class="container">
      <p class="eyebrow center">One command</p>
      <div class="cmd"><code>npx stratless init</code></div>
      <div class="three">
        <div class="card">
          <code class="k">stratless init</code>
          <p>Stops the 30-day reaper and archives your history. <strong>Claude Code deletes your transcripts after 30 days.</strong> Whatever is already gone is gone.</p>
        </div>
        <div class="card">
          <code class="k">stratless stats</code>
          <p>What your assistant has actually been doing. Lines written, edits made, files touched — most of which you have never read.</p>
        </div>
        <div class="card">
          <code class="k">stratless why</code>
          <p>Point at any line. Get the conversation that made it, in your own words, and what it costs you.</p>
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
  padding-top: calc(7rem + 58px);
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

/* ── the terminal: the trick, performed ── */
.term {
  width: min(46rem, 100%);
  text-align: left;
  border: 1.5px solid var(--ink);
  border-radius: 10px;
  background: var(--paper-2);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.term-bar {
  display: flex;
  gap: 0.4rem;
  padding: 0.6rem 0.8rem;
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 18%, transparent);
}
.term-bar span {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--ink) 22%, transparent);
}
.term-body {
  margin: 0;
  padding: 1.1rem 1.2rem 1.3rem;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 0.79rem;
  line-height: 1.65;
}
.term-body code {
  background: none;
  padding: 0;
  font-size: inherit;
}
.t-p { color: var(--mid); }
.t-c { font-weight: 700; }
.t-d { color: var(--mid); }
.t-ok { color: #2f7d32; font-weight: 700; }
.t-you { color: #1f6f8b; font-weight: 700; }
.t-it { color: #8a6d1f; font-weight: 700; }
.t-b { font-weight: 700; }

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
