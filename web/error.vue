<script setup lang="ts">
/**
 * Vue's runtime error boundary — client-side navigation to a bad route, or a thrown error.
 *
 * Without this file Nuxt renders its BUILT-IN default: a green/teal gradient (#00dc82 / #36e4da)
 * with zero site chrome — no nav, no footer, no way back. A page from a completely different
 * design system.
 *
 * The STATIC 404 (a cold load on a bad URL, which is the common case) is handled separately:
 * pages/not-found.vue + the prerender hook in nuxt.config.ts. Both render <NotFound />, so there is
 * one definition of the page.
 *
 * The chrome here is <SiteHeader /> + <SiteFooter />, the same components the layout uses. It used
 * to be a hand-copied header, which by 2026-07-20 had drifted into three real defects (no sticky
 * positioning, nav links still visible on mobile, no skip link). Nuxt error boundaries CAN render
 * layouts via <NuxtLayout>, but sharing the components keeps this file's own <main> centring — the
 * one thing it legitimately does differently.
 */
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()
useHead({ title: `${props.error?.statusCode ?? 'Error'} — stratless` })
</script>

<template>
  <div class="site">
    <SiteHeader />
    <main id="main">
      <NotFound :code="error?.statusCode ?? 500" :message="error?.message" />
    </main>
    <SiteFooter />
  </div>
</template>

<style scoped>
.site {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
/* the one deliberate difference from the layout: the error body is vertically centred */
main {
  flex: 1;
  display: flex;
  align-items: center;
}
</style>
