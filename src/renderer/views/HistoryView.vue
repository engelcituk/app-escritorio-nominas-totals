<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { MonthlyReconciliationSummary } from '@shared/types/payroll';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import MoneyValue from '../components/MoneyValue.vue';
import EmptyState from '../components/EmptyState.vue';
import { errorMessage } from '../utils/errorMessage';

const items = ref<MonthlyReconciliationSummary[]>([]); const total = ref(0); const loading = ref(true); const page = ref(1);
const year = ref<number | undefined>(); const error = ref(''); const openingGroupId = ref<number | null>(null); const PAGE_SIZE = 25;
function periodLabel(group: MonthlyReconciliationSummary): string { return `${group.year}/${String(group.month).padStart(2,'0')} · ${group.fortnights.length ? group.fortnights.map((q) => `Q${String(q).padStart(2, '0')}`).join(', ') : 'Sin archivos'}`; }
function completedDate(value: string | null): string { return value ? new Date(value).toLocaleDateString('es-MX') : '—'; }
async function load(): Promise<void> { error.value = ''; loading.value = true; try { const response = await window.sefiplanApi.getMonthlyHistory({ page: page.value, pageSize: PAGE_SIZE, ...(year.value ? { year: year.value } : {}) }); items.value = response.items; total.value = response.total; }
  catch (cause) { error.value = errorMessage(cause, 'No se pudo consultar el histórico.'); } finally { loading.value = false; } }
async function openFolder(groupId: number): Promise<void> { openingGroupId.value = groupId; try { const opened = await window.sefiplanApi.openMonthlyReportFolder(groupId); if (!opened) throw new Error('El expediente todavía no tiene reporte mensual.'); }
  catch (cause) { error.value = errorMessage(cause, 'No se pudo abrir la carpeta.'); } finally { openingGroupId.value = null; } }
onMounted(load);
</script>
<template>
  <PageHeader title="Histórico mensual" description="Consulta expedientes mensuales, sus quincenas activas y el reporte vigente." />
  <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
  <form class="filter-bar" @submit.prevent="page = 1; load()"><div><label for="history-year">Año</label><input id="history-year" v-model.number="year" class="form-control" type="number" placeholder="Todos" /></div><button class="btn btn-primary align-self-end" type="submit" :disabled="loading"><i class="bi bi-search" /> Buscar</button></form>
  <div v-if="loading" class="inline-loading" role="status"><span class="spinner-border spinner-border-sm" /> Consultando histórico…</div>
  <EmptyState v-else-if="!items.length" title="Todavía no hay expedientes" description="Cuando completes una importación aparecerá aquí con sus archivos y evidencia."><RouterLink class="btn btn-primary" to="/importar">Nuevo expediente</RouterLink></EmptyState>
  <section v-else class="history-list" aria-labelledby="history-list-title"><header class="history-list__header"><div><span class="eyebrow">Expedientes procesados</span><h2 id="history-list-title">{{ total.toLocaleString('es-MX') }} registrados</h2></div><p>Expande un expediente para consultar cada TXT.</p></header>
    <ol class="history-list__items"><li v-for="group in items" :key="group.id" class="history-record"><article><div class="history-record__summary"><div class="history-record__period"><span class="history-record__label">Mes y quincenas</span><strong>{{ periodLabel(group) }}</strong></div><div class="history-record__file"><span class="history-record__label">Expediente {{ group.id }} · Revisión {{ group.revision }}</span><strong>{{ group.fileCount }} {{ group.fileCount === 1 ? 'archivo activo' : 'archivos activos' }} · {{ group.conceptGroupName }}</strong></div><div class="history-record__total"><span class="history-record__label">Total mensual</span><MoneyValue :cents="group.totalAmountCents" /></div><StatusBadge :status="group.status" /><button class="btn btn-outline-secondary btn-sm history-record__action" type="button" :disabled="openingGroupId !== null || !group.reportPath" @click="openFolder(group.id)"><i class="bi bi-folder2-open" /> {{ openingGroupId === group.id ? 'Abriendo…' : 'Abrir reporte' }}</button></div>
      <dl class="history-record__metrics"><div><dt>Registros</dt><dd>{{ group.totalLines.toLocaleString('es-MX') }}</dd></div><div><dt>Excluidos</dt><dd>{{ group.excludedLines.toLocaleString('es-MX') }}</dd></div><div :class="{ 'has-errors': group.invalidLines > 0 }"><dt>Errores</dt><dd>{{ group.invalidLines.toLocaleString('es-MX') }}</dd></div><div><dt>Procesado</dt><dd>{{ completedDate(group.completedAt) }}</dd></div></dl>
      <details class="history-record__files"><summary>Ver {{ group.batches.length }} archivos activos</summary><div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Quincena</th><th>Tipo</th><th>Archivo</th><th>Versión</th><th>Estado</th><th class="text-end">Registros</th><th class="text-end">Total</th></tr></thead><tbody><tr v-for="batch in group.batches" :key="batch.id"><td>Q{{ String(batch.fortnight).padStart(2, '0') }}</td><td>{{ batch.payrollTypeName }}</td><td class="filename-cell">{{ batch.originalFilename }}</td><td>v{{ batch.version }}</td><td><StatusBadge :status="batch.status" /></td><td class="text-end">{{ batch.totalLines.toLocaleString('es-MX') }}</td><td class="text-end"><MoneyValue :cents="batch.totalAmountCents" /></td></tr></tbody></table></div></details>
    </article></li></ol></section>
  <nav v-if="total > PAGE_SIZE" class="pagination-bar" aria-label="Paginación"><span>Mostrando {{ ((page - 1) * PAGE_SIZE + 1) }}–{{ Math.min(page * PAGE_SIZE, total) }} de {{ total }}</span><div><button class="btn btn-outline-secondary btn-sm" :disabled="page === 1" @click="page--; load()">Anterior</button><span>Página {{ page }}</span><button class="btn btn-outline-secondary btn-sm" :disabled="page * PAGE_SIZE >= total" @click="page++; load()">Siguiente</button></div></nav>
</template>
