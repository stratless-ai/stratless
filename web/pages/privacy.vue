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
          your conversations, your evidence, or your skills, because there is nowhere for it to go.
        </p>

        <h2>What stratless reads</h2>
        <p>
          Your coding assistants' own conversation history, which is already on your disk. Claude
          Code keeps it in <code>~/.claude/projects</code> and Codex keeps it in
          <code>~/.codex/sessions</code>; stratless reads whichever of those are actually present,
          and keeps its own archive copy in <code>~/.stratless/archive</code>. That copy exists
          because Claude Code deletes its transcripts after 30 days. Codex has no such timer, so
          nothing there is being rescued from anything. It reads those transcripts locally.
          <strong>It does not send them anywhere.</strong>
        </p>

        <h2>What it writes, and where</h2>
        <p>
          Everything stratless derives is a plain text file on your machine under
          <code>~/.stratless</code>: the moments and scores, and each pair's evidence file
          (<code>HUMAN.&lt;assistant&gt;.md</code>) — internal to stratless; it is read at the
          sitting and never loaded into any assistant. The one thing written elsewhere is the
          thing you said yes to: the skillpack — plain skill files installed into each
          assistant's own skill directory (<code>~/.claude/skills</code>,
          <code>~/.codex/skills</code>), every file marked as stratless-minted and carrying its
          own evidence receipts. All of it is yours to read, edit, or delete.
          <code>stratless stop</code> removes every minted skill from every assistant in one
          command; your own skills are never touched.
        </p>
        <p>
          Beyond that, it touches only what it must, and only for assistants you actually have.
          <strong>It writes no instructions file and no memory:</strong> your
          <code>CLAUDE.md</code> and <code>AGENTS.md</code> are never stratless's to write, and
          if an older stratless version left a marked block in one of them, the next run removes
          it and never recreates it. What it does add is the after-session refresh: a
          <code>Stop</code> hook in <code>~/.claude/settings.json</code>, a
          <code>SessionEnd</code> hook in <code>~/.codex/hooks.json</code>, and on Claude Code
          only, the <code>cleanupPeriodDays</code> setting that stops the 30-day deletion. Codex
          asks you to approve its hook before it will run; that approval is yours to give inside
          Codex, and stratless never writes it for you. An assistant you do not have is never
          written to at all.
        </p>

        <h2>Network calls, the tiered truth</h2>
        <p>
          <strong>Three things ever touch the network.</strong> That is the complete list.
        </p>
        <p>
          <strong>1. Your own assistant.</strong> Most of the work happens here with no model at
          all: reading your history, finding the patterns in it, and every count in your evidence and
          your skills are plain arithmetic. The few moments that need judgment borrow
          <strong>the coding assistant you already have installed</strong> and shells out to it
          (<code>claude -p</code>, or <code>codex exec</code>), on your own subscription or key:
          naming what the maths found, wording the evidence, and proposing your skills at the
          sitting — each quoted or covered by a consent you gave before it spends. That request
          goes to your assistant's provider exactly as it does when you use it normally.
        </p>
        <p>
          A borrowed call is deliberately given nothing: no instruction files, no memory, no session
          to resume, so it cannot read the evidence it is helping to write. <strong>How that is
          enforced differs by assistant, and the difference is worth stating rather than
          averaging.</strong> The Claude Code borrow runs with no tools at all, so it has no way to
          touch your disk. The Codex borrow has no equivalent switch; instead it runs in a read-only
          sandbox, in an empty directory, with a scratch configuration, which your operating system
          enforces rather than a flag we pass. That is stronger in one respect, since it does not
          depend on a setting being honored, and weaker in another: it is containment rather than an
          absence of hands, so a borrowed Codex call could in principle read a file where a borrowed
          Claude call could not. Neither can write anything, and neither is given your evidence beyond the question itself.
        </p>
        <p>
          <strong>2. A one-time engine download, at <code>init</code>, with your consent.</strong>
          The pattern-finding runs on a small local engine: a ~3MB runtime (from
          registry.npmjs.org) and a ~34MB open-weights model (from huggingface.co), both pinned to
          exact checksums in the tool's published code. They have to arrive once.
          <code>init</code> itemizes them before it happens and asks; nothing downloads in the
          background, the npm package itself carries zero dependencies, and the after-session
          refresh never fetches anything. After they land, that step is permanently offline.
        </p>
        <p>
          <strong>3. The version check.</strong> <code>stratless status --check</code> asks the npm
          registry whether a newer version exists, when you run it, on screen. And the after-session
          refresh, which <code>init</code> turns on, is itself your consent to background activity:
          while it is on, a cached once-daily version check rides along during a refresh, so you
          hear about fixes. Run <code>stratless stop</code> and the machine goes fully quiet, with
          nothing ambient at all.
        </p>
        <p>
          <strong>Notice the direction.</strong> Two of those three are things coming
          <em>in</em> — software arriving once, like any install. The only thing that ever goes
          <em>out</em> is the borrowed call to your own assistant. We hold no key and run no proxy;
          the version check carries no payload. And when stratless cannot read your history
          honestly, it refuses and writes nothing: silence beats a wrong claim about you.
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
