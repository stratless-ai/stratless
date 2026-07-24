<script setup lang="ts">
// The stratless logo = ONE shared object (used verbatim in header + footer). The favicon mark IS a stylized
// "S" (scanline-striped glyph on the blue square), so the wordmark drops its leading letter and shows only
// "tratless" in Epetri — mark + wordmark read together as "stratless". The link's aria-label carries the full
// word for screen readers; the mark img is decorative (alt=""). Mark is sized ~as the leading letter with a
// tight gap so [S]tratless reads as one word.
// Sizing rides on --logo-h so a parent media query can shrink the logo responsively (the mobile nav does);
// the height prop only sets the fallback — an inline --logo-h would be un-overridable from CSS.
withDefaults(defineProps<{ height?: number; wordmark?: boolean }>(), { height: 30, wordmark: true })
</script>

<template>
  <NuxtLink to="/" class="logo" :style="{ '--logo-h-default': `${height}px` }" aria-label="stratless, home">
    <!-- Same URL as the <link rel=icon> in nuxt.config, so the browser reuses ONE cache entry.
         width/height attrs are the anti-FOUC: favicon.svg has a viewBox but NO intrinsic size, so on a
         full document load (e.g. back from the console/reference) the img painted FULL-SCREEN for a
         frame before the scoped CSS applied. Attributes size it at parse time; the CSS still wins. -->
    <img src="/favicon.svg" class="mark" alt="" :width="Math.round(height * 0.86)" :height="Math.round(height * 0.86)" />
    <span v-if="wordmark" class="wordmark">tratless</span>
  </NuxtLink>
</template>

<style scoped>
.logo {
  display: inline-flex;
  align-items: center;
  gap: 0.1rem; /* tight — the mark is the leading letter, not a separate icon */
  text-decoration: none;
}
.mark {
  display: block;
  height: calc(var(--logo-h, var(--logo-h-default)) * 0.86);
  width: calc(var(--logo-h, var(--logo-h-default)) * 0.86);
}
.wordmark {
  font-size: calc(var(--logo-h, var(--logo-h-default)) * 0.74);
}
</style>
