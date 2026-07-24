<script setup lang="ts">
import { legal } from '~/lib/legal'
import { useSeo } from '~/lib/seo'

useSeo({
  title: 'Privacy',
  description:
    "stratless runs on your machine. No server, no account, no API key, no telemetry. We receive nothing, because there is nowhere for it to go.",
  path: '/privacy',
})
</script>

<template>
  <section class="section legal">
    <div class="container">
      <div class="legal-body prose">
        <h1>Privacy Policy</h1>
        <p class="eff">Effective {{ legal.effectiveDate }}</p>

        <p>
          <strong>stratless is a program that runs on your computer.</strong> It is not a service.
          There is no server, no account, no sign-up, and no API key. We do not receive your code,
          your conversations, or your profile, because there is nowhere for it to go.
        </p>

        <h2>What stratless reads</h2>
        <p>
          Your coding assistant's own conversation history, which is already on your disk. Claude
          Code keeps it in <code>~/.claude/projects</code>, and stratless keeps its own archive copy
          in <code>~/.stratless/archive</code> so the assistant's 30-day cleanup cannot eat it. It
          reads those transcripts locally. <strong>It does not send them anywhere.</strong>
        </p>

        <h2>What it writes, and where</h2>
        <p>
          Everything stratless produces is a plain text file on your machine: the moments and
          scores it derives, and your profile, under <code>~/.stratless</code>, the canonical
          <code>HUMAN.md</code> at <code>~/.claude/HUMAN.md</code>, and a clearly marked block in
          your <code>CLAUDE.md</code> that points at it. All of it is yours to read, edit, or
          delete. <code>stratless stop</code> unloads the profile in one command.
        </p>

        <h2>Network calls, the tiered truth</h2>
        <p>
          To read your history and write your profile, stratless borrows
          <strong>the coding assistant you already have installed</strong>. It shells out to it
          (<code>claude -p</code>), on your own subscription or key, and that request goes to your
          assistant's provider exactly as it does when you use it normally. That is the whole
          default story: your own claude, doing the reading.
        </p>
        <p>
          Two things can add one more call. <code>stratless status --check</code> asks the npm
          registry whether a newer version exists, when you run it, on screen. And the after-session
          refresh, which <code>init</code> turns on, is itself your consent to background activity:
          while it is on, a cached once-daily version check rides along during a refresh, so you
          hear about fixes. Run <code>stratless stop</code> and the machine goes fully quiet, with
          nothing ambient at all.
        </p>
        <p>
          <strong>None of it touches us.</strong> We ship no model, hold no key, and run no proxy;
          the version check carries no payload. And when stratless cannot read your history
          honestly, it refuses and writes nothing: silence beats a wrong profile.
        </p>

        <h2>What we collect</h2>
        <p>
          <strong>Nothing.</strong> No telemetry, no analytics, no crash reports, no usage counters,
          no phone-home of any kind. This is not a promise we're asking you to take on trust:
          <a :href="legal.source" target="_blank" rel="noopener">the source is public</a>. Read it
          and confirm the only calls it makes are the ones above: your own <code>claude</code>
          reading your history, and the version check. No payload, no telemetry, nowhere for your
          data to go.
        </p>

        <h2>This website</h2>
        <p>
          {{ legal.site }} is a static site on Cloudflare Pages. It sets no cookies and runs no
          analytics. Cloudflare processes standard request logs (IP address, user agent) as part of
          serving it, which is the same for any website.
        </p>

        <h2>Contact</h2>
        <p>
          <a :href="`mailto:${legal.email}`">{{ legal.email }}</a>
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.legal-body {
  max-width: 42rem;
}
.eff {
  color: var(--mid);
  font-size: 0.9rem;
}
</style>
