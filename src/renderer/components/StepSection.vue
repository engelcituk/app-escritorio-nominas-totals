<script setup lang="ts">
defineProps<{ number: number; title: string; description?: string; disabled?: boolean }>();
</script>
<template>
  <section class="step-section" :class="{ 'is-disabled': disabled }" :aria-disabled="disabled">
    <header class="step-header">
      <span class="step-number" aria-hidden="true">{{ number }}</span>
      <div><h2>{{ title }}</h2><p v-if="description">{{ description }}</p></div>
      <div v-if="$slots.status" class="step-status"><slot name="status" /></div>
    </header>
    <div class="step-body"><slot /></div>
  </section>
</template>
