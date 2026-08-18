<script setup lang="ts">
import { computed, ref } from 'vue';
import { BatchStatus } from '@shared/enums/payroll';
import type { BatchSummary } from '@shared/types/payroll';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import MoneyValue from '../components/MoneyValue.vue';
import { errorMessage } from '../utils/errorMessage';

const year = ref(new Date().getFullYear());
const fortnight = ref(1);
const loading = ref(false);
const consulted = ref(false);
const error = ref('');
const batches = ref<BatchSummary[]>([]);
const rows = computed(() => batches.value);
const grandTotal = computed(() => rows.value.reduce((sum, batch) => sum + batch.totalAmountCents, 0));

async function consult(): Promise<void> {
  error.value = '';
  loading.value = true;
  try {
    const collected: BatchSummary[] = []; let page = 1; let total = 0;
    do { const response = await window.sefiplanApi.getBatchHistory({ page, pageSize: 100, year: year.value, fortnight: fortnight.value, status: BatchStatus.COMPLETED }); collected.push(...response.items); total = response.total; page += 1; } while (collected.length < total);
    batches.value = collected;
    consulted.value = true;
  } catch (cause) {
    error.value = errorMessage(cause, 'No se pudo consultar el consolidado quincenal.');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <PageHeader title="Consolidado" description="Integra los lotes activos procesados para una misma quincena." />
  <div v-if="error" class="alert alert-danger" role="alert"><strong>No se pudo completar la consulta.</strong><div>{{ error }}</div></div>
  <form class="period-toolbar" @submit.prevent="consult"><div><label class="form-label" for="consolidated-year">Año</label><input id="consolidated-year" v-model.number="year" class="form-control" type="number" min="2000" max="2200" /></div><div><label class="form-label" for="consolidated-fortnight">Quincena</label><select id="consolidated-fortnight" v-model.number="fortnight" class="form-select"><option v-for="n in 24" :key="n" :value="n">Quincena {{ String(n).padStart(2, '0') }}</option></select></div><button class="btn btn-primary align-self-end" type="submit" :disabled="loading"><span v-if="loading" class="spinner-border spinner-border-sm" aria-hidden="true" /><i v-else class="bi bi-search" aria-hidden="true" /> {{ loading ? 'Consultando…' : 'Consultar' }}</button></form>
  <EmptyState v-if="!consulted" title="Selecciona un periodo" description="Consulta una quincena para integrar los lotes completados por tipo de nómina." icon="bi-table" />
  <EmptyState v-else-if="!rows.length" title="No hay lotes completados" description="No se encontraron importaciones terminadas para el periodo seleccionado." icon="bi-inbox" />
  <div v-else class="table-responsive table-frame"><table class="table align-middle mb-0"><caption class="visually-hidden">Consolidado general por tipo de nómina y archivo</caption><thead><tr><th>Tipo de nómina</th><th>Versión</th><th>Archivo</th><th class="text-end">Registros</th><th class="text-end">Total general</th></tr></thead><tbody><tr v-for="batch in rows" :key="batch.id"><td>{{ batch.payrollType }}</td><td>v{{ batch.version }}</td><td class="filename-cell">{{ batch.originalFilename }}</td><td class="text-end">{{ batch.totalLines.toLocaleString('es-MX') }}</td><td class="text-end"><MoneyValue :cents="batch.totalAmountCents" /></td></tr></tbody><tfoot><tr><th colspan="4">Total consolidado</th><th class="text-end"><MoneyValue :cents="grandTotal" /></th></tr></tfoot></table></div>
</template>
