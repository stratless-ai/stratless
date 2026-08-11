import MarkdownIt from 'markdown-it'

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

// PERFORMED SESSIONS GET A TERMINAL. A fence whose first line starts with `$ ` is a transcript —
// the reader should see the window it happened in, matching the hero's terminal. Bare one-line
// fences (`npx stratless`) stay plain: those are for copying, and chrome on a copy target is
// noise. Prompt lines get the shell's own emphasis; output lines stay untouched.
const escapeHtml = (x: string): string => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const defaultFence = md.renderer.rules.fence!.bind(md.renderer.rules)
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const content = tokens[idx]!.content
  if (!content.startsWith('$ ')) return defaultFence(tokens, idx, options, env, self)
  const body = content
    .replace(/\r/g, '')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) =>
      line.startsWith('$ ')
        ? `<span class="dt-p">$</span> <span class="dt-c">${escapeHtml(line.slice(2))}</span>`
        : escapeHtml(line),
    )
    .join('\n')
  return `<div class="docterm"><div class="docterm-bar" aria-hidden="true"><span class="dt-dot dt-r"></span><span class="dt-dot dt-y"></span><span class="dt-dot dt-g"></span></div><pre class="docterm-body"><code>${body}</code></pre></div>
`
}

export interface Doc {
  title: string
  html: string
  toc: { id: string; text: string }[]
}

// Heading id from its text: lowercase, punctuation stripped, spaces to hyphens. This is the anchor
// a browser expects for `/docs/x#heading`. markdown-it emits no ids, so we stamp them at build.
const slug = (s: string): string =>
  s.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60)

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
    // Stamp heading ids and collect the h2 TOC at BUILD time, so deep links (`/docs/x#heading`) and
    // the "On this page" rail both work on a cold load, with no JS and no post-hydration flash.
    const env = {}
    const tokens = md.parse(body, env)
    const toc: { id: string; text: string }[] = []
    const used = new Set<string>()
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!
      if (t.type !== 'heading_open') continue
      const text = tokens[i + 1]?.content?.trim() ?? ''
      if (!text) continue
      const base = slug(text) || 'section'
      let id = base
      for (let n = 2; used.has(id); n++) id = `${base}-${n}` // dedupe repeated headings
      used.add(id)
      t.attrSet('id', id)
      if (t.tag === 'h2') toc.push({ id, text })
    }
    out[`/docs${p ? `/${p}` : ''}`] = { title, html: md.renderer.render(tokens, md.options, env), toc }
  }
  return out
}

export const docs = buildDocs()
