<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

// The seigaiha (blue ocean waves) band — the closing motif's texture + a cursor light-pool.
// Since 2026-07-14 this is the site's ONLY texture: the graph-paper grid and the asanoha band
// were both retired, and seigaiha was kept.
// Texture: canonical seigaiha (horizontal period 2R, rows offset R, vertical step R/2 — the
// front row partially covers the row behind, leaving only arch crests). Paper-filled discs do
// the occlusion (painter's algorithm).
// Glow: an accent-coloured copy of the SAME tile, masked by a soft radial spotlight that eases
// toward the pointer. The overlay crossfades pixel-for-pixel with the grey pattern beneath
// (paper fills dim it as accent lines light up), so occlusion stays correct and the effect
// reads as moonlight pooling on water — continuous, never per-crest steppy.
// Tuned alongside the asanoha study artifact (2026-07); base tile regenerated via its scratchpad.

const R = 80
const RINGS = [64, 48, 32] // inner rings; the rim is the disc's own stroke at R
const ROWS = [
  // back → front; tile = 160 × 80. Edge discs repeat at the same global position in
  // neighbouring tiles, so seams heal.
  { y: 0, xs: [0, 160] },
  { y: 40, xs: [-80, 80, 240] },
  { y: 80, xs: [0, 160] },
  { y: 120, xs: [-80, 80, 240] },
]
// pre-blended over paper: rim = accent-deep @40% (lit crest), rings = accent-deep @28%
const LIT_RIM = '#a5bcbe'
const LIT_RING = '#b9c8c6'
const PAPER = '#e9e5d8'
const REACH = 190 // spotlight radius, px

const ROLL_SPEED = 6 // px/s — the sea drifts one 160px period every ~27s

const root = ref<HTMLElement>()
const spot = ref<SVGCircleElement>()
const lit = ref<SVGRectElement>()
const pat = ref<SVGPatternElement>()

onMounted(() => {
  const host = root.value
  const c = spot.value
  const r = lit.value
  const tile = pat.value
  if (!host || !c || !r || !tile) return
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const st = { tx: 0, ty: 0, cx: 0, cy: 0, fade: 0, fadeT: 0, cleaned: true }

  let raf = 0
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick)
    // the marquee roll: base texture (::before, GPU transform) and the lit pattern share
    // ONE clock, so the glow's accent copy stays pixel-aligned with the moving sea
    if (!reduced.matches) {
      const p = ((now / 1000) * ROLL_SPEED) % 160
      host.style.setProperty('--sg-roll', `${(-p).toFixed(2)}px`)
      if (st.fade > 0.006 || st.fadeT === 1) tile.setAttribute('patternTransform', `translate(${(-p).toFixed(2)} 0)`)
    }
    if (st.fade < 0.006 && st.fadeT === 0) {
      if (!st.cleaned) {
        st.fade = 0
        r.setAttribute('opacity', '0')
        st.cleaned = true
      }
      return
    }
    st.cleaned = false
    const chase = reduced.matches ? 1 : 0.16 // reduced motion: light lands instantly
    st.cx += (st.tx - st.cx) * chase
    st.cy += (st.ty - st.cy) * chase
    st.fade += (st.fadeT - st.fade) * (reduced.matches ? 1 : 0.1)
    c.setAttribute('cx', st.cx.toFixed(1))
    c.setAttribute('cy', st.cy.toFixed(1))
    r.setAttribute('opacity', st.fade.toFixed(3))
  }
  raf = requestAnimationFrame(tick)

  const track = (e: PointerEvent) => {
    const b = host.getBoundingClientRect()
    st.tx = e.clientX - b.left
    st.ty = e.clientY - b.top
    st.fadeT = 1
  }
  const leave = () => {
    st.fadeT = 0
  }
  host.addEventListener('pointermove', track)
  host.addEventListener('pointerdown', track) // touch: a tap sets the light down there
  host.addEventListener('pointerleave', leave)

  onBeforeUnmount(() => {
    cancelAnimationFrame(raf)
    host.removeEventListener('pointermove', track)
    host.removeEventListener('pointerdown', track)
    host.removeEventListener('pointerleave', leave)
  })
})
</script>

<template>
  <div ref="root" class="sfield">
    <!-- crest fringe: the front row's wave caps lap OVER the section above (the page's paper shows
         through the notches between caps). Rides the same --sg-roll clock as the sea below. -->
    <div class="sfield-crest" aria-hidden="true"></div>
    <!-- the rolling sea lives in its own clipper now — .sfield itself must not clip,
         or the crest fringe (above the band's top edge) would vanish -->
    <div class="sfield-clip" aria-hidden="true"></div>
    <svg class="sfield-glow" aria-hidden="true">
      <defs>
        <!-- the lit sea: same tile geometry, accent colours -->
        <pattern id="sg-lit" ref="pat" width="160" height="80" patternUnits="userSpaceOnUse">
          <g stroke-width="1.5">
            <template v-for="row in ROWS" :key="row.y">
              <template v-for="x in row.xs" :key="`${row.y}:${x}`">
                <circle :cx="x" :cy="row.y" :r="R" :fill="PAPER" :stroke="LIT_RIM" />
                <circle v-for="ring in RINGS" :key="ring" :cx="x" :cy="row.y" :r="ring" fill="none" :stroke="LIT_RING" />
              </template>
            </template>
          </g>
        </pattern>
        <!-- spotlight falloff ≈ (1-d/R)^1.8, sampled into gradient stops -->
        <radialGradient id="sg-spot">
          <stop offset="0" stop-color="#fff" stop-opacity="1" />
          <stop offset="0.4" stop-color="#fff" stop-opacity="0.4" />
          <stop offset="0.7" stop-color="#fff" stop-opacity="0.115" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
        <mask id="sg-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
          <circle ref="spot" cx="0" cy="0" :r="REACH" fill="url(#sg-spot)" />
        </mask>
      </defs>
      <rect ref="lit" width="100%" height="100%" fill="url(#sg-lit)" mask="url(#sg-mask)" opacity="0" />
    </svg>
    <slot />
  </div>
</template>

<style scoped>
.sfield {
  position: relative;
  z-index: 0; /* own stacking context so the glow layers' negative z-index stays inside the band */
  /* NO overflow:hidden here — the crest fringe pokes above the band's top edge.
     The rolling sea gets its own clipper (.sfield-clip) instead. */
  background-color: var(--paper); /* the band's own opaque paper base — the discs are drawn onto it */
}
/* the sea's clip window — hides the one-period right overhang of the rolling layer */
.sfield-clip {
  position: absolute;
  inset: 0;
  overflow: hidden;
  z-index: -2;
  pointer-events: none;
}
/* the base sea — same geometry as the lit pattern, at the site's quiet washes: rim = accent-deep
   @8% (cool crest), rings = ink @4.5%. Lives on a ::before one period wider than the band and
   rolls leftward via --sg-roll (set per-frame from the component's clock; GPU transform, and it
   stays put under prefers-reduced-motion since the var is never written). */
.sfield-clip::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: -160px;
  transform: translateX(var(--sg-roll, 0px));
  will-change: transform;
  background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20160%2080'%3E%3Cg%20stroke-width='1.5'%3E%3Ccircle%20cx='0'%20cy='0'%20r='80'%20fill='%23e9e5d8'%20stroke='%23dbddd3'/%3E%3Ccircle%20cx='0'%20cy='0'%20r='64'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='0'%20cy='0'%20r='48'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='0'%20cy='0'%20r='32'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='160'%20cy='0'%20r='80'%20fill='%23e9e5d8'%20stroke='%23dbddd3'/%3E%3Ccircle%20cx='160'%20cy='0'%20r='64'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='160'%20cy='0'%20r='48'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='160'%20cy='0'%20r='32'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='-80'%20cy='40'%20r='80'%20fill='%23e9e5d8'%20stroke='%23dbddd3'/%3E%3Ccircle%20cx='-80'%20cy='40'%20r='64'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='-80'%20cy='40'%20r='48'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='-80'%20cy='40'%20r='32'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='80'%20cy='40'%20r='80'%20fill='%23e9e5d8'%20stroke='%23dbddd3'/%3E%3Ccircle%20cx='80'%20cy='40'%20r='64'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='80'%20cy='40'%20r='48'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='80'%20cy='40'%20r='32'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='240'%20cy='40'%20r='80'%20fill='%23e9e5d8'%20stroke='%23dbddd3'/%3E%3Ccircle%20cx='240'%20cy='40'%20r='64'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='240'%20cy='40'%20r='48'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='240'%20cy='40'%20r='32'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='0'%20cy='80'%20r='80'%20fill='%23e9e5d8'%20stroke='%23dbddd3'/%3E%3Ccircle%20cx='0'%20cy='80'%20r='64'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='0'%20cy='80'%20r='48'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='0'%20cy='80'%20r='32'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='160'%20cy='80'%20r='80'%20fill='%23e9e5d8'%20stroke='%23dbddd3'/%3E%3Ccircle%20cx='160'%20cy='80'%20r='64'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='160'%20cy='80'%20r='48'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='160'%20cy='80'%20r='32'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='-80'%20cy='120'%20r='80'%20fill='%23e9e5d8'%20stroke='%23dbddd3'/%3E%3Ccircle%20cx='-80'%20cy='120'%20r='64'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='-80'%20cy='120'%20r='48'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='-80'%20cy='120'%20r='32'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='80'%20cy='120'%20r='80'%20fill='%23e9e5d8'%20stroke='%23dbddd3'/%3E%3Ccircle%20cx='80'%20cy='120'%20r='64'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='80'%20cy='120'%20r='48'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='80'%20cy='120'%20r='32'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='240'%20cy='120'%20r='80'%20fill='%23e9e5d8'%20stroke='%23dbddd3'/%3E%3Ccircle%20cx='240'%20cy='120'%20r='64'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='240'%20cy='120'%20r='48'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='240'%20cy='120'%20r='32'%20fill='none'%20stroke='%23dfdccf'/%3E%3C/g%3E%3C/svg%3E");
  background-size: 160px 80px;
}
/* the crest fringe — a 40px strip ABOVE the band drawing only the front row's caps.
   Geometry: the band's front-row discs (period 160, centres at x=80±160k, 40px below the seam,
   r=80) rise exactly 40px above it — so the tile is 160×40 with the same circles at cy=80.
   Same origin (left:0) + same --sg-roll clock as the sea → the caps ARE those discs, continued
   across the seam (rim + inner rings line up). Between caps the strip is transparent, so the
   page's paper shows through the notches: the sea laps over the shore. */
.sfield-crest {
  position: absolute;
  top: -40px;
  left: 0;
  width: 100%;
  height: 40px;
  overflow: hidden; /* clips the rolling overhang horizontally; the caps fit the strip exactly */
  pointer-events: none;
}
.sfield-crest::before {
  content: '';
  position: absolute;
  inset: 0 -160px 0 0;
  transform: translateX(var(--sg-roll, 0px));
  will-change: transform;
  background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20160%2040'%3E%3Cg%20stroke-width='1.5'%3E%3Ccircle%20cx='-80'%20cy='80'%20r='80'%20fill='%23e9e5d8'%20stroke='%23dbddd3'/%3E%3Ccircle%20cx='-80'%20cy='80'%20r='64'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='-80'%20cy='80'%20r='48'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='80'%20cy='80'%20r='80'%20fill='%23e9e5d8'%20stroke='%23dbddd3'/%3E%3Ccircle%20cx='80'%20cy='80'%20r='64'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='80'%20cy='80'%20r='48'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='240'%20cy='80'%20r='80'%20fill='%23e9e5d8'%20stroke='%23dbddd3'/%3E%3Ccircle%20cx='240'%20cy='80'%20r='64'%20fill='none'%20stroke='%23dfdccf'/%3E%3Ccircle%20cx='240'%20cy='80'%20r='48'%20fill='none'%20stroke='%23dfdccf'/%3E%3C/g%3E%3C/svg%3E");
  background-size: 160px 40px;
}
.sfield-glow {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: -1;
  pointer-events: none;
}
</style>
