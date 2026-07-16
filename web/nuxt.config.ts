import { readFileSync, readdirSync } from 'node:fs'

const TITLE = 'stratless · teach your AI coding assistant who you are'
const DESC =
  'stratless reads your coding-assistant sessions and writes a HUMAN.md your AI loads every session, so it stops talking over your head. Runs locally. Nothing leaves your machine.'
const URL = 'https://stratless.com'

// The version shown on the site is the CLI's real version, read from cli/package.json at BUILD so it
// can never drift from what `npx stratless` installs. Site + CLI flip together, so at deploy time
// this equals the npm-published version. (It is currently ahead of npm during 0.2.0 development.)
const VERSION = (
  JSON.parse(readFileSync(new globalThis.URL('../cli/package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version

// The line-count trust claim ("~N lines you can audit in an afternoon") is COMPUTED at build,
// never hand-typed — it went stale twice (900, then 1,500 while the tool was 1,858). Counts
// cli/src/*.ts minus tests, rounded UP to the next hundred so the claim stays true as code grows.
// Pages read it from runtimeConfig; the docs markdown carries a %CLI_LINES% token that lib/docs.ts
// substitutes via the __CLI_LINES__ define below.
const CLI_LINES = (() => {
  const dir = new globalThis.URL('../cli/src/', import.meta.url)
  let n = 0
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue
    n += readFileSync(new globalThis.URL(f, dir), 'utf8').split('\n').length
  }
  return (Math.ceil(n / 100) * 100).toLocaleString('en-US')
})()

export default defineNuxtConfig({
  runtimeConfig: {
    public: { version: VERSION, cliLines: CLI_LINES },
  },
  vite: {
    define: { __CLI_LINES__: JSON.stringify(CLI_LINES) },
  },
  // No modules. Not one. The docs renderer is 83 lines of markdown-it in lib/docs.ts, and the
  // language switcher is CSS-only. Every dependency here is a dependency you have to maintain
  // alone, forever, and this site is maintained by a solo builder with a CLI to ship.
  ssr: true,
  compatibilityDate: '2026-07-14',
  css: ['~/assets/css/main.css'],

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: TITLE,
      link: [
        { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
        // iOS home screen + anything that won't take an SVG. Full-bleed on the tile's own blue so
        // the platform's corner mask never exposes gaps. Regenerate: wrap favicon.svg in a 180×180
        // page on #A3CFDC, screenshot with headless chrome (same trick as scripts/og-card.html).
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        // PRELOAD EVERY ABOVE-THE-FOLD FONT.
        //
        // All four are `font-display: swap`, so without a preload the browser paints the page in
        // ui-sans-serif, THEN the real font arrives and every headline, paragraph and button
        // visibly jumps. That flash-of-the-wrong-font on each refresh is the "default that isn't
        // the main view" — the fonts are discovered late, inside the CSS, after the first paint.
        //
        // The preload hint moves them into the very first request wave, so they land before the
        // text does and nothing swaps. Only epetri (2.6KB, the logo) was preloaded before, which is
        // why the logo was the one thing that never flickered.
        //
        // Every one of these is visible in the hero:
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/space-grotesk.woff2', crossorigin: '' }, // h1
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/inter/inter-400.woff2', crossorigin: '' }, // body
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/evogria.woff2', crossorigin: '' }, // the CTA buttons
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/epetri.woff2', crossorigin: '' }, // the logo wordmark
      ],
      meta: [
        { name: 'description', content: DESC },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        // browser chrome tint on mobile — the page's paper, so the UI reads as one surface
        { name: 'theme-color', content: '#e9e5d8' },
        { property: 'og:type', content: 'website' },
        { property: 'og:title', content: TITLE },
        { property: 'og:description', content: DESC },
        { property: 'og:url', content: `${URL}/` }, // match the canonical's trailing slash
        { property: 'og:image', content: `${URL}/og.png` },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: TITLE },
        { name: 'twitter:description', content: DESC },
        { name: 'twitter:image', content: `${URL}/og.png` },
      ],
    },
  },

  nitro: {
    prerender: {
      // `crawlLinks` discovers the six child docs pages by following DocsShell's nav array.
      // ⚠️ That array is HAND-MAINTAINED. Add a .md to content/docs/ and forget the nav, and the
      // route exists, nothing links it, the crawler never sees it, and no HTML is emitted — so a
      // refresh on that URL hits the error page. The two lists agree by discipline, not by
      // construction. If you add a doc, add the nav entry.
      crawlLinks: true,
      routes: ['/', '/docs', '/privacy', '/terms', '/not-found'],
      // `not-found` is a real page (pages/not-found.vue) that renders <NotFound />. It exists
      // ONLY so Nitro will prerender the error body to static HTML — Nitro emits NOTHING for a
      // route that 404s, and RESERVES the name `/404` outright. The hook below moves its output
      // over `404.html` (which Nuxt ships as an EMPTY SPA shell) and deletes the route.
      failOnError: false,
    },
    hooks: {
      // Cloudflare Pages serves `404.html` for any route it can't find. Nuxt ships that file as
      // the SPA fallback with an empty <div id="__nuxt"></div>, so a stranger who mistypes a URL
      // gets a blank manila page, then — once JS loads — the error page pops in.
      //
      // We prerender `/not-found` (a real page rendering <NotFound />), then overwrite the empty
      // shell with its HTML and DELETE the route. A 404 now paints instantly — nav, footer, a way
      // back — with no JS. And /not-found is not publicly reachable.
      //
      // Two silent traps cost an hour here: Nitro reserves `/404` (emits nothing), and Nuxt ignores
      // any pages/ file beginning with `_`. Neither warns you.
      async close() {
        const { readFile, writeFile, rm, readdir } = await import('node:fs/promises')
        const { join } = await import('node:path')
        const dir = join(process.cwd(), '.output', 'public')
        try {
          const rendered = await readFile(join(dir, 'not-found', 'index.html'), 'utf8')
          await writeFile(join(dir, '404.html'), rendered)
          await rm(join(dir, 'not-found'), { recursive: true, force: true })
          console.log('[stratless] 404.html ← the prerendered error page (not the empty SPA shell)')
        } catch (e) {
          console.warn(`[stratless] ⚠ /not-found did not prerender — 404.html is still the empty shell: ${e}`)
        }
        // SITEMAP — built by walking the emitted `**/index.html`, AFTER the 404 shuffle above, so it
        // lists exactly what shipped (crawled docs pages included) and can never name a dead route.
        try {
          const routes: string[] = []
          const walk = async (d: string, rel: string): Promise<void> => {
            for (const ent of await readdir(d, { withFileTypes: true })) {
              if (ent.isDirectory()) await walk(join(d, ent.name), `${rel}${ent.name}/`)
              else if (ent.name === 'index.html') routes.push(rel)
            }
          }
          await walk(dir, '/')
          routes.sort()
          const xml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            ...routes.map((r) => `  <url><loc>https://stratless.com${r}</loc></url>`),
            '</urlset>',
            '',
          ].join('\n')
          await writeFile(join(dir, 'sitemap.xml'), xml)
          console.log(`[stratless] sitemap.xml ← ${routes.length} routes`)
        } catch (e) {
          console.warn(`[stratless] ⚠ sitemap.xml not written: ${e}`)
        }
      },
    },
  },
})
