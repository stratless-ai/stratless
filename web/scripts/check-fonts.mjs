#!/usr/bin/env node
/**
 * THE FONT GATE — runs against the built site, before it is allowed to deploy.
 *
 * WHY THIS EXISTS. On 2026-07-20 we found that 9 of every 12 first-time visitors to stratless.com
 * rendered the entire site in system sans, permanently, after downloading all 163KB of fonts. The
 * cause was `font-display: optional` (shipped 2026-07-16 in db5330f): it gives a font ~100ms and
 * then FORBIDS the swap, and a first visit cannot win 100ms because it pays DNS + TLS + TCP first.
 *
 * It shipped green. Nothing could have caught it:
 *   - `nuxi generate` does not evaluate @font-face.
 *   - the post-deploy smoke test is `curl -o /dev/null` — it asserts a status code, not pixels.
 *   - CLS was a perfect 0, because nothing ever swapped. The metric was clean BECAUSE of the bug.
 *   - every local test is a warm test: `nuxi dev` serves fonts from localhost in <5ms, so `optional`
 *     always wins on a developer's machine. The failure only exists on a cold, real connection.
 *
 * So this checks the two things that actually broke, in the one condition that reveals them:
 * a genuinely cold browser profile on a throttled link.
 *
 *   1. THE INLINED BRAND FACES MUST BE USABLE BEFORE FIRST CONTENTFUL PAINT. Epetri (wordmark) and
 *      Evogria (CTA) are data: URIs precisely so there is no race to lose. If someone converts them
 *      back to a url() fetch, this fails.
 *   2. EVERY DECLARED FACE MUST ACTUALLY LOAD. Catches a renamed/deleted file, a bad path, or a
 *      preload pointing at something that no longer exists.
 *   3. NO FACE MAY USE `font-display: optional`. The literal regression, asserted literally.
 *   4. PRELOADS AND @font-face MUST AGREE. These are two hand-maintained lists; they drifted within
 *      48 hours last time and the stale comment outlived the code by four days.
 *
 * Run: node scripts/check-fonts.mjs   (expects .output/public to exist — run `nuxi generate` first)
 */
import puppeteer from 'puppeteer-core'
import { createServer } from 'node:http'
import { readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '.output', 'public')
const PORT = 8123
const TMP = join(dirname(fileURLToPath(import.meta.url)), '..', '.font-check-profiles')

// The faces that must be ready before the page paints. These are the inlined ones.
const INLINED = [
  ['Epetri', '400 16px Epetri'],
  ['Evogria', '400 16px Evogria'],
]
// Every face the CSS declares, and the spec that proves it loaded.
const ALL = [
  ...INLINED,
  ['Space Grotesk', '700 16px "Space Grotesk"'],
  ['Inter 400', '400 16px Inter'],
  ['Inter 700', '700 16px Inter'],
]

// CHROME_PATH wins, but only if it actually exists — otherwise a stale path in CI config would
// hard-fail the deploy gate for a reason that has nothing to do with fonts.
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p))

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.xml': 'application/xml', '.txt': 'text/plain', '.ico': 'image/x-icon',
}

const fail = []
const note = (ok, msg) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) fail.push(msg) }

// ── static checks on the built artifact (no browser needed) ─────────────────
async function staticChecks() {
  console.log('\nBUILD ARTIFACT')
  const html = await readFile(join(ROOT, 'index.html'), 'utf8')

  note(!/font-display:\s*optional/.test(html),
    'no @font-face uses `font-display: optional` (the 2026-07-16 regression)')

  // PER FACE, not a count. This is the deterministic guard on the property the timing check can only
  // approximate: a brand face served from a data: URI has no network race to lose. Asserted by name
  // so a failure says WHICH face regressed, rather than "found 1 of 2" and leaving you to diff.
  for (const [name] of INLINED) {
    const face = html.match(new RegExp(`@font-face\\s*\\{[^}]*?['"]?${name}['"]?[^}]*?\\}`, 'is'))
    note(!!face && /url\(\s*['"]?data:font\/woff2;base64/i.test(face[0]),
      `"${name}" is inlined as a data: URI, not fetched`)
  }

  // preloads ⇔ @font-face url() sources must be the same set
  const preloaded = [...html.matchAll(/<link[^>]+rel="preload"[^>]+href="([^"]+\.woff2)"/g)].map((m) => m[1])
  const referenced = [...new Set([...html.matchAll(/url\((?:'|")?(\/fonts\/[^'")]+\.woff2)/g)].map((m) => m[1]))]
  const missingPreload = referenced.filter((f) => !preloaded.includes(f))
  const orphanPreload = preloaded.filter((f) => !referenced.includes(f))
  note(missingPreload.length === 0, `every fetched face is preloaded${missingPreload.length ? ` — missing: ${missingPreload}` : ''}`)
  note(orphanPreload.length === 0, `no preload points at an unused face${orphanPreload.length ? ` — orphaned: ${orphanPreload}` : ''}`)

  // every referenced file must exist on disk
  for (const f of referenced) {
    note(existsSync(join(ROOT, f)), `${f} exists in the build output`)
  }
}

// ── the cold-load browser check ─────────────────────────────────────────────
async function browserCheck(routes) {
  if (!CHROME) { fail.push('no Chrome binary found (set CHROME_PATH)'); return }
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (p.endsWith('/')) p += 'index.html'
    try {
      const body = await readFile(join(ROOT, p))
      res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' })
      res.end(body)
    } catch { res.writeHead(404).end('nope') }
  })
  await new Promise((r) => server.listen(PORT, r))

  console.log('\nCOLD FIRST VISIT  (fresh profile, no cache, 20 Mbps / 60ms)')
  for (const route of routes) {
    const dir = join(TMP, route.replace(/\W+/g, '_') || 'root')
    await rm(dir, { recursive: true, force: true })
    const browser = await puppeteer.launch({
      executablePath: CHROME, headless: 'new', userDataDir: dir,
      args: ['--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage'],
    })
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      // Poll from the first frame: when did each face become usable, and when was first paint?
      await page.evaluateOnNewDocument((ALL) => {
        window.__ready = {}
        window.__cls = 0
        // THE FIRST MOMENT WE CAN LOOK AT ALL. `document.fonts.check` is polled from animation
        // frames, so every reading is quantised to the frame cadence: ~16.7ms when the machine is
        // idle, and far coarser when it is not. Comparing that against a precise FCP timestamp is
        // what made this gate flaky — a CI runner under load put the first frame 4ms AFTER paint and
        // failed a page whose fonts were never fetched at all. Recording the first tick lets us ask
        // the question the instrument can actually answer.
        // THE INSTRUMENT'S OWN RESOLUTION, measured live. Every reading below is quantised to the
        // frame cadence, so the widest gap between frames is the largest error a reading can carry.
        // Using it as the tolerance is self-calibrating: ~16ms on an idle machine, wider exactly
        // when the machine is loaded, which is when the old zero-tolerance check flaked.
        window.__firstTick = undefined
        window.__maxGap = 0
        let last
        const tick = () => {
          const t = performance.now()
          if (window.__firstTick === undefined) window.__firstTick = t
          if (last !== undefined) window.__maxGap = Math.max(window.__maxGap, t - last)
          last = t
          for (const [name, spec] of ALL) {
            if (window.__ready[name] === undefined) {
              try { if (document.fonts.check(spec)) window.__ready[name] = t } catch {}
            }
          }
          if (Object.keys(window.__ready).length < ALL.length) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        try {
          new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__fcp = e.startTime })
            .observe({ type: 'paint', buffered: true })
        } catch {}
        try {
          new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value })
            .observe({ type: 'layout-shift', buffered: true })
        } catch {}
      }, ALL)
      const cdp = await page.target().createCDPSession()
      await cdp.send('Network.enable')
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false, downloadThroughput: (20 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8, latency: 60,
      })
      await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: 'networkidle0', timeout: 60000 })
      await new Promise((r) => setTimeout(r, 1200))
      const r = await page.evaluate(() => ({ ready: window.__ready, fcp: window.__fcp, cls: window.__cls, firstTick: window.__firstTick, maxGap: window.__maxGap }))

      console.log(`\n  ${route}`)
      for (const [name] of ALL) {
        const t = r.ready[name]
        note(t !== undefined, `${route} — "${name}" loaded`)
      }
      // THE LOAD-BEARING ASSERTION: the inlined faces are usable before the page paints.
      //
      // Tolerated by ONE FRAME, and the reason is the instrument rather than the site. Readiness is
      // polled from animation frames, so a reading can be a whole frame late purely because that is
      // when we next got to look; FCP is a precise timestamp with no such error. Comparing the two
      // at zero tolerance measured runner load as much as it measured the site, and failed a page
      // by 4ms on 2026-08-01 whose fonts were never fetched at all. The tolerance is the widest
      // frame gap actually observed on this run, so it widens exactly when the machine is loaded.
      //
      // Note an inlined face still needs a frame or two to DECODE — measured here at ~20ms after
      // the first tick with no network involved — which is why "ready at the first frame" is the
      // wrong bar and "before paint, within the measurement's error" is the right one.
      for (const [name] of INLINED) {
        const t = r.ready[name]
        if (t === undefined) continue
        const slack = r.maxGap || 17
        note(t <= r.fcp + slack,
          `${route} — "${name}" usable before first paint ` +
            `(${t.toFixed(0)}ms vs FCP ${r.fcp?.toFixed(0)}ms, ±${slack.toFixed(0)}ms frame)`)
      }
      // (A request-URL check lived here briefly and was removed: it only caught a fetch whose URL
      // happened to be NAMED after the face, so it reported a cheerful pass while Evogria was being
      // served from another file. The per-face data: URI assertion above is the exact test.)
      note(r.cls < 0.02, `${route} — CLS ${r.cls.toFixed(5)} under 0.02`)
    } finally {
      await browser.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
  server.close()
  await rm(TMP, { recursive: true, force: true })
}

// ── run ─────────────────────────────────────────────────────────────────────
if (!existsSync(ROOT)) {
  console.error(`✗ ${ROOT} not found — run \`nuxi generate\` first.`)
  process.exit(1)
}
await staticChecks()
// Homepage plus one docs page: between them they exercise every declared face.
await browserCheck(['/', '/docs/'])

console.log('')
if (fail.length) {
  console.error(`✗ FONT GATE FAILED — ${fail.length} check(s):`)
  for (const f of fail) console.error(`    - ${f}`)
  process.exit(1)
}
console.log('✓ font gate passed')
