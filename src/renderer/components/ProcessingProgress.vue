<script setup lang="ts">
import type { ProcessingProgress } from '@shared/types/payroll';
defineProps<{ progress: ProcessingProgress }>();
const labels: Record<string, string> = { INSPECTING: 'Inspeccionando', VALIDATING: 'Validando', READING: 'Leyendo archivo', CLASSIFYING: 'Clasificando',
  SAVING: 'Guardando agrupaciones', CALCULATING: 'Calculando totales', BUILDING_SOURCE_REPORT: 'Generando TXT completo',
  BUILDING_MONTHLY_REPORT: 'Actualizando reporte mensual', COMPLETED: 'Completado' };
</script>
<template>
  <div class="processing-panel" aria-live="polite">
    <div class="d-flex justify-content-between align-items-end mb-2"><div><span class="eyebrow">Etapa actual</span><strong>{{ labels[progress.stage] ?? progress.stage }}</strong><small v-if="progress.totalFiles" class="d-block">Archivo {{ progress.activeFileIndex }} de {{ progress.totalFiles }} · {{ progress.activeFilename }}</small></div><strong>{{ progress.percentage.toFixed(1) }}%</strong></div>
    <div class="progress" role="progressbar" :aria-valuenow="progress.percentage" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" :style="{ width: `${progress.percentage}%` }" /></div>
    <dl class="progress-metrics"><div><dt>Líneas</dt><dd>{{ progress.linesProcessed.toLocaleString('es-MX') }}</dd></div><div><dt>Válidos</dt><dd>{{ progress.validRecords.toLocaleString('es-MX') }}</dd></div><div><dt>Excluidos</dt><dd>{{ progress.excludedRecords.toLocaleString('es-MX') }}</dd></div><div :class="{ 'has-errors': progress.invalidRecords > 0 }"><dt>Líneas con error</dt><dd>{{ progress.invalidRecords.toLocaleString('es-MX') }}</dd></div></dl>
    <details v-if="progress.invalidRecords" class="processing-errors">
      <summary>¿Qué se considera una línea con error?</summary>
      <p>Puede tener una cantidad de columnas distinta de 22, un importe inválido, código o tipo de movimiento faltante, o una cuenta contable vacía para un concepto seleccionado.</p>
      <p>Estas líneas no se incluyen en las sumatorias. Revisa <strong>Contenido TXT</strong>; si el problema es estructural, consulta también <strong>Líneas no compatibles</strong>.</p>
    </details>
  </div>
</template>
