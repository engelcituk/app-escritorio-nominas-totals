<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ status: string }>();
const labels: Record<string, string> = { COMPLETED: 'Completado', PROCESSING: 'Procesando', FAILED: 'Fallido',
  FAILED_RECONCILIATION: 'Requiere revisión', CANCELLED: 'Cancelado', INTERRUPTED: 'Interrumpido', SUPERSEDED: 'Reemplazado',
  EXCLUDED: 'Excluido', INVALID: 'Inválido', VALID: 'Válido', UNCLASSIFIED: 'Sin clasificar', PARTIAL: 'Incompleto',
  DRAFT: 'Borrador', ACTIVE: 'Activa', ARCHIVED: 'Archivada' };
const tones: Record<string, string> = { COMPLETED: 'success', VALID: 'success', ACTIVE: 'success', PROCESSING: 'info', FAILED: 'danger',
  FAILED_RECONCILIATION: 'danger', CANCELLED: 'neutral', INTERRUPTED: 'warning', SUPERSEDED: 'neutral', EXCLUDED: 'warning',
  INVALID: 'danger', PARTIAL: 'warning', DRAFT: 'warning', ARCHIVED: 'neutral' };
const label = computed(() => labels[props.status] ?? props.status);
const tone = computed(() => tones[props.status] ?? 'neutral');
</script>
<template><span class="status-badge" :class="`status-${tone}`"><span class="status-dot" aria-hidden="true" />{{ label }}</span></template>
