<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ status: string }>();
const label = computed(() => ({ COMPLETED: 'Completado', PROCESSING: 'Procesando', FAILED: 'Fallido', FAILED_RECONCILIATION: 'Requiere revisión',
  CANCELLED: 'Cancelado', INTERRUPTED: 'Interrumpido', SUPERSEDED: 'Reemplazado', EXCLUDED: 'Excluido', INVALID: 'Inválido',
  VALID: 'Válido', UNCLASSIFIED: 'Sin clasificar' }[props.status] ?? props.status));
const tone = computed(() => ({ COMPLETED: 'success', VALID: 'success', PROCESSING: 'info', FAILED: 'danger', FAILED_RECONCILIATION: 'danger',
  CANCELLED: 'neutral', INTERRUPTED: 'warning', SUPERSEDED: 'neutral', EXCLUDED: 'warning', INVALID: 'danger' }[props.status] ?? 'neutral'));
</script>
<template><span class="status-badge" :class="`status-${tone}`"><span class="status-dot" aria-hidden="true" />{{ label }}</span></template>
