<script setup lang="ts">
// One shared button — used verbatim for EVERY CTA (nav + hero + elsewhere), so they're guaranteed identical
// (same markup, same global .btn styles). `primary` = the filled accent CTA; default = outlined.
withDefaults(defineProps<{ href?: string; to?: string; primary?: boolean }>(), { primary: false })
</script>

<template>
  <a v-if="href" :href="href" class="btn" :class="{ 'btn-cta': primary }"><slot /></a>
  <NuxtLink v-else :to="to ?? '/'" class="btn" :class="{ 'btn-cta': primary }"><slot /></NuxtLink>
</template>
