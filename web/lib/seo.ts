/**
 * Per-page SEO.
 *
 * Every OG/Twitter tag used to live in `app.head` in nuxt.config.ts — which meant EVERY route
 * shipped the homepage's `og:url`, description and card. Sharing `/docs/why` previewed as the
 * homepage. The JSON-LD `SoftwareApplication` block asserted `url: stratless.com` on `/privacy`,
 * `/terms` and all seven docs pages too.
 *
 * The global tags in nuxt.config.ts stay as the DEFAULT (correct for `/`). This overrides them
 * per page, and adds the `canonical` that nothing was declaring — Cloudflare Pages 308-redirects
 * `/docs` → `/docs/`, so both forms are reachable and neither was marked canonical.
 */
export const SITE = 'https://stratless.com'

export function useSeo(opts: { title: string; description: string; path: string }) {
  // Trailing slash: Pages serves the directory form, so canonicalise to it (except the root).
  // The leading slash is FORCED — a caller passing 'terms' instead of '/terms' would otherwise
  // silently produce `https://stratless.comterms/`, which is a valid string and a broken URL.
  const raw = opts.path.startsWith('/') ? opts.path : `/${opts.path}`
  const path = raw === '/' ? '/' : `${raw.replace(/\/+$/, '')}/`
  const url = `${SITE}${path}`

  useHead({
    title: `${opts.title} — stratless`,
    link: [{ rel: 'canonical', href: url }],
    meta: [
      { name: 'description', content: opts.description },
      { property: 'og:title', content: `${opts.title} — stratless` }, // branded, like <title>
      { property: 'og:description', content: opts.description },
      { property: 'og:url', content: url },
      { name: 'twitter:title', content: `${opts.title} — stratless` },
      { name: 'twitter:description', content: opts.description },
    ],
  })
}
