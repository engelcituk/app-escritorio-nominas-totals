<script setup lang="ts">
import { computed, ref } from 'vue';
import { BatchStatus } from '@shared/enums/payroll';
import type { BatchSummary } from '@shared/types/payroll';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import MoneyValue from '../components/MoneyValue.vue';
import { errorMessage } from '../utils/errorMessage';

const year = ref(new Date().getFullYear());
const loading = ref(false);
const consulted = ref(false);
const error = ref('');
const batches = ref<BatchSummary[]>([]);
const rows = computed(() => {
  const latest = new Map<string, BatchSummary>();
  for (const batch of batches.value) {
    const key = `${batch.fortnight}:${batch.payrollType}`;
    if (!latest.has(key)) latest.set(key, batch);
  }
  const byFortnight = new Map<number, { total: number; payrollTypes: Set<string>; batches: number }>();
  for (const batch of latest.values()) {
    const row = byFortnight.get(batch.fortnight) ?? { total: 0, payrollTypes: new Set<string>(), batches: 0 };
    row.total += batch.totalAmountCents;
    row.payrollTypes.add(batch.payrollType);
    row.batches += 1;
    byFortnight.set(batch.fortnight, row);
  }
  return [...byFortnight].sort((a, b) => a[0] - b[0]).map(([fortnight, row]) => ({ fortnight, total: row.total, payrollTypes: row.payrollTypes.size, batches: row.batches }));
});
const annualTotal = computed(() => rows.value.reduce((sum, row) => sum + row.total, 0));

async function consult(): Promise<void> {
  error.value = '';
  loading.value = true;
  try {
    const collected: BatchSummary[] = [];
    let page = 1;
    let total = 0;
    do {
      const response = await window.sefiplanApi.getBatchHistory({ page, pageSize: 100, year: year.value, status: BatchStatus.COMPLETED });
      collected.push(...response.items);
      total = response.total;
      page += 1;
    } while (collected.length < total);
    batches.value = collected;
    consulted.value = true;
  } catch (cause) {
    error.value = errorMessage(cause, 'No se pudo consultar la matriz anual.');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <PageHeader title="Matriz anual de ISR" description="Compara las 24 quincenas por tipo de nómina y total anual." />
  <div v-if="error" class="alert alert-danger" role="alert"><strong>No se pudo completar la consulta.</strong><div>{{ error }}</div></div>
  <form class="period-toolbar" @submit.prevent="consult"><div><label class="form-label" for="matrix-year">Año</label><input id="matrix-year" v-model.number="year" class="form-control" type="number" min="2000" max="2200" /></div><div><label class="form-label" for="matrix-concept">Concepto</label><select id="matrix-concept" class="form-select"><option>ISR</option></select></div><button class="btn btn-primary align-self-end" type="submit" :disabled="loading"><span v-if="loading" class="spinner-border spinner-border-sm" aria-hidden="true" /><i v-else class="bi bi-search" aria-hidden="true" /> {{ loading ? 'Consultando…' : 'Consultar' }}</button></form>
  <EmptyState v-if="!consulted" title="Selecciona un año" description="Consulta los lotes completados para obtener los totales por quincena." icon="bi-calendar3" />
  <EmptyState v-else-if="!rows.length" title="No hay datos para mostrar" description="No se encontraron lotes completados para el año seleccionado." icon="bi-inbox" />
  <div v-else class="table-responsive table-frame"><table class="table align-middle mb-0"><caption class="visually-hidden">Totales anuales de ISR por quincena</caption><thead><tr><th>Quincena</th><th class="text-end">Tipos de nómina</th><th class="text-end">Lotes incluidos</th><th class="text-end">Total ISR</th></tr></thead><tbody><tr v-for="row in rows" :key="row.fortnight"><td>Quincena {{ String(row.fortnight).padStart(2, '0') }}</td><td class="text-end">{{ row.payrollTypes }}</td><td class="text-end">{{ row.batches }}</td><td class="text-end"><MoneyValue :cents="row.total" /></td></tr></tbody><tfoot><tr><th colspan="3">Total anual</th><th class="text-end"><MoneyValue :cents="annualTotal" /></th></tr></tfoot></table></div>
</template>
