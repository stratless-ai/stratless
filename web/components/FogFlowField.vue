<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

// The fog & flow band — the hero's living layer, one self-contained absolute fill.
// Two worlds render every frame at ~1/3 resolution, quantized to the daylight-terminal
// palette through an 8×8 Bayer matrix and upscaled with smoothing off (the ordered-dither
// language of the fog&flow study artifact, 2026-07-08): a calm drifting MIST on top, and an
// endless freight line beneath it that runs whether anyone looks or not (flow = the fact;
// fog = the facade). The cursor etches 2-art-px cells out of the fog mask (destination-in);
// each cell seals itself ~0.3–1s later. Idle "leaks" flicker open at train height so an
// untouched hero still hints at the motion. Pointer listeners live on the PARENT section so
// hovering the headline parts the fog too — the copy stays selectable, nothing is overlaid.

const canvas = ref<HTMLCanvasElement>()

/* ── ordered dither + tileable value noise (pure, module-safe) ── */
const B8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map((v) => (v + 0.5) / 64)

function mulberry(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const smooth = (t: number) => t * t * (3 - 2 * t)

function noiseTile(seed: number): Float32Array {
  const S = 512
  const out = new Float32Array(S * S)
  const periods = [128, 64, 32, 16]
  const amps = [0.5, 0.25, 0.15, 0.1]
  for (let o = 0; o < periods.length; o++) {
    const p = periods[o]!
    const g = S / p
    const rnd = mulberry(seed * 77 + o * 131)
    const grid = new Float32Array(g * g)
    for (let i = 0; i < g * g; i++) grid[i] = rnd()
    for (let y = 0; y < S; y++) {
      const gy = y / p
      const y0 = Math.floor(gy)
      const fy = smooth(gy - y0)
      const y1 = (y0 + 1) % g
      const r0 = (y0 % g) * g
      const r1 = y1 * g
      for (let x = 0; x < S; x++) {
        const gx = x / p
        const x0 = Math.floor(gx)
        const fx = smooth(gx - x0)
        const x1 = (x0 + 1) % g
        const a = grid[r0 + (x0 % g)]!
        const b = grid[r0 + x1]!
        const c = grid[r1 + (x0 % g)]!
        const d = grid[r1 + x1]!
        out[y * S + x] += amps[o]! * (a + (b - a) * fx + (c + (d - c) * fx - (a + (b - a) * fx)) * fy)
      }
    }
  }
  let mn = Infinity
  let mx = -Infinity
  for (const v of out) {
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  const r = 1 / (mx - mn)
  for (let i = 0; i < out.length; i++) out[i] = (out[i]! - mn) * r
  return out
}

const intHash = (i: number) => {
  let x = (i | 0) ^ 61 ^ (i >>> 16)
  x = (x + (x << 3)) | 0
  x ^= x >>> 4
  x = Math.imul(x, 0x27d4eb2d)
  x ^= x >>> 15
  return x >>> 0
}
const hf = (i: number) => intHash(i) / 4294967296

/* ── palette (the site is daylight-only; tuned in the hero-preview artifact) ── */
const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const p32 = (a: string[]) =>
  Uint32Array.from(
    a.map((c) => {
      const [r, g, b] = hex(c)
      return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
    }),
  )
const P = {
  // fog ramp deepened one notch (Sun 2026-07-08, "slightly darker") — highlights kept, tail sunk;
  // the hero's CSS placeholder gradient + seam border (index.vue) mirror this ramp — keep in step.
  fog: ['#fbfaf5', '#f3f2ea', '#e7e7dd', '#d6dad2', '#c5ccc4'],
  sky: ['#4a7d92', '#6fa2b5', '#8fc0cf', '#a3cfdc', '#c8e4ec'],
  cloud: ['#f6f3ea', '#ffffff'],
  ridge: '#9db6ba',
  ground: ['#3b382c', '#4a463a', '#575244'],
  rail: '#e9e5d8',
  railSh: '#2a281f',
  bodies: ['#15140f', '#1f2c31', '#4a7d92', '#2c2a20', '#a3cfdc'],
  winOn: '#f6f3ea',
  winOnAlt: '#ffffff',
  winOff: '#2e2b22',
  winInk: '#15140f',
  streaks: ['#f6f3ea', '#c8e4ec'],
  head: '#ffffff',
}

onMounted(() => {
  const view = canvas.value
  const host = view?.parentElement
  if (!view || !host) return
  const vctx = view.getContext('2d')
  if (!vctx) return

  const T1 = noiseTile(11)
  const T2 = noiseTile(29)
  const FOGPAL = p32(P.fog)
  const FL = P.fog.length
  const mk = () => document.createElement('canvas')
  const fogC = mk()
  const bgC = mk()
  const trainC = mk()
  const revC = mk()
  const maskC = mk()
  const fctx = fogC.getContext('2d')!
  const bctx = bgC.getContext('2d')!
  const tctx = trainC.getContext('2d')!
  const rctx = revC.getContext('2d')!
  const mctx = maskC.getContext('2d')!
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')

  let artW = 0
  let artH = 0
  let gw = 0
  let gh = 0
  let dpr = 1
  let fogImg: ImageData | null = null
  let fogPx: Uint32Array | null = null
  let groundTop = 0
  let trainY = 0

  /* static backdrop: dithered sky + clouds + ridge + track bed */
  const buildStatic = () => {
    const skyPal = P.sky.map(hex)
    const cloudPal = P.cloud.map(hex)
    const ridge = hex(P.ridge)
    const img = bctx.createImageData(artW, artH)
    const px = new Uint32Array(img.data.buffer)
    const hor = groundTop
    const rg = new Int16Array(artW)
    for (let x = 0; x < artW; x++) rg[x] = hor - 3 - Math.floor(T1[(37 << 9) | ((x * 3) & 511)]! * 12)
    const put = (i: number, c: [number, number, number]) => {
      px[i] = ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0
    }
    for (let y = 0; y < artH; y++) {
      const bay = (y & 7) << 3
      for (let x = 0; x < artW; x++) {
        const i = y * artW + x
        if (y >= hor) {
          put(i, skyPal[4]!)
          continue
        }
        const g = y / hor
        const cn = T1[((y * 2) & 511) << 9 | (x & 511)]!
        const cn2 = T2[(((y * 3 + 55) & 511) << 9) | ((x * 3 + 31) & 511)]!
        const cl = cn * 0.6 + cn2 * 0.55
        if (y >= rg[x]!) {
          put(i, ridge)
          continue
        }
        if (cl > 0.72 - g * 0.25 && y < hor * 0.97) {
          const cf = Math.min(0.999, (cl - (0.72 - g * 0.25)) * 4) * (cloudPal.length - 1)
          let cb = Math.floor(cf)
          if (cf - cb > B8[bay | (x & 7)]!) cb++
          put(i, cloudPal[Math.min(cb, cloudPal.length - 1)]!)
        } else {
          const v = g * 0.75 + cn * 0.45 - 0.12
          const f = Math.min(0.999, Math.max(0, v)) * (skyPal.length - 1)
          let b = Math.floor(f)
          if (f - b > B8[bay | (x & 7)]!) b++
          put(i, skyPal[Math.min(b, skyPal.length - 1)]!)
        }
      }
    }
    const gp = P.ground.map(hex)
    const rail = hex(P.rail)
    const sh = hex(P.railSh)
    for (let y = hor; y < artH; y++) {
      const bay = (y & 7) << 3
      for (let x = 0; x < artW; x++) {
        const n = T2[(((y * 5 + 200) & 511) << 9) | ((x * 4) & 511)]!
        const f = Math.min(0.999, n) * (gp.length - 1)
        let b = Math.floor(f)
        if (f - b > B8[bay | (x & 7)]!) b++
        put(y * artW + x, gp[Math.min(b, gp.length - 1)]!)
      }
    }
    for (let x = 0; x < artW; x++) {
      put((hor + 2) * artW + x, rail)
      put((hor + 3) * artW + x, sh)
      if (x % 6 < 3) {
        put((hor + 5) * artW + x, sh)
        put((hor + 6) * artW + x, gp[0]!)
      }
    }
    bctx.putImageData(img, 0, 0)
  }

  /* fog — misty, low contrast, horizontally stretched strata */
  const renderFog = (t: number) => {
    if (!fogImg || !fogPx) return
    const m = reduced.matches ? 0.3 : 1
    const ox1 = Math.floor(t * 7 * m)
    const oy1 = Math.floor(t * 2.3 * m)
    const ox2 = Math.floor(-t * 11 * m)
    const oy2 = Math.floor(t * 3.1 * m)
    const px = fogPx
    let i = 0
    for (let y = 0; y < artH; y++) {
      const r1 = ((((y * 1.4) | 0) + oy1) & 511) << 9
      const r2 = ((((y * 2.4) | 0) + oy2) & 511) << 9
      const bay = (y & 7) << 3
      const vb = (y / artH - 0.55) * 0.08
      for (let x = 0; x < artW; x++) {
        let v = 0.62 * T1[r1 | ((x + ox1) & 511)]! + 0.38 * T2[r2 | ((((x * 2.4) | 0) + ox2) & 511)]!
        v = 0.5 + (v - 0.5) * 0.85 - 0.02 + vb
        const f = Math.min(0.999, Math.max(0, v)) * (FL - 1)
        let b = Math.floor(f)
        if (f - b > B8[bay | (x & 7)]!) b++
        px[i++] = FOGPAL[b >= FL ? FL - 1 : b]!
      }
    }
    fctx.putImageData(fogImg, 0, 0)
  }

  /* the endless train — speed = flow */
  const CAR = 56
  const GAP = 7
  const PITCH = CAR + GAP
  const BODY = 20
  const BASE_SPEED = 300
  const FLOW = 1.4
  let offset = 0
  let flowMult = FLOW
  type Streak = { x: number; y: number; len: number; f: number; c: number }
  let streaks: Streak[] = []
  const initStreaks = () => {
    streaks = []
    const rnd = mulberry(7)
    for (let k = 0; k < 18; k++)
      streaks.push({
        x: rnd() * artW,
        y: Math.floor(rnd() * (groundTop - 14)) + 6,
        len: 8 + rnd() * 22,
        f: 0.45 + rnd() * 0.55,
        c: Math.floor(rnd() * 2),
      })
  }
  const drawCar = (i: number, sx: number, t: number) => {
    const bodyCols = P.bodies
    const h = intHash(i)
    const isLoco = ((i % 14) + 14) % 14 === 0
    const body = bodyCols[h % bodyCols.length]!
    const lightBody = h % bodyCols.length === 4
    if (isLoco) {
      tctx.fillStyle = bodyCols[1]!
      tctx.fillRect(sx - 2, trainY - 4, CAR + 2, BODY + 4)
      tctx.fillRect(sx - 9, trainY + 6, 8, BODY - 2)
      tctx.fillRect(sx - 5, trainY + 1, 4, 5)
      tctx.fillStyle = P.winOn
      tctx.fillRect(sx + 4, trainY - 1, 10, 5)
      tctx.fillStyle = P.head
      tctx.fillRect(sx - 10, trainY + 9, 2, 2)
    } else {
      const type = h % 3
      tctx.fillStyle = body
      if (type === 2) {
        tctx.fillRect(sx + 2, trainY + 4, CAR - 4, BODY - 6)
        tctx.fillRect(sx + 5, trainY + 2, CAR - 10, 2)
        tctx.fillStyle = P.winOff
        tctx.fillRect(sx + 24, trainY, 8, 3)
      } else if (type === 1) {
        tctx.fillRect(sx + 1, trainY + BODY - 9, CAR - 2, 9)
        tctx.fillStyle = bodyCols[(h >> 4) % bodyCols.length]!
        tctx.fillRect(sx + 5, trainY, CAR - 16, 8)
      } else {
        tctx.fillRect(sx, trainY, CAR, BODY)
        const tick = Math.floor(t * 9 * flowMult)
        for (let wy = 0; wy < 2; wy++)
          for (let wx = 0; wx < 9; wx++) {
            const on = (intHash(i * 131 + wx * 17 + wy * 57 + tick) & 7) < 6
            tctx.fillStyle = on
              ? lightBody
                ? P.winInk
                : (intHash(i + wx * 3 + wy) & 15) === 0
                  ? P.winOnAlt
                  : P.winOn
              : P.winOff
            tctx.fillRect(sx + 5 + wx * 5.5, trainY + 4 + wy * 8, 3, 4)
          }
      }
    }
    tctx.fillStyle = P.railSh
    tctx.fillRect(sx + 5, trainY + BODY, 8, 3)
    tctx.fillRect(sx + CAR - 13, trainY + BODY, 8, 3)
    const speedPx = BASE_SPEED * flowMult
    const smear = Math.min(30, Math.max(4, speedPx * 0.055))
    tctx.fillStyle = isLoco ? P.bodies[1]! : body
    for (let y = trainY + (i & 1); y < trainY + BODY; y += 2)
      tctx.fillRect(sx + CAR, y, smear * (0.35 + 0.65 * hf(i * 7 + y)), 1)
  }
  const drawTrain = (t: number, dt: number) => {
    tctx.drawImage(bgC, 0, 0)
    const speedPx = BASE_SPEED * flowMult * (reduced.matches ? 0.4 : 1)
    for (const s of streaks) {
      s.x -= speedPx * s.f * dt * 0.9
      if (s.x < -s.len) {
        s.x = artW + Math.random() * 60
        s.y = 6 + Math.random() * (groundTop - 20)
        s.len = 8 + Math.random() * 22
      }
      tctx.fillStyle = P.streaks[s.c]!
      tctx.fillRect(Math.round(s.x), s.y, Math.round(s.len), 1)
    }
    offset += speedPx * dt
    const i0 = Math.floor((offset - CAR - 34) / PITCH)
    const i1 = Math.ceil((offset + artW) / PITCH)
    for (let i = i0; i <= i1; i++) drawCar(i, Math.round(i * PITCH - offset), t)
  }

  /* etch-trail mask — 1 mask px = 2 art px = one chunky reveal cell */
  let expires = new Float64Array(0)
  let jit = new Float32Array(0)
  const alive = new Set<number>()
  const resetMask = () => {
    gw = Math.ceil(artW / 2)
    gh = Math.ceil(artH / 2)
    maskC.width = gw
    maskC.height = gh
    expires = new Float64Array(gw * gh)
    jit = new Float32Array(gw * gh)
    const rnd = mulberry(99)
    for (let i = 0; i < jit.length; i++) jit[i] = rnd()
    alive.clear()
  }
  const reveal = (cx: number, cy: number, R: number, lifeBase: number, lifeRand: number) => {
    const now = performance.now()
    const x0 = Math.max(0, Math.floor(cx - R))
    const x1 = Math.min(gw - 1, Math.ceil(cx + R))
    const y0 = Math.max(0, Math.floor(cy - R))
    const y1 = Math.min(gh - 1, Math.ceil(cy + R))
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx
        const dy = y - cy
        const d = Math.sqrt(dx * dx + dy * dy)
        const idx = y * gw + x
        if (d + jit[idx]! * 2.6 < R) {
          const e = now + lifeBase + Math.random() * lifeRand + (1 - d / R) * 420
          if (e > expires[idx]!) expires[idx] = e
          alive.add(idx)
        }
      }
  }
  const drawMask = () => {
    const now = performance.now()
    mctx.clearRect(0, 0, gw, gh)
    mctx.fillStyle = '#fff'
    for (const idx of alive) {
      if (expires[idx]! <= now) {
        alive.delete(idx)
        continue
      }
      mctx.fillRect(idx % gw, (idx / gw) | 0, 1, 1)
    }
  }

  /* pointer — on the HOST section, so hovering the copy parts the fog too */
  let last: [number, number] | null = null
  const toCell = (e: PointerEvent): [number, number] => {
    const r = host.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * gw, ((e.clientY - r.top) / r.height) * gh]
  }
  const onMove = (e: PointerEvent) => {
    const [cx, cy] = toCell(e)
    const R = 10
    if (last) {
      const dx = cx - last[0]
      const dy = cy - last[1]
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (R * 0.6)))
      for (let s = 1; s <= steps; s++) reveal(last[0] + (dx * s) / steps, last[1] + (dy * s) / steps, R, 140, 520)
    } else reveal(cx, cy, R, 140, 520)
    last = [cx, cy]
  }
  const onDown = (e: PointerEvent) => {
    const [cx, cy] = toCell(e)
    reveal(cx, cy, 15, 300, 700)
    last = [cx, cy]
  }
  const onLeave = () => {
    last = null
  }
  host.addEventListener('pointermove', onMove)
  host.addEventListener('pointerdown', onDown)
  host.addEventListener('pointerleave', onLeave)

  /* idle leaks — brief glimpses of the line at train height */
  const leakTimer = window.setInterval(() => {
    if (reduced.matches || document.hidden) return
    if (Math.random() < 0.75) {
      const cy = (trainY + BODY * 0.5) / 2 + (Math.random() - 0.5) * 8
      reveal(Math.random() * gw, cy, 2 + Math.random() * 3, 180, 320)
    }
  }, 480)

  /* layout */
  const resize = () => {
    const r = host.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return
    dpr = Math.min(2, window.devicePixelRatio || 1)
    const scale = Math.max(3, Math.round(r.width / 480))
    artW = Math.ceil(r.width / scale)
    artH = Math.ceil(r.height / scale)
    view.width = Math.round(r.width * dpr)
    view.height = Math.round(r.height * dpr)
    for (const c of [fogC, bgC, trainC, revC]) {
      c.width = artW
      c.height = artH
    }
    const groundH = Math.round(artH * 0.16)
    groundTop = artH - groundH
    trainY = groundTop - BODY - 1
    fogImg = fctx.createImageData(artW, artH)
    fogPx = new Uint32Array(fogImg.data.buffer)
    buildStatic()
    initStreaks()
    resetMask()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(host)
  resize()

  /* main loop */
  let prev = performance.now()
  let fogTick = 0
  let raf = 0
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    if (!artW) return
    const dt = Math.min(0.05, (now - prev) / 1000)
    prev = now
    const t = now / 1000
    flowMult = FLOW * (1 + 0.06 * Math.sin(t * 0.45))
    if ((fogTick++ & 1) === 0) renderFog(t) // fog at half rate — it drifts slowly
    drawTrain(t, dt)
    drawMask()
    rctx.clearRect(0, 0, artW, artH)
    rctx.drawImage(trainC, 0, 0)
    rctx.globalCompositeOperation = 'destination-in'
    rctx.imageSmoothingEnabled = false
    rctx.drawImage(maskC, 0, 0, gw, gh, 0, 0, artW, artH)
    rctx.globalCompositeOperation = 'source-over'
    vctx.imageSmoothingEnabled = false
    vctx.drawImage(fogC, 0, 0, artW, artH, 0, 0, view.width, view.height)
    vctx.drawImage(revC, 0, 0, artW, artH, 0, 0, view.width, view.height)
  }
  raf = requestAnimationFrame(frame)

  onBeforeUnmount(() => {
    cancelAnimationFrame(raf)
    window.clearInterval(leakTimer)
    ro.disconnect()
    host.removeEventListener('pointermove', onMove)
    host.removeEventListener('pointerdown', onDown)
    host.removeEventListener('pointerleave', onLeave)
  })
})
</script>

<template>
  <!-- opaque within the hero's bounds: it paints over the hero's CSS fog placeholder; paper resumes below -->
  <canvas ref="canvas" class="ffield" aria-hidden="true" />
</template>

<style scoped>
.ffield {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none; /* the HOST section owns the pointer — copy stays hoverable/selectable */
}
</style>
