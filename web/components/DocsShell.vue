<script setup lang="ts">
import { docs } from '~/lib/docs'
import { useSeo } from '~/lib/seo'

const GITHUB = 'https://github.com/stratless-ai/stratless'

const route = useRoute()
const current = computed(() => docs[route.path.replace(/\/+$/, '') || '/docs'])

// The docs for the CLI. Until 2026-07-14 /docs was a *redirect* to the API's Scalar reference —
// the site had no docs of its own. These are the first real ones stratless has ever had.
const nav = [
  {
    group: 'stratless',
    links: [
      { to: '/docs', label: 'Install' },
      { to: '/docs/human-md', label: 'HUMAN.md' },
      { to: '/docs/commands', label: 'Commands' },
      { to: '/docs/assistants', label: 'Assistants' },
    ],
  },
  {
    group: 'Under the hood',
    links: [
      { to: '/docs/how-it-works', label: 'How it works' },
      { to: '/docs/limits', label: 'Honest limits' },
      { to: '/docs/privacy', label: 'Privacy' },
    ],
  },
]

// prev/next: the nav flattened in reading order (the Scalar/docs-site convention)
const flat = nav.flatMap((g) => g.links)
const currentIdx = computed(() => flat.findIndex((l) => l.to === (route.path.replace(/\/+$/, '') || '/docs')))
const prev = computed(() => (currentIdx.value > 0 ? flat[currentIdx.value - 1] : null))
const next = computed(() => (currentIdx.value >= 0 && currentIdx.value < flat.length - 1 ? flat[currentIdx.value + 1] : null))

// "On this page" — the h2s and their ids are stamped at BUILD time in lib/docs.ts, so the rail
// ships in the static HTML (no post-hydration flash), the anchors work on a cold load, and it
// updates on client-side nav for free (it is a computed off `current`, no watcher needed).
const toc = computed(() => current.value?.toc ?? [])

// Phones: the stacked sidebar cost a full screen of scrolling before content on every docs page,
// so under 860px (the stacking breakpoint) it collapses behind a toggle. The closed state is CSS
// (`display: none` in the media query), not this ref — the prerendered HTML arrives closed on
// mobile and open on desktop with no hydration snap. A no-JS phone still has the prev/next pager.
const navOpen = ref(false)
watch(() => route.path, () => {
  navOpen.value = false
})

// Each doc page needs its OWN og:url, description and canonical. They all used to inherit the
// homepage's, so sharing /docs/why previewed as the homepage.
const strip = (html: string) => {
  const text = html
    .replace(/<pre[\s\S]*?<\/pre>/g, ' ') // code blocks make garbage previews (the command list, sliced mid-word)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // cut at a word boundary, never mid-word
  return text.length <= 180 ? text : `${text.slice(0, 180).replace(/\s+\S*$/, '')}…`
}

useSeo({
  title: current.value?.title ?? 'Docs',
  description: current.value ? strip(current.value.html) : 'Documentation for stratless.',
  path: route.path,
})
</script>

<template>
  <div class="docs container">
    <aside class="docs-nav">
      <button
        type="button"
        class="nav-toggle"
        :aria-expanded="navOpen"
        aria-controls="docs-nav-menu"
        @click="navOpen = !navOpen"
      >
        <span>Docs menu</span>
        <span aria-hidden="true">{{ navOpen ? '−' : '+' }}</span>
      </button>
      <nav id="docs-nav-menu" aria-label="Documentation" :class="{ 'nav-open': navOpen }">
        <div v-for="g in nav" :key="g.group" class="nav-group">
          <span class="nav-group-title">{{ g.group }}</span>
          <NuxtLink
            v-for="l in g.links"
            :key="l.to"
            :to="l.to"
            class="nav-link"
            :class="{ active: (route.path.replace(/\/+$/, '') || '/docs') === l.to }"
          >
            {{ l.label }}
          </NuxtLink>
        </div>
        <div class="nav-group">
          <span class="nav-group-title">Source</span>
          <a class="nav-link" :href="GITHUB" target="_blank" rel="noopener">GitHub ↗</a>
        </div>
      </nav>
    </aside>

    <article class="docs-body prose">
      <!-- eslint-disable-next-line vue/no-v-html -- trusted, build-time markdown -->
      <div v-if="current" v-html="current.html" />
      <div v-else class="notfound">
        <h1>Not found</h1>
        <p>That page doesn’t exist yet. Try <NuxtLink to="/docs">Install</NuxtLink>.</p>
      </div>

      <!-- prev / next (reading order = the sidebar order) -->
      <nav v-if="prev || next" class="docs-pn" aria-label="Docs pagination">
        <NuxtLink v-if="prev" :to="prev.to" class="pn pn-prev">
          <span class="pn-k">← Previous</span>
          <span class="pn-t">{{ prev.label }}</span>
        </NuxtLink>
        <NuxtLink v-if="next" :to="next.to" class="pn pn-next">
          <span class="pn-k">Next →</span>
          <span class="pn-t">{{ next.label }}</span>
        </NuxtLink>
      </nav>

      <div class="docs-cta">
        <Btn :href="GITHUB" primary target="_blank" rel="noopener">Read the source</Btn>
      </div>
    </article>

    <!-- "On this page" — the Scalar-style right rail (client-built from the rendered h2s) -->
    <aside v-if="toc.length > 1" class="docs-toc" aria-label="On this page">
      <span class="toc-title">On this page</span>
      <a v-for="t in toc" :key="t.id" :href="`#${t.id}`" class="toc-link">{{ t.text }}</a>
    </aside>
  </div>
</template>

<style scoped>
.docs {
  display: grid;
  grid-template-columns: 15rem minmax(0, 1fr) 11rem;
  gap: 3rem;
  padding-top: 2.5rem;
  padding-bottom: 5rem;
  align-items: start;
}
.docs-nav {
  position: sticky;
  top: 80px;
}
/* the mobile collapse toggle — desktop never renders it */
.nav-toggle {
  display: none;
}
.nav-group {
  margin-bottom: 1.5rem;
  display: flex;
  flex-direction: column;
}
.nav-group-title {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mid);
  margin-bottom: 0.5rem;
}
.nav-link {
  font-family: var(--font-read);
  font-size: 0.92rem;
  color: var(--ink-2);
  text-decoration: none;
  padding: 0.28rem 0.6rem;
  border-left: 2px solid transparent;
}
.nav-link:hover {
  color: var(--ink);
  background: var(--paper-2);
}
.nav-link.active {
  color: var(--accent-deep);
  border-left-color: var(--accent-deep);
  /* 700, not 600: the Inter 600 face was dropped 2026-07-20 (24,452B for this one rule). 700 is a face we
     already ship, so the weight cue survives without a fifth font request. */
  font-weight: 700;
}
.docs-body {
  min-width: 0;
  max-width: 46rem;
}
/* readability: a slightly larger reading size + calmer paragraph rhythm than the site default */
.docs-body :deep(p),
.docs-body :deep(li) {
  font-size: 1.01rem;
  line-height: 1.75;
}
.docs-body :deep(h2) {
  scroll-margin-top: 80px; /* anchor jumps land below the sticky header */
}
.docs-body :deep(h3) {
  scroll-margin-top: 80px;
}
/* the right rail */
.docs-toc {
  position: sticky;
  top: 80px;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  border-left: 1px solid rgba(21, 20, 15, 0.15);
  padding-left: 0.9rem;
}
.toc-title {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mid);
  margin-bottom: 0.45rem;
}
.toc-link {
  font-family: var(--font-read);
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--ink-2);
  text-decoration: none;
  padding: 0.14rem 0;
}
.toc-link:hover {
  color: var(--accent-deep);
}
/* prev / next — the site's button language: 1.5px ink border + hard offset shadow,
   hover-lift and press like .btn. Flex (not a 1fr/1fr grid) so a solo card hugs its
   side as a real button instead of stranding a half-width panel with an empty half. */
.docs-pn {
  display: flex;
  gap: 1rem;
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid rgba(21, 20, 15, 0.15);
}
.pn {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 11.5rem; /* the .btn footprint — a consistent button size, not a stretched panel */
  max-width: 24rem;
  text-decoration: none;
  padding: 0.55rem 0.9rem;
  border: 1.5px solid var(--ink);
  border-radius: var(--radius);
  background: var(--paper-2);
  box-shadow: var(--shadow);
  transition:
    transform var(--dur) ease,
    box-shadow var(--dur) ease;
}
.pn:hover {
  transform: translate(-1px, -1px);
  box-shadow: var(--shadow-lg);
}
.pn:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 var(--ink);
}
.pn-next {
  margin-left: auto; /* pushes Next to the right edge; a solo Next lands right, a solo Prev stays left */
  text-align: right;
}
.pn-k {
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  letter-spacing: 0.1em;
  line-height: 1.3;
  text-transform: uppercase;
  color: var(--mid);
}
.pn-t {
  font-family: var(--font-mono);
  font-size: var(--fs-md);
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.25;
  color: var(--accent-deep);
}
.docs-cta {
  margin-top: 3rem;
  padding-top: 2rem;
  border-top: 1px solid rgba(21, 20, 15, 0.15);
  display: flex;
  gap: 0.9rem;
  flex-wrap: wrap;
}

@media (max-width: 1100px) {
  .docs {
    grid-template-columns: 15rem minmax(0, 1fr);
  }
  .docs-toc {
    display: none;
  }
}
@media (max-width: 860px) {
  .docs {
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }
  .docs-nav {
    position: static;
    border-bottom: 1.5px solid var(--ink);
    padding-bottom: 1rem;
  }
  .nav-toggle {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink);
    background: var(--paper-2);
    border: 1.5px solid var(--ink);
    border-radius: var(--radius);
    padding: 0.6rem 0.9rem;
    cursor: pointer;
  }
  /* closed is the shipped state: the static HTML lands collapsed on phones, no hydration snap */
  .docs-nav nav {
    display: none;
    margin-top: 1.25rem;
  }
  .docs-nav nav.nav-open {
    display: block;
  }
}
@media (max-width: 560px) {
  /* stack the pager so two 11.5rem button-cards never overflow a phone */
  .docs-pn {
    flex-direction: column;
  }
  .pn {
    max-width: none;
  }
  .pn-next {
    margin-left: 0;
    text-align: left;
  }
}
</style>
