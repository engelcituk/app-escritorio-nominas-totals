<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { OutboxStatus, SyncDetail, SyncEntry, SyncQuery, SyncStatus, SyncRemoteHistory } from '@shared/types/sync';
import CatalogStatusPanel from '../components/CatalogStatusPanel.vue';

const status = ref<SyncStatus | null>(null); const items = ref<SyncEntry[]>([]); const total = ref(0);
const page = ref(1); const pageSize = ref(25); const filter = ref<SyncQuery['status']>('all'); const search = ref(''); const appliedSearch = ref('');
const loading = ref(false); const acting = ref(false); const error = ref(''); const detail = ref<SyncDetail | null>(null);
const remote = ref<SyncRemoteHistory | null>(null); const remoteLoading = ref(false); const remotePage = ref(1);
const remotePages = computed(() => Math.max(1, Math.ceil((remote.value?.batches.length ?? 0) / 25)));
const remoteRows = computed(() => remote.value?.batches.slice((remotePage.value - 1) * 25, remotePage.value * 25) ?? []);
const uploadStage = { REGISTERING: 'Registrando reporte', VERIFYING: 'Verificando copia local', UPLOADING: 'Subiendo Excel', CONFIRMING: 'Confirmando disponibilidad' };
const uploadPercent = computed(() => status.value?.progress ? Math.min(100, Math.round(status.value.progress.bytesSent * 100 / status.value.progress.totalBytes)) : 0);
let remoteSequence = 0; let remoteTrigger: HTMLElement | null = null;
async function showRemote(uuid: string, event: Event): Promise<void> {
  remoteTrigger = event.currentTarget as HTMLElement; const current = ++remoteSequence; remoteLoading.value = true; remote.value = null;
  try { const value = await window.sefiplanApi.sync.remoteHistory({ operationUuid: uuid });
    if (current === remoteSequence) { remote.value = value; remotePage.value = 1; await nextTick(); document.getElementById('remote-history-title')?.focus(); }
  } catch { if (current === remoteSequence) error.value = 'No se pudo consultar el expediente central. Verifica conexión, sesión y permisos.'; }
  finally { if (current === remoteSequence) remoteLoading.value = false; }
}
function closeRemote(): void { ++remoteSequence; remote.value = null; remoteLoading.value = false; remoteTrigger?.focus(); }
const labels: Record<OutboxStatus, string> = { PENDING: 'Pendiente', IN_PROGRESS: 'En curso', RETRY: 'Reintento programado', SYNCED: 'Confirmada', FAILED: 'Requiere atención', CONFLICT: 'Conflicto' };
const types: Record<SyncEntry['operationType'], string> = { 'local.result.publish': 'Publicar resultado local', 'reconciliation.upsert': 'Expediente', 'batch.upsert': 'Lote', 'report.upload': 'Reporte Excel' };
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const date = (value: string | null) => value ? new Date(value).toLocaleString('es-MX') : '—';
let timer: ReturnType<typeof setInterval> | undefined; let unsubscribe: (() => void) | undefined; let sequence = 0; let detailSequence = 0;
let detailTrigger: HTMLElement | null = null;
async function refresh(): Promise<void> {
  const current = ++sequence; loading.value = true;
  try {
    const [summary, rows] = await Promise.all([window.sefiplanApi.sync.status(), window.sefiplanApi.sync.list({ page: page.value, pageSize: pageSize.value, status: filter.value, search: appliedSearch.value })]);
    if (current !== sequence) return;
    status.value = summary; items.value = rows.items; total.value = rows.total; error.value = '';
    if (page.value > pages.value) page.value = pages.value;
  } catch { if (current === sequence) error.value = 'No se pudo consultar la cola. Los resultados locales se conservan.'; }
  finally { if (current === sequence) loading.value = false; }
}
async function showDetail(uuid: string, event?: Event): Promise<void> {
  if (event?.currentTarget instanceof HTMLElement) detailTrigger = event.currentTarget;
  const current = ++detailSequence;
  try { const value = await window.sefiplanApi.sync.detail({ operationUuid: uuid }); if (current === detailSequence) {
    detail.value = value; await nextTick(); if (current === detailSequence) document.getElementById('operation-detail-title')?.focus();
  } }
  catch { if (current === detailSequence) error.value = 'No se pudo consultar el diagnóstico de la operación.'; }
}
async function act(action: 'check' | 'run' | 'retry', uuid?: string): Promise<void> {
  acting.value = true;
  try {
    if (action === 'check') await window.sefiplanApi.sync.checkConnection();
    else if (action === 'retry' && uuid) await window.sefiplanApi.sync.retry({ operationUuid: uuid });
    else await window.sefiplanApi.sync.run();
    await refresh(); if (detail.value) await showDetail(detail.value.operationUuid);
  } catch { error.value = 'No se pudo completar la acción. La operación mantiene su UUID y contenido.'; }
  finally { acting.value = false; }
}
function closeDetail(): void { detail.value = null; ++detailSequence; detailTrigger?.focus(); }
function searchRows(): void { appliedSearch.value = search.value.trim(); page.value = 1; void refresh(); }
watch([filter, pageSize], () => { page.value = 1; void refresh(); }); watch(page, () => { void refresh(); });
onMounted(() => { unsubscribe = window.sefiplanApi.sync.onChanged(value => { status.value = value; });
  timer = setInterval(() => { if (!loading.value && !acting.value) void refresh(); }, 5000); void refresh(); });
onBeforeUnmount(() => { ++sequence; ++detailSequence; ++remoteSequence; unsubscribe?.(); clearInterval(timer); });
</script>

<template>
  <div class="sync-view">
    <header class="mb-4"><h1>Sincronización</h1><p class="text-muted">El procesamiento local y la entrega a Laravel son estados independientes.</p></header>
    <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
    <section class="border rounded p-3 mb-3" aria-labelledby="sync-status-title">
      <h2 id="sync-status-title" class="h6">Cola de envío</h2>
      <p role="status" aria-live="polite">{{ status?.message ?? 'Consultando estado…' }}</p>
      <p class="small">Cada publicación envía expediente, lote y dos Excel. Solo se confirma cuando Laravel registra los resultados y la disponibilidad de ambos reportes. Los reintentos conservan el mismo UUID.</p>
      <div v-if="status?.progress" class="mb-3" aria-live="polite">
        <p class="small mb-1">{{ uploadStage[status.progress.stage] }} · {{ status.progress.filename }}</p>
        <div class="progress" role="progressbar" aria-label="Transferencia del Excel; pendiente de confirmación" :aria-valuenow="uploadPercent" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" :style="{ width: `${uploadPercent}%` }">{{ uploadPercent }}%</div></div>
        <small>{{ (status.progress.bytesSent / 1048576).toFixed(2) }} / {{ (status.progress.totalBytes / 1048576).toFixed(2) }} MiB. La transferencia no equivale a disponibilidad confirmada.</small>
      </div>
      <div v-if="status" class="d-flex flex-wrap gap-3 small mb-3">
        <span>Pendientes: <strong>{{ status.pending }}</strong></span><span>En curso: <strong>{{ status.inProgress }}</strong></span>
        <span>Confirmadas: <strong>{{ status.synced }}</strong></span><span>Con error: <strong>{{ status.failed }}</strong></span><span>Conflictos: <strong>{{ status.conflicts }}</strong></span>
      </div>
      <div class="d-flex gap-2 flex-wrap">
        <button class="btn btn-outline-primary" :disabled="acting || !status?.canCheckConnection" @click="act('check')">Verificar conexión</button>
        <button class="btn btn-primary" :disabled="acting || !status?.canRun" @click="act('run')">Procesar cola disponible</button>
      </div>
      <p v-if="status" class="small text-muted mt-2 mb-0">Última entrega confirmada: {{ date(status.lastCompletedAt) }} · Próximo intento: {{ date(status.nextAttemptAt) }}</p>
    </section>
    <CatalogStatusPanel />
    <form class="row g-3 my-2" @submit.prevent="searchRows">
      <div class="col-lg-6"><label for="sync-search" class="form-label">Buscar por UUID o entidad</label><div class="input-group"><input id="sync-search" v-model="search" class="form-control" maxlength="120" /><button class="btn btn-outline-secondary" :disabled="loading">Buscar</button></div></div>
      <div class="col-sm-8 col-lg-4"><label for="sync-filter" class="form-label">Estado</label><select id="sync-filter" v-model="filter" class="form-select"><option value="all">Todos</option><option v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</option></select></div>
      <div class="col-sm-4 col-lg-2"><label for="sync-size" class="form-label">Filas</label><select id="sync-size" v-model.number="pageSize" class="form-select"><option v-for="size in [25, 50, 100]" :key="size" :value="size">{{ size }}</option></select></div>
    </form>
    <p class="small text-muted" role="status">{{ loading ? 'Actualizando lista…' : `${total} operaciones · Página ${page} de ${pages}` }}</p>
    <div class="table-responsive" :aria-busy="loading">
      <table class="table table-striped align-middle"><caption class="visually-hidden">Operaciones de la cola local de sincronización</caption>
        <thead><tr><th scope="col">Operación / UUID</th><th scope="col">Estado</th><th scope="col">Intentos</th><th scope="col">Diagnóstico / próximo intento</th><th scope="col">Acciones</th></tr></thead>
        <tbody><tr v-for="item in items" :key="item.operationUuid">
          <td><strong>{{ types[item.operationType] }}</strong><small class="d-block sync-uuid">{{ item.operationUuid }}</small><small>Entidad local: {{ item.entityType }} {{ item.localEntityId ?? '' }}</small></td>
          <td>{{ labels[item.status] }}</td><td>{{ item.attempts }}</td><td>{{ item.message }}<small v-if="item.nextAttemptAt" class="d-block">{{ date(item.nextAttemptAt) }}</small></td>
          <td><div class="d-flex flex-column gap-2"><button class="btn btn-sm btn-outline-secondary" :aria-label="`Diagnóstico de ${item.operationUuid}`" @click="showDetail(item.operationUuid, $event)">Diagnóstico</button>
            <button class="btn btn-sm btn-outline-primary" :disabled="acting || !status?.canRun || !item.canRetry" :aria-label="`Reintentar ${item.operationUuid}`" @click="act('retry', item.operationUuid)">Reintentar</button>
            <button v-if="item.operationType === 'reconciliation.upsert' && item.status === 'SYNCED'" class="btn btn-sm btn-outline-primary" :disabled="remoteLoading || !status?.canRun" @click="showRemote(item.operationUuid, $event)">Consultar expediente central</button></div></td>
        </tr><tr v-if="!items.length && !loading"><td colspan="5" class="text-muted py-4">{{ total === 0 && filter === 'all' && !appliedSearch ? 'No hay operaciones en la cola. Los nuevos resultados completados aparecerán aquí.' : 'No hay operaciones que coincidan con los filtros.' }}</td></tr></tbody>
      </table>
    </div>
    <nav class="d-flex gap-3 align-items-center my-3" aria-label="Páginas de la cola"><button class="btn btn-outline-secondary" :disabled="loading || page <= 1" @click="page--">Anterior</button><span>Página {{ page }} de {{ pages }}</span><button class="btn btn-outline-secondary" :disabled="loading || page >= pages" @click="page++">Siguiente</button></nav>
    <p v-if="remoteLoading" role="status">Consultando expediente central…</p>
    <section v-if="remote" class="border rounded p-3 mb-3" aria-labelledby="remote-history-title">
      <div class="d-flex justify-content-between gap-2"><h2 id="remote-history-title" class="h5" tabindex="-1">Historial central · {{ remote.month }}/{{ remote.year }}</h2><button class="btn btn-sm btn-outline-secondary" @click="closeRemote">Cerrar historial</button></div>
      <p class="small sync-uuid">{{ remote.uuid }} · Revisión {{ remote.revision }} · {{ remote.status }}<br />Consultado: {{ date(remote.checkedAt) }}. Esta consulta no se actualiza automáticamente.</p>
      <p>Total central: {{ (remote.totalAmountCents / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) }} · {{ remote.totalLines }} líneas</p>
      <div class="table-responsive"><table class="table table-striped"><caption class="visually-hidden">Lotes y versiones consultados en Laravel</caption><thead><tr><th scope="col">Archivo / UUID</th><th scope="col">Quincena del mes</th><th scope="col">Versión</th><th scope="col">Estado</th><th scope="col">Total</th></tr></thead>
        <tbody><tr v-for="batch in remoteRows" :key="batch.uuid"><td>{{ batch.originalFilename }}<small class="d-block sync-uuid">{{ batch.uuid }}</small></td><td>{{ batch.fortnight }}</td><td>{{ batch.version }}</td><td>{{ batch.status }} · {{ batch.active ? 'Activo' : 'Histórico' }}</td><td>{{ (batch.totalAmountCents / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) }}</td></tr><tr v-if="!remoteRows.length"><td colspan="5">El expediente central todavía no contiene lotes.</td></tr></tbody></table></div>
      <nav class="d-flex gap-3 align-items-center mt-2" aria-label="Páginas del historial central"><button class="btn btn-outline-secondary" :disabled="remotePage <= 1" @click="remotePage--">Anterior</button><span>{{ remotePage }} / {{ remotePages }}</span><button class="btn btn-outline-secondary" :disabled="remotePage >= remotePages" @click="remotePage++">Siguiente</button></nav>
      <p class="small text-muted mt-2 mb-0">Se consultan los expedientes vinculados a esta instalación. La API no ofrece un listado global.</p>
    </section>
    <section v-if="detail" class="border rounded p-3" aria-labelledby="operation-detail-title">
      <div class="d-flex justify-content-between gap-2"><h2 id="operation-detail-title" class="h5" tabindex="-1">Diagnóstico de operación</h2><button class="btn btn-sm btn-outline-secondary" @click="closeDetail">Cerrar diagnóstico</button></div>
      <dl class="sync-detail"><dt>UUID</dt><dd>{{ detail.operationUuid }}</dd><dt>Hash SHA-256 del contenido</dt><dd>{{ detail.payloadHashSha256 }}</dd>
        <dt>Estado</dt><dd>{{ labels[detail.status] }} · {{ detail.message }}</dd><dt>Error / HTTP</dt><dd>{{ detail.errorCode ?? '—' }} / {{ detail.httpStatus ?? '—' }}</dd>
        <dt>Recurso central confirmado</dt><dd>{{ detail.centralEntityUuid ?? 'Sin confirmación' }}</dd><dt>Dependencia</dt><dd>{{ detail.dependsOn ?? 'Ninguna' }}</dd><dt>Operación anterior</dt><dd>{{ detail.supersedes ?? 'Ninguna' }}</dd>
        <dt>Creada / actualizada</dt><dd>{{ date(detail.createdAt) }} / {{ date(detail.updatedAt) }}</dd></dl>
      <p class="small mb-0">El diagnóstico omite payloads, credenciales, rutas y respuestas crudas del servidor. Un conflicto requiere revisión; reintentar no cambia su identidad.</p>
    </section>
  </div>
</template>

<style scoped lang="scss">
.sync-uuid, .sync-detail dd { overflow-wrap: anywhere; }
.sync-view td { min-width: 5rem; }
.sync-view td:first-child { min-width: 13rem; }
.sync-view td:nth-child(4) { min-width: 13rem; }
.sync-view .table-responsive { border: 1px solid #d7dde5; border-radius: .25rem; }
.sync-detail { margin-top: 1rem; }
</style>
