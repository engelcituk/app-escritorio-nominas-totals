<script setup lang="ts">
import type { ProcessingProgress } from '@shared/types/payroll';
defineProps<{ progress: ProcessingProgress }>();
const labels: Record<string, string> = { INSPECTING: 'Inspeccionando', VALIDATING: 'Validando', READING: 'Leyendo archivo', CLASSIFYING: 'Clasificando',
  SAVING: 'Guardando registros', CALCULATING: 'Calculando totales', BUILDING_DETAIL_REPORT: 'Generando detalle',
  BUILDING_TOTALS_REPORT: 'Generando totales', COMPLETED: 'Completado' };
</script>
<template>
  <div class="processing-panel" aria-live="polite">
    <div class="d-flex justify-content-between align-items-end mb-2"><div><span class="eyebrow">Etapa actual</span><strong>{{ labels[progress.stage] ?? progress.stage }}</strong></div><strong>{{ progress.percentage.toFixed(1) }}%</strong></div>
    <div class="progress" role="progressbar" :aria-valuenow="progress.percentage" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" :style="{ width: `${progress.percentage}%` }" /></div>
    <dl class="progress-metrics"><div><dt>Líneas</dt><dd>{{ progress.linesProcessed.toLocaleString('es-MX') }}</dd></div><div><dt>Válidos</dt><dd>{{ progress.validRecords.toLocaleString('es-MX') }}</dd></div><div><dt>Excluidos</dt><dd>{{ progress.excludedRecords.toLocaleString('es-MX') }}</dd></div><div><dt>Errores</dt><dd>{{ progress.invalidRecords.toLocaleString('es-MX') }}</dd></div></dl>
  </div>
</template>
