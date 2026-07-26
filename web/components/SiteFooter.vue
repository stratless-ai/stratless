<script setup lang="ts">
// The site footer — ONE component, sea band included: the footer floats inside the SeigaihaField
// wave band on every page. The layout renders it after </main> (error.vue does the same), so the
// <footer> stays a real `contentinfo` landmark. No variants, no props.

// The CLI version, read from cli/package.json at build (see nuxt.config.ts).
const version = useRuntimeConfig().public.version
</script>

<template>
  <SeigaihaField>
    <footer class="footer">
      <div class="container footer-inner">
        <Logo :height="24" />
        <nav class="footer-links" aria-label="Footer">
          <NuxtLink to="/docs">Docs</NuxtLink>
          <a href="https://github.com/stratless-ai/stratless" target="_blank" rel="noopener">GitHub</a>
          <NuxtLink to="/privacy">Privacy</NuxtLink>
          <NuxtLink to="/terms">Terms</NuxtLink>
          <a href="mailto:sun@stratless.com">sun@stratless.com</a>
        </nav>
        <p class="footer-copy">stratless v{{ version }} · © 2026 · runs on your machine. Nothing leaves.</p>
      </div>
    </footer>
  </SeigaihaField>
</template>

<style scoped>
/* transparent + borderless so the waves run through it; everything centred — it closes the
   page like a colophon */
.footer-inner {
  padding: 2.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: center;
  text-align: center;
}
.footer-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 1.2rem;
  font-size: 0.9rem;
}
/* resting-clean, underline on hover, 0.9rem/500 — mirrors the header nav so the two read as one system */
.footer-links a {
  text-decoration: none;
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
