import MarkdownIt from 'markdown-it'

/**
 * Renders the sample artifacts shown in the "person layer" file-windows (AGENTS.md / HUMAN.md).
 *
 * Same shape as `docs.ts`: a `?raw` glob + markdown-it, run ONCE at module load so the HTML is
 * identical on server and client → clean hydration. No `@nuxt/content`, no Nuxt modules — just the
 * one dependency the docs engine already carries.
 *
 * The files under `content/samples/` are real, point-in-time snapshots. `HUMAN.md` is a frozen copy
 * of the maker's own `~/.claude/HUMAN.md` (it refreshes every session); re-pull it before a flip.
 */
const md = new MarkdownIt({ html: false, linkify: true, typographer: true })

export interface Sample {
  name: string
  html: string
}

function buildSamples(): Record<string, Sample> {
  const raws = import.meta.glob('/content/samples/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>

  const out: Record<string, Sample> = {}
  for (const key of Object.keys(raws).sort()) {
    const name = key.replace('/content/samples/', '')
    out[name] = { name, html: md.render(raws[key]!) }
  }
  return out
}

export const samples = buildSamples()
