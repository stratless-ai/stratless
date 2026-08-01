<script setup lang="ts">
import { legal } from '~/lib/legal'
import { useSeo } from '~/lib/seo'
useSeo({
  title: 'Terms',
  description:
    "stratless is free, open-source software under the MIT licence. It runs on your machine. There is no service to subscribe to and nothing to pay for.",
  path: '/terms',
})
</script>

<template>
  <section class="section legal">
    <div class="container">
      <div class="legal-body prose">
        <h1>Terms</h1>
        <p class="eff">Effective {{ legal.effectiveDate }}</p>

        <p>
          <strong>stratless is free, open-source software under the {{ legal.license }} licence.</strong>
          It runs on your machine. There is no service to subscribe to, no account to create, and
          nothing to pay for. These terms cover the software and this website, nothing more.
        </p>

        <h2>The licence is the agreement</h2>
        <p>
          Your use of stratless is governed by the
          <a :href="legal.source" target="_blank" rel="noopener">{{ legal.license }} licence</a>, which
          ships in the repository. You may use, copy, modify, and redistribute it, including
          commercially. It is provided <strong>“as is”, without warranty of any kind</strong>.
        </p>

        <h2>What it does, and what it does not promise</h2>
        <p>
          stratless reads your coding assistants' own conversation history and writes a profile of
          you (<code>HUMAN.md</code>) that your assistants load at the start of each session. It is
          built to <strong>refuse rather than guess</strong>: when it cannot read your history
          honestly, it says nothing. But it is software, and software is wrong sometimes.
        </p>
        <p>
          <strong>Do not treat the profile as authoritative.</strong> It is a description of you,
          not a fact about you. Read it, and if it reads wrong, edit it, delete it, or unload it
          with <code>stratless stop</code>.
        </p>

        <h2>Third-party software it downloads</h2>
        <p>
          Finding the patterns in your history runs on a small open-weights model that stratless
          downloads to your machine once, at <code>init</code>, after asking you. Two pieces of
          third-party software are involved, each under its own licence, and neither is ours:
        </p>
        <ul>
          <li>
            <strong>bge-small-en-v1.5</strong> (BAAI) — the model weights, ~34MB, MIT licence.
          </li>
          <li>
            <strong>@stratless/runtime</strong> — the runtime that executes them (transformers.js,
            Apache-2.0, and ONNX Runtime, MIT, pre-bundled to WASM; upstream licences ship inside
            the package), ~3MB.
          </li>
        </ul>
        <p>
          The download is fetched from the third-party host that distributes them, and that request
          is subject to that host's own terms. {{ legal.operator }} does not host, modify, or
          warrant either one. Both are provided by their authors <strong>“as is”</strong>, and the
          limitation of liability below applies to them exactly as it does to stratless itself.
          Once they are on your machine, that step runs offline and reaches nothing further.
        </p>

        <h2>Your own assistant, your own bill</h2>
        <p>
          Naming what the model found is done by the coding assistant already installed on your
          machine, on your own subscription or key. Any cost, rate limit, or term attached to that
          is between you and that provider. {{ legal.operator }} is not a party to it.
        </p>

        <h2>Liability</h2>
        <p>
          To the fullest extent permitted by law, {{ legal.operator }} and {{ legal.entity }} are not
          liable for any loss or damage arising from your use of the software or this site. You run
          it on your own machine, against your own code, at your own risk.
        </p>

        <h2>Governing law</h2>
        <p>These terms are governed by the laws of {{ legal.jurisdiction }}.</p>

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
