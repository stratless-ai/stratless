<script setup lang="ts">
import { useSeo } from '~/lib/seo'
/**
 * NOT a real page. It exists because Nitro refuses to emit HTML for a route that 404s, and Nuxt
 * ships `404.html` as an EMPTY SPA shell — which Cloudflare Pages then serves for every unknown
 * URL, giving a stranger a blank page until JS boots.
 *
 * So: render the error body at a route that returns 200, let Nitro prerender it, and have the
 * `close` hook in nuxt.config.ts copy its HTML over `404.html` and DELETE the directory.
 *
 * ⚠️ TWO traps here, both hit during development:
 *   · Nitro RESERVES `/404` and silently emits nothing for it.
 *   · Nuxt IGNORES any pages/ file starting with `_` (treated as private) — so `_not-found.vue`
 *     produced no route at all, also silently.
 * Hence the plain name.
 * The URL /_not-found does not exist in the shipped site; the hook removes it.
 */
useSeo({ title: 'Not found', description: 'That page does not exist.', path: '/not-found' })
</script>

<template>
  <NotFound :code="404" />
</template>
