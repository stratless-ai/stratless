<script setup lang="ts">
// A document-window modal: the person-layer file-icons open into this to show the full, real .md
// (rendered by lib/samples.ts). Dark editor window — matches the reference markdown preview and the
// hero terminal, so the technical artifacts read as one family. Esc / click-outside / ✕ all close it.
const props = defineProps<{ open: boolean; name?: string | null; html?: string }>()
const emit = defineEmits<{ close: [] }>()

// FOCUS MANAGEMENT. Until 2026-07-20 this dialog had none, and the consequence was not subtle: the
// body is a scroll region containing no focusable elements, and focus never moved off the .file-icon
// button that opened it. A keyboard-only visitor could open the modal, see a scrollable document, and
// neither scroll nor read it — arrow keys acted on the scroll-locked body behind. Tab walked invisibly
// through that background page, and because focus never entered, `aria-modal` never constrained a
// screen reader either, so the whole page stayed readable underneath. The feature was open only to
// people using a mouse.
//
// Four things make it work, and all four are required — a dialog with three of them is still broken:
//   1. move focus in on open        (else nothing below matters)
//   2. keep Tab inside while open   (else focus escapes to a page the user cannot see)
//   3. put focus back on close      (else the reader is dumped at the top of the document)
//   4. make the background inert    (else assistive tech reads straight through the overlay)
const win = ref<HTMLElement | null>(null)
let lastFocused: HTMLElement | null = null

// Only one FileModal is ever mounted (index.vue renders a single instance), so a constant id is safe
// and avoids depending on useId's auto-import.
const titleId = 'fm-title'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(): HTMLElement[] {
  if (!win.value) return []
  return [...win.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    // `tabIndex >= 0` is the load-bearing clause. Without it the trap re-introduces exactly the
    // elements the browser is right to skip: the red close-light is tabindex="-1" + aria-hidden, so
    // native Tab passes over it, but a naive `button` query still matches it and the wrap-around
    // would focus it anyway — putting a silent, invisible stop back into the cycle.
    (el) => el.offsetParent !== null && el.tabIndex >= 0 && !el.closest('[aria-hidden="true"]'),
  )
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
    return
  }
  if (e.key !== 'Tab' || !win.value) return
  const items = focusables()
  if (!items.length) {
    e.preventDefault()
    win.value.focus()
    return
  }
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement as HTMLElement | null
  // Focus somehow outside the dialog (e.g. the browser chrome round-trip) — pull it back.
  if (!active || !win.value.contains(active)) {
    e.preventDefault()
    first.focus()
  } else if (e.shiftKey && (active === first || active === win.value)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

// The dialog is teleported to <body>, so it sits OUTSIDE #__nuxt — marking that root inert hides the
// page without touching the dialog. `inert` also blocks pointer and focus, which aria-hidden alone
// does not; both are set because older Safari honours only the latter.
function setBackgroundInert(on: boolean) {
  const root = document.getElementById('__nuxt')
  if (!root) return
  if (on) {
    root.setAttribute('inert', '')
    root.setAttribute('aria-hidden', 'true')
  } else {
    root.removeAttribute('inert')
    root.removeAttribute('aria-hidden')
  }
}

watch(
  () => props.open,
  async (open) => {
    if (typeof document === 'undefined') return
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      lastFocused = document.activeElement as HTMLElement | null
      window.addEventListener('keydown', onKey)
      setBackgroundInert(true)
      await nextTick()
      win.value?.focus()
    } else {
      window.removeEventListener('keydown', onKey)
      setBackgroundInert(false)
      // Back to the file-icon that opened it, so the reader resumes where they left off rather than
      // at the top of the page.
      lastFocused?.focus?.()
      lastFocused = null
    }
  },
)

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onKey)
  setBackgroundInert(false)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fm">
      <div v-if="open" class="fm-overlay" @click.self="emit('close')">
        <div
          ref="win"
          class="fm-window"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          :aria-labelledby="name ? titleId : undefined"
          :aria-label="name ? undefined : 'File preview'"
        >
          <div class="fm-bar">
            <div class="fm-dots">
              <!-- The red light still closes on click, but it is hidden from assistive tech and out of
                   the tab order: it and the ✕ were both announced as "Close, button. Close, button."
                   One control, one name. It is also a 12px target, so it is a mouse affordance only. -->
              <button
                class="fm-dot d-r"
                type="button"
                tabindex="-1"
                aria-hidden="true"
                @click="emit('close')"
              />
              <span class="fm-dot d-y" />
              <span class="fm-dot d-g" />
            </div>
            <div :id="titleId" class="fm-title">{{ name }}</div>
            <button class="fm-close" type="button" aria-label="Close" @click="emit('close')">✕</button>
          </div>
          <!-- tabindex="0" is load-bearing, not decoration: this region scrolls but contains nothing
               focusable, so without it a keyboard user can reach the dialog and still never scroll the
               document. role="region" + a name is what makes it announce as something enterable. -->
          <div
            class="fm-body md"
            tabindex="0"
            role="region"
            :aria-label="name ? `${name} contents` : 'File contents'"
            v-html="html"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fm-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.2rem;
  background: rgba(20, 18, 12, 0.55);
  backdrop-filter: blur(3px);
}
.fm-window {
  width: min(58rem, 100%);
  max-height: min(90vh, 52rem);
  display: flex;
  flex-direction: column;
  border: 1px solid #000;
  border-radius: 11px;
  background: #1b1a16;
  box-shadow: 0 40px 90px -30px rgba(20, 18, 12, 0.65), 0 8px 20px rgba(20, 18, 12, 0.3);
  overflow: hidden;
}
.fm-bar {
  position: relative;
  display: flex;
  align-items: center;
  flex: none;
  padding: 0.62rem 0.85rem;
  background: linear-gradient(#3a3831, #322f29);
  border-bottom: 1px solid #000;
}
.fm-dots {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 0.5rem;
}
.fm-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 0;
  padding: 0;
}
.fm-dot.d-r { background: #ff5f56; cursor: pointer; }
.fm-dot.d-y { background: #febc2e; }
.fm-dot.d-g { background: #28c840; }
.fm-title {
  position: absolute;
  left: 0;
  right: 0;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 700;
  color: #d7d2c4;
}
.fm-close {
  position: relative;
  z-index: 1;
  margin-left: auto;
  border: 0;
  background: none;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  color: #b9b3a3;
  padding: 0.2rem 0.3rem;
}
.fm-close:hover {
  color: #fff;
}
/* The window takes focus programmatically on open, purely so a screen reader announces the dialog.
   A ring around the whole window would read as a rendering glitch, so suppress it there — but the
   body IS tabbed to deliberately, so it keeps a clearly visible one. The global ring (--accent-deep,
   tuned for the paper background) is too dim against #1b1a16; this is the terminal's lighter blue,
   inset so it follows the panel rather than bleeding past the rounded corners. */
.fm-window:focus,
.fm-window:focus-visible {
  outline: none;
}
.fm-body {
  overflow-y: auto;
  padding: 1.7rem 1.95rem 2rem;
  font-family: var(--font-read);
  font-size: 0.82rem;
  color: #cfcabb;
  line-height: 1.65;
}
.fm-body:focus-visible {
  outline: 2px solid #6cb6d9;
  outline-offset: -3px;
}

/* rendered markdown (v-html, so :deep) — editor preview look */
.fm-body :deep(h1) {
  font-family: var(--font-display);
  font-size: 1.28rem;
  color: #f4f1e8;
  margin: 0 0 0.85rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #35322b;
  letter-spacing: -0.01em;
}
.fm-body :deep(h2) {
  font-family: var(--font-display);
  font-size: 1rem;
  color: #f4f1e8;
  margin: 1.7rem 0 0.55rem;
  padding-bottom: 0.32rem;
  border-bottom: 1px solid #2c2a24;
}
.fm-body :deep(p) {
  margin: 0.85rem 0;
}
.fm-body :deep(ul) {
  margin: 0.7rem 0;
  padding-left: 1.3rem;
}
.fm-body :deep(li) {
  margin: 0.4rem 0;
}
.fm-body :deep(li)::marker {
  color: #8b8677;
}
.fm-body :deep(strong) {
  color: #f4f1e8;
}
.fm-body :deep(em) {
  color: #b3ae9f;
  font-style: italic;
}
.fm-body :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.84em;
  background: rgba(255, 255, 255, 0.09);
  color: #e6e2d6;
  padding: 0.12em 0.4em;
  border-radius: 5px;
}
.fm-body :deep(pre) {
  background: #14130f;
  border: 1px solid #2c2a24;
  border-radius: 8px;
  padding: 0.9rem 1.1rem;
  overflow-x: auto;
  margin: 1rem 0;
}
.fm-body :deep(pre code) {
  background: none;
  padding: 0;
  color: #cfcabb;
  font-size: 0.82rem;
}
.fm-body :deep(a) {
  color: #5fb3c9;
}

/* enter/leave */
.fm-enter-active,
.fm-leave-active {
  transition: opacity 0.18s ease;
}
.fm-enter-from,
.fm-leave-to {
  opacity: 0;
}
.fm-enter-active .fm-window {
  transition: transform 0.18s ease;
}
.fm-enter-from .fm-window {
  transform: scale(0.97) translateY(6px);
}
</style>
