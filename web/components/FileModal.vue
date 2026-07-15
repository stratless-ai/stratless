<script setup lang="ts">
// A document-window modal: the person-layer file-icons open into this to show the full, real .md
// (rendered by lib/samples.ts). Dark editor window — matches the reference markdown preview and the
// hero terminal, so the technical artifacts read as one family. Esc / click-outside / ✕ all close it.
const props = defineProps<{ open: boolean; name?: string | null; html?: string }>()
const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (typeof document === 'undefined') return
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
  },
)

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fm">
      <div v-if="open" class="fm-overlay" @click.self="emit('close')">
        <div class="fm-window" role="dialog" aria-modal="true" :aria-label="name ?? 'file'">
          <div class="fm-bar">
            <div class="fm-dots">
              <button class="fm-dot d-r" type="button" aria-label="Close" @click="emit('close')" />
              <span class="fm-dot d-y" />
              <span class="fm-dot d-g" />
            </div>
            <div class="fm-title">{{ name }}</div>
            <button class="fm-close" type="button" aria-label="Close" @click="emit('close')">✕</button>
          </div>
          <div class="fm-body md" v-html="html" />
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
.fm-body {
  overflow-y: auto;
  padding: 1.7rem 1.95rem 2rem;
  font-family: var(--font-read);
  font-size: 0.82rem;
  color: #cfcabb;
  line-height: 1.65;
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
