import { readFileSync } from 'node:fs'

const TITLE = 'stratless · Turn your logs into skills.'
// Mechanism and pain both land inside the first ~155 chars, so a search snippet never truncates
// mid-claim. Deliberately does NOT repeat the headline — the title already carries it, and a
// duplicated line spends the snippet twice.
const DESC =
  'Stratless measures how you actually work and installs the skills your history already earned, receipts on every line. Nothing declared, everything counted. Runs locally. Nothing leaves your machine.'
const URL = 'https://stratless.com'

// The version shown on the site is the CLI's real version, read from cli/package.json at BUILD so it
// can never drift from what `npx stratless` installs. Site + CLI flip together, so at deploy time
// this equals the npm-published version. (It is currently ahead of npm during 0.2.0 development.)
const VERSION = (
  JSON.parse(readFileSync(new globalThis.URL('../cli/package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version

export default defineNuxtConfig({
  runtimeConfig: {
    public: { version: VERSION },
  },
  // No modules. Not one. The docs renderer is markdown-it in lib/docs.ts, and the
  // language switcher is CSS-only. Every dependency here is a dependency you have to maintain
  // alone, forever, and this site is maintained by a solo builder with a CLI to ship.
  ssr: true,
  compatibilityDate: '2026-07-14',
  css: ['~/assets/css/main.css'],

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: TITLE,
      script: [
        {
          type: 'application/ld+json',
          // Structured data for search and answer engines: what stratless IS, machine-readable.
          // The version is NOT stamped here on purpose — it would freeze at build time and rot.
          innerHTML: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'stratless',
            applicationCategory: 'DeveloperApplication',
            operatingSystem: 'macOS, Linux',
            description:
              'Turns your own AI conversation logs into skills your coding assistant gains. Reads Claude Code and Codex history locally, measures what recurs, and installs evidence-backed skills into each tool\'s native skill directory. Free, MIT, nothing leaves your machine.',
            url: 'https://stratless.com',
            downloadUrl: 'https://www.npmjs.com/package/stratless',
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
            license: 'https://opensource.org/licenses/MIT',
          }),
        },
      ],
      link: [
        { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
        // iOS home screen + anything that won't take an SVG. Full-bleed on the tile's own blue so
        // the platform's corner mask never exposes gaps. Regenerate: wrap favicon.svg in a 180×180
        // page on #A3CFDC, screenshot with headless chrome (same trick as scripts/og-card.html).
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        // PRELOAD EVERY FONT THAT IS STILL FETCHED.
        //
        // This list must equal the set of url('/fonts/…') sources in assets/css/main.css. It drifted
        // once and it cost us: from 2026-07-16 to 2026-07-20 this comment claimed "all four are
        // font-display: swap" while the CSS actually said `optional`, because db5330f changed main.css
        // and never touched this file. `optional` gives a font ~100ms and then FORBIDS the swap, so 9
        // of every 12 first-time visitors rendered the entire site in system sans — permanently, after
        // downloading all 163KB. See the long note above the @font-face blocks in main.css.
        //
        // What a preload does and does not do: it moves discovery into the first request wave. It does
        // NOT remove the round trip. On a cold connection (DNS + TLS + TCP) no preload can beat a 100ms
        // deadline — which is exactly why the fix was to stop depending on winning that race, not to
        // add more hints. Epetri and Evogria are no longer here because they are now inlined as data:
        // URIs in main.css: zero round trips, correct on the first paint, no race to lose.
        //
        // The three below are `font-display: swap` with metric-matched fallbacks, so a late arrival
        // restyles text without moving it. Preloading still buys a faster correct frame.
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/space-grotesk.woff2', crossorigin: '' }, // h1-h4
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/inter/inter-400.woff2', crossorigin: '' }, // body + prose
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/inter/inter-700.woff2', crossorigin: '' }, // <strong>, active nav
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
        { property: 'og:image', content: `${URL}/og.png?v=5` },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: TITLE },
        { name: 'twitter:description', content: DESC },
        { name: 'twitter:image', content: `${URL}/og.png?v=5` },
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
