import MarkdownIt from 'markdown-it'

// Injected by the `vite.define` in nuxt.config.ts — the CLI line count, computed at build so the
// docs' trust claim can never go stale by hand. Markdown carries it as a %CLI_LINES% token.
declare const __CLI_LINES__: string

/**
 * The docs renderer. Runs ONCE at module load (not per component mount), so the generated HTML is
 * identical on the server and the client → clean hydration.
 *
 * This is the entire docs engine: a glob, markdown-it, and a route map. There is no
 * `@nuxt/content`, and no Nuxt modules at all. Every dependency here is one a solo maintainer has
 * to carry forever.
 *
 * A `code-tabs` fence renderer used to live here — a CSS-only language switcher for the old API's
 * cURL/Python/Node examples. It was ~40 lines of markdown-it plugin plus 58 lines of global CSS
 * inlined into every prerendered page, and NOT ONE markdown file used it. `npx stratless` is one
 * command; there are no language variants to switch between. Deleted 2026-07-14.
 */
const md = new MarkdownIt({ html: false, linkify: true, typographer: true })
// Docs name files constantly (`HUMAN.md`, `package.json`). `.md` is a real TLD, so linkify would dress
// `foo.md` as a domain link. fuzzyLink:false keeps explicit https:// links but stops the scheme-less ones.
md.linkify.set({ fuzzyLink: false })

export interface Doc {
  title: string
  html: string
}

function buildDocs(): Record<string, Doc> {
  // Every markdown file under content/docs/ becomes a route. `1.why.md` → `/docs/why` (the numeric
  // prefix only orders the files on disk); `index.md` → `/docs`.
  //
  // ⚠️ These routes are prerendered ONLY because `crawlLinks: true` follows the hand-maintained
  // `nav` array in DocsShell.vue. Add a .md here and forget the nav, and the route exists, nothing
  // links to it, the crawler never sees it, no HTML is emitted — and a refresh on that URL lands
  // on the error page. The two lists agree by discipline, not by construction. Keep them in sync.
  const raws = import.meta.glob('/content/docs/**/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>

  const out: Record<string, Doc> = {}
  // Sorted keys so the output is deterministic across server and client.
  for (const key of Object.keys(raws).sort()) {
    const raw = raws[key]!
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
    const front = fm ? fm[1]! : ''
    const body = fm ? fm[2]! : raw
    const title = front.match(/title:\s*['"]?(.+?)['"]?\s*$/m)?.[1] ?? 'Docs'
    let p = key.replace('/content/docs/', '').replace(/\.md$/, '')
    p = p
      .split('/')
      .map((seg) => seg.replace(/^\d+\./, ''))
      .join('/')
      .replace(/\/?index$/, '')
    out[`/docs${p ? `/${p}` : ''}`] = { title, html: md.render(body.replaceAll('%CLI_LINES%', __CLI_LINES__)) }
  }
  return out
}

export const docs = buildDocs()
