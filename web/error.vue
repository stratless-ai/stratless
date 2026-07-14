<script setup lang="ts">
/**
 * Vue's runtime error boundary — client-side navigation to a bad route, or a thrown error.
 *
 * Without this file Nuxt renders its BUILT-IN default: a green/teal gradient (#00dc82 / #36e4da)
 * with zero site chrome — no nav, no footer, no way back. A page from a completely different
 * design system.
 *
 * The STATIC 404 (a cold load on a bad URL, which is the common case) is handled separately:
 * pages/404.vue + the prerender hook in nuxt.config.ts. Both render <NotFound />, so there is
 * one definition of the page.
 */
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()
useHead({ title: `${props.error?.statusCode ?? 'Error'} — stratless` })
</script>

<template>
  <div class="site">
    <header class="nav">
      <div class="nav-inner">
        <Logo :height="24" />
        <nav class="nav-right">
          <NuxtLink to="/docs">Docs</NuxtLink>
          <a href="https://github.com/stratless-ai/stratless-cli" target="_blank" rel="noopener">GitHub</a>
        </nav>
      </div>
    </header>
    <main>
      <NotFound :code="error?.statusCode ?? 500" :message="error?.message" />
    </main>
    <SiteFooter />
  </div>
</template>

<style scoped>
.site { min-height: 100vh; display: flex; flex-direction: column; }
.nav { background: color-mix(in srgb, var(--paper) 85%, transparent); backdrop-filter: blur(6px); }
.nav-inner { display: flex; align-items: center; justify-content: space-between; height: 58px; width: 100%; padding: 0 1.4rem 0 1.9rem; }
.nav-right { display: flex; align-items: center; gap: 1.4rem; font-size: 0.9rem; }
.nav-right a { font-weight: 500; text-decoration: none; color: var(--ink); }
.nav-right a:hover { text-decoration: underline; }
main { flex: 1; display: flex; align-items: center; }
</style>
