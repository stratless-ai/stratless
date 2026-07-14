<script setup lang="ts">
/**
 * The 404 body. ONE definition, TWO consumers:
 *
 *   error.vue      — Vue's runtime error boundary (client-side navigation to a bad route)
 *   pages/404.vue  — a real page, purely so Nitro will PRERENDER it to static HTML
 *
 * The second one exists because Nitro refuses to emit HTML for a route that returns 404, and
 * Nuxt ships `404.html` as an EMPTY SPA shell. Cloudflare Pages serves that file for every
 * unknown URL — so without this, a stranger who mistypes a link gets a blank manila page and
 * then, once JS boots, Nuxt's own green-gradient default error page. A build hook in
 * nuxt.config.ts copies the prerendered `/404/index.html` over `404.html` and deletes the
 * directory, so the page paints instantly and the route itself is never publicly reachable.
 */
withDefaults(defineProps<{ code?: number | string; message?: string }>(), { code: 404 })

const GITHUB = 'https://github.com/stratless-ai/stratless-cli'
</script>

<template>
  <section class="section err">
    <div class="container err-inner">
      <p class="eyebrow">{{ code }}</p>
      <h1 v-if="String(code) === '404'">This page isn’t here.</h1>
      <h1 v-else>Something broke.</h1>

      <p v-if="String(code) === '404'" class="lede">
        No assistant edit wrote this URL, and neither did you. Try the docs, or start over.
      </p>
      <p v-else class="lede">{{ message || 'An unexpected error occurred.' }}</p>

      <div class="cta-row">
        <Btn href="/" primary>Home</Btn>
        <Btn href="/docs">Docs</Btn>
        <Btn :href="GITHUB" target="_blank" rel="noopener">GitHub</Btn>
      </div>
    </div>
  </section>
</template>

<style scoped>
.err {
  width: 100%;
  padding-top: 6rem;
}
.err-inner {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.1rem;
}
h1 {
  font-size: clamp(1.8rem, 4vw, 2.8rem);
  line-height: 1.15;
  margin: 0;
}
.lede {
  max-width: 30rem;
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
</style>
