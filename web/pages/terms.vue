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
          stratless reads your coding assistant's own conversation history and writes a profile of
          you (<code>HUMAN.md</code>) that your assistant loads at the start of each session. It is
          built to <strong>refuse rather than guess</strong>: when it cannot read your history
          honestly, it says nothing. But it is software, and software is wrong sometimes.
        </p>
        <p>
          <strong>Do not treat the profile as authoritative.</strong> It is a description of you,
          not a fact about you. Read it, and if it reads wrong, edit it, delete it, or unload it
          with <code>stratless stop</code>.
        </p>

        <h2>Your own assistant, your own bill</h2>
        <p>
          The reading and the writing are done by the coding assistant already installed on your
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
