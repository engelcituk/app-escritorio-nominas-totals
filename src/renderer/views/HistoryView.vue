<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { BatchSummary } from '@shared/types/payroll';
import { PayrollType } from '@shared/enums/payroll';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import MoneyValue from '../components/MoneyValue.vue';
import EmptyState from '../components/EmptyState.vue';
import { errorMessage } from '../utils/errorMessage';

const items = ref<BatchSummary[]>([]);
const total = ref(0);
const loading = ref(true);
const page = ref(1);
const year = ref<number | undefined>();
const payrollType = ref<PayrollType | undefined>();
const search = ref('');
const error = ref('');
const openingBatchId = ref<number | null>(null);

async function load(): Promise<void> {
  error.value = '';
  loading.value = true;
  try {
    const filters = { page: page.value, pageSize: 25, ...(year.value ? { year: year.value } : {}),
      ...(payrollType.value ? { payrollType: payrollType.value } : {}), ...(search.value ? { search: search.value } : {}) };
    const response = await window.sefiplanApi.getBatchHistory(filters);
    items.value = response.items; total.value = response.total;
  } catch (cause) {
    error.value = errorMessage(cause, 'No se pudo consultar el histórico.');
  } finally { loading.value = false; }
}
async function openFolder(batchId: number): Promise<void> {
  error.value = '';
  openingBatchId.value = batchId;
  try {
    const opened = await window.sefiplanApi.openReportFolder(batchId);
    if (!opened) throw new Error('No se encontró la carpeta o el reporte generado para este lote.');
  } catch (cause) {
    error.value = errorMessage(cause, 'No se pudo abrir la carpeta de reportes.');
  } finally {
    openingBatchId.value = null;
  }
}
onMounted(load);
</script>
<template>
  <PageHeader title="Histórico de quincenas" description="Consulta lotes procesados, versiones y reportes generados." />
  <div v-if="error" class="alert alert-danger" role="alert"><strong>No se pudo completar la operación.</strong><div>{{ error }}</div></div>
  <form class="filter-bar" @submit.prevent="page = 1; load()">
    <div><label for="history-year">Año</label><input id="history-year" v-model.number="year" class="form-control" type="number" placeholder="Todos" /></div>
    <div><label for="history-type">Tipo de nómina</label><select id="history-type" v-model="payrollType" class="form-select"><option :value="undefined">Todos</option><option v-for="type in Object.values(PayrollType)" :key="type" :value="type">{{ type }}</option></select></div>
    <div class="filter-search"><label for="history-search">Archivo</label><input id="history-search" v-model="search" class="form-control" type="search" placeholder="Buscar por nombre" /></div>
    <button class="btn btn-primary align-self-end" type="submit" :disabled="loading"><span v-if="loading" class="spinner-border spinner-border-sm" aria-hidden="true" /><i v-else class="bi bi-search" aria-hidden="true" /> {{ loading ? 'Consultando…' : 'Buscar' }}</button>
  </form>
  <div v-if="loading" class="inline-loading"><span class="spinner-border spinner-border-sm" /> Consultando histórico…</div>
  <EmptyState v-else-if="!items.length" title="Todavía no hay lotes" description="Cuando completes una importación aparecerá aquí con sus reportes y evidencia."><RouterLink class="btn btn-primary" to="/importar">Nueva importación</RouterLink></EmptyState>
  <div v-else class="table-responsive table-frame">
    <table class="table table-hover align-middle mb-0"><caption class="visually-hidden">Lotes de nómina procesados</caption><thead><tr><th>Periodo</th><th>Tipo</th><th>Versión</th><th>Archivo</th><th class="text-end">Registros</th><th class="text-end">Excluidos</th><th class="text-end">Errores</th><th class="text-end">Total</th><th>Fecha</th><th>Estado</th><th><span class="visually-hidden">Acciones</span></th></tr></thead>
      <tbody><tr v-for="batch in items" :key="batch.id"><td>{{ batch.year }} / Q{{ String(batch.fortnight).padStart(2, '0') }}</td><td>{{ batch.payrollType }}</td><td>v{{ batch.version }}</td><td class="filename-cell">{{ batch.originalFilename }}</td><td class="text-end">{{ batch.totalLines.toLocaleString('es-MX') }}</td><td class="text-end">{{ batch.excludedLines.toLocaleString('es-MX') }}</td><td class="text-end">{{ batch.invalidLines.toLocaleString('es-MX') }}</td><td class="text-end"><MoneyValue :cents="batch.totalAmountCents" /></td><td>{{ batch.completedAt ? new Date(batch.completedAt).toLocaleDateString('es-MX') : '—' }}</td><td><StatusBadge :status="batch.status" /></td><td><button class="btn btn-icon" type="button" :disabled="openingBatchId !== null" aria-label="Abrir carpeta de reportes" @click="openFolder(batch.id)"><span v-if="openingBatchId === batch.id" class="spinner-border spinner-border-sm" aria-hidden="true" /><i v-else class="bi bi-folder2-open" aria-hidden="true" /></button></td></tr></tbody>
    </table>
  </div>
  <div v-if="total > 25" class="pagination-bar"><span>{{ total.toLocaleString('es-MX') }} lotes</span><div><button class="btn btn-outline-secondary btn-sm" type="button" :disabled="loading || page === 1" @click="page--; load()">Anterior</button><span>Página {{ page }}</span><button class="btn btn-outline-secondary btn-sm" type="button" :disabled="loading || page * 25 >= total" @click="page++; load()">Siguiente</button></div></div>
</template>
