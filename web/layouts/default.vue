<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

// Pages can take over the footer (the homepage renders it inside its seigaiha band).
const route = useRoute()

// Auto-hiding header: hide on scroll down, reveal on scroll up or near the top.
// The ±6px deadband stops jitter; rAF-throttled so the passive listener stays cheap.
// navClear: at the very top the header goes fully transparent — the hero's fog band bleeds up
// behind it (index.vue's .hero has margin-top:-58px, exactly this bar's height, so the canvas
// starts at y=0 and the animation runs behind the header); paper + blur return on scroll.
const navHidden = ref(false)
const navClear = ref(true)
let lastY = 0
let ticking = false
const onScroll = () => {
  if (ticking) return
  ticking = true
  requestAnimationFrame(() => {
    const y = window.scrollY
    const delta = y - lastY
    if (y < 80) navHidden.value = false
    else if (delta > 6) navHidden.value = true
    else if (delta < -6) navHidden.value = false
    navClear.value = y < 40
    lastY = y
    ticking = false
  })
}
onMounted(() => {
  lastY = window.scrollY
  navClear.value = window.scrollY < 40
  window.addEventListener('scroll', onScroll, { passive: true })
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
</script>

<template>
  <div class="site">
    <!-- keyboard users skip the header in one Tab — visible only while focused -->
    <a class="skip" href="#main">Skip to content</a>
    <header class="nav" :class="{ 'nav-hidden': navHidden, 'nav-clear': navClear }">
      <div class="nav-inner">
        <!-- Logo's ROOT is already a <NuxtLink to="/">. Wrapping it in another one ships
             <a href="/"><a href="/">…</a></a>, which the HTML5 parser forbids: it runs the
             adoption-agency algorithm and re-parses them as SIBLINGS. Vue then hydrates against a
             DOM that doesn't match its vnodes and throws the whole header away and re-renders it
             client-side — a visible flash on every page load, on every route. SiteFooter does it
             right: bare <Logo />. -->
        <Logo :height="24" />
        <nav class="nav-right">
          <NuxtLink to="/docs">Docs</NuxtLink>
          <a href="https://github.com/stratless-ai/stratless" target="_blank" rel="noopener">GitHub</a>
        </nav>
      </div>
    </header>

    <main id="main">
      <slot />
    </main>

    <SiteFooter v-if="route.meta.footer !== false" />
  </div>
</template>

<style scoped>
.site {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
/* off-screen until keyboard focus lands on it; then a small card above the nav */
.skip {
  position: fixed;
  top: 0.6rem;
  left: 0.6rem;
  z-index: 20; /* above .nav (10) */
  transform: translateY(-250%);
  background: var(--paper-2);
  color: var(--ink);
  border: 1.5px solid var(--ink);
  border-radius: 8px;
  padding: 0.5rem 0.9rem;
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;
}
.skip:focus-visible {
  transform: none;
}
.nav {
  background: color-mix(in srgb, var(--paper) 85%, transparent);
  backdrop-filter: blur(6px);
  position: sticky;
  top: 0;
  z-index: 10;
  transition:
    transform 0.28s ease,
    background-color 0.25s ease;
}
.nav-clear {
  /* at the top of the page: invisible bar — the hero band shows through */
  background: transparent;
  backdrop-filter: none;
}
.nav-hidden {
  transform: translateY(-100%);
}
.nav-hidden:focus-within {
  transform: none; /* keyboard focus inside the nav always reveals it */
}
@media (prefers-reduced-motion: reduce) {
  .nav {
    transition: none;
  }
}
/* 2 zones: logo hard-left, links hard-right. Full-width — no 72rem cap. */
.nav-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 58px;
  width: 100%;
  padding: 0 1.4rem 0 1.9rem;
}
.nav-right {
  display: flex;
  align-items: center;
  gap: 1.4rem;
  font-size: 0.9rem;
}
.nav-right a {
  font-weight: 500;
  text-decoration: none;
  color: var(--ink);
}
.nav-right a:hover {
  text-decoration: underline;
}
main {
  flex: 1;
}
/* footer markup + styles live in SiteFooter.vue (shared with the homepage's sea variant) */
@media (max-width: 640px) {
  /* mobile: header = the logo alone — links are reachable in-page (hero CTA, footer) */
  .nav-right {
    display: none;
  }
}
</style>
