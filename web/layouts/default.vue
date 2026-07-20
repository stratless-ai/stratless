<script setup lang="ts">
// Pages can take over the footer (the homepage renders it inside its seigaiha band).
const route = useRoute()
</script>

<template>
  <div class="site">
    <!-- header markup, the skip link and the scroll behaviour live in SiteHeader.vue, shared with
         error.vue — see the note there for why the copy had to go -->
    <SiteHeader />

    <main id="main">
      <slot />
    </main>

    <SiteFooter v-if="route.meta.footer !== false" />
  </div>
</template>

<style scoped>
.site {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
main {
  flex: 1;
}
/* footer markup + styles live in SiteFooter.vue (shared with the homepage's sea variant) */
</style>
