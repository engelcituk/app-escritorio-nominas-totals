<script setup lang="ts">
import type { PreviewRecord } from '@shared/types/payroll';
import MoneyValue from './MoneyValue.vue';
import StatusBadge from './StatusBadge.vue';
defineProps<{ rows: PreviewRecord[] }>();
</script>
<template>
  <div class="table-responsive table-frame">
    <table class="table table-hover align-middle mb-0">
      <caption class="visually-hidden">Vista previa de líneas interpretadas</caption>
      <thead><tr><th>Línea</th><th>Núm. empleado</th><th>Nombre</th><th>Mov.</th><th>Código</th><th>Concepto</th><th class="text-end">Importe</th><th>Cuenta</th><th>Control</th><th>Final</th><th>Validación</th></tr></thead>
      <tbody><tr v-for="row in rows" :key="row.lineNumber">
        <td>{{ row.lineNumber }}</td><td>{{ row.employeeNumber || '—' }}</td><td>{{ row.employeeName || '—' }}</td><td>{{ row.movementType || '—' }}</td>
        <td>{{ row.conceptCode || '—' }}</td><td class="concept-cell">{{ row.conceptDescriptionOriginal || '—' }}</td>
        <td class="text-end"><MoneyValue v-if="row.amountCents !== null" :cents="row.amountCents" /><span v-else>—</span></td>
        <td>{{ row.accountCode || '—' }}</td><td>{{ row.controlCode || '—' }}</td><td>{{ row.finalIndicator || '—' }}</td>
        <td><StatusBadge :status="row.valid ? 'VALID' : 'INVALID'" /><div v-if="row.errors.length" class="field-error">{{ row.errors.join(' ') }}</div></td>
      </tr></tbody>
    </table>
  </div>
</template>
