<script setup lang="ts">
// The site footer — ONE shared component (the layout renders it on every page; the homepage opts
// out via definePageMeta({ footer: false }) and renders it itself inside the SeigaihaField band).
// `bare` = the sea variant: transparent + borderless, so the waves run through it.
withDefaults(defineProps<{ bare?: boolean }>(), { bare: false })

// The CLI version, read from cli/package.json at build (see nuxt.config.ts).
const version = useRuntimeConfig().public.version
</script>

<template>
  <footer class="footer" :class="{ bare }">
    <div class="container footer-inner">
      <Logo :height="24" />
      <nav class="footer-links">
        <NuxtLink to="/docs">Docs</NuxtLink>
        <a href="https://github.com/stratless-ai/stratless" target="_blank" rel="noopener">GitHub</a>
        <NuxtLink to="/privacy">Privacy</NuxtLink>
        <NuxtLink to="/terms">Terms</NuxtLink>
        <a href="mailto:sun@stratless.com">sun@stratless.com</a>
      </nav>
      <p class="footer-copy">stratless v{{ version }} · © 2026 — runs on your machine. Nothing leaves.</p>
    </div>
  </footer>
</template>

<style scoped>
.footer {
  border-top: 1.5px solid var(--ink);
  background: var(--paper-2);
  /* no margin-top: every page's last section carries its own bottom padding, and a gap here
     tears a strip of bare paper out of the band above (seen on the seigaiha band, 2026-07-07) */
}
.footer.bare {
  border-top: none;
  background: transparent;
}
/* the sea footer centres its objects — it closes the page like a colophon */
.footer.bare .footer-inner {
  align-items: center;
  text-align: center;
}
.footer.bare .footer-links {
  justify-content: center;
}
.footer-inner {
  padding: 2.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.footer-links {
  display: flex;
  flex-wrap: wrap;
  gap: 1.2rem;
  font-size: 0.9rem;
}
/* resting-clean, underline on hover, 0.9rem/500 — mirrors the header nav so the two read as one system */
.footer-links a {
  text-decoration: none;
  font-weight: 500;
}
.footer-links a:hover {
  text-decoration: underline;
}
.footer-copy {
  color: var(--mid);
  font-size: 0.9rem;
  margin: 0;
}
</style>
