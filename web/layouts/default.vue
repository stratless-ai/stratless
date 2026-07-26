<template>
  <div class="site">
    <!-- header markup, the skip link and the scroll behaviour live in SiteHeader.vue, shared with
         error.vue — see the note there for why the copy had to go -->
    <SiteHeader />

    <main id="main" tabindex="-1">
      <slot />
    </main>

    <!-- Footer lives OUTSIDE <main> so it is a real `contentinfo` landmark — a <footer> nested
         inside <main> is not one, and on a page that put it there the landmark silently vanished.
         SiteFooter brings its own seigaiha wave band; every page closes with the same sea. -->
    <SiteFooter />
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
/* footer markup + styles live in SiteFooter.vue (the wave band included) */
</style>
