<script setup lang="ts">defineProps<{ title: string; description: string; icon?: string }>();</script>
<template>
  <div class="empty-state">
    <i class="bi" :class="icon ?? 'bi-inbox'" aria-hidden="true" />
    <h2>{{ title }}</h2><p>{{ description }}</p><slot />
  </div>
</template>
