<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { CatalogAliasEntry, CatalogConflict, CatalogEntry, CatalogQuery } from '@shared/types/catalog';
import PageHeader from '../components/PageHeader.vue';
import CatalogStatusPanel from '../components/CatalogStatusPanel.vue';
import { useCatalogStore } from '../stores/catalog';
import { errorMessage } from '../utils/errorMessage';
const route = useRoute(); const catalog = useCatalogStore();
const entity = ref<CatalogQuery['entity'] | 'conflicts'>(route.query.entity === 'types' ? 'types' : 'concepts');
const search = ref(''); const filter = ref<CatalogQuery['filter']>('all'); const page = ref(1); const pageSize = ref(25);
const items = ref<CatalogEntry[]>([]); const conflicts = ref<CatalogConflict[]>([]); const total = ref(0);
const loading = ref(false); const error = ref(''); const selected = ref<CatalogEntry | null>(null);
const exporting = ref(false); const exportMessage = ref('');
const aliases = ref<CatalogAliasEntry[]>([]); const aliasPage = ref(1); const aliasTotal = ref(0); const aliasLoading = ref(false);
let sequence = 0; let aliasSequence = 0; let timer: ReturnType<typeof setTimeout> | undefined;
const pages = computed(() => Math.max(1, Math.ceil(total.value / (entity.value === 'conflicts' ? 25 : pageSize.value))));
async function load(): Promise<void> {
  const request = ++sequence; loading.value = true; error.value = '';
  try {
    const response = entity.value === 'conflicts' ? await window.sefiplanApi.catalog.conflicts({ page: page.value })
      : await window.sefiplanApi.catalog.list({ entity: entity.value, page: page.value, pageSize: pageSize.value, search: search.value, filter: filter.value });
    if (request !== sequence) return;
    total.value = response.total;
    if (entity.value === 'conflicts') conflicts.value = response.items as CatalogConflict[]; else items.value = response.items as CatalogEntry[];
  } catch (cause) { if (request === sequence) error.value = errorMessage(cause, 'No se pudo consultar el catálogo.'); }
  finally { if (request === sequence) loading.value = false; }
}
async function loadAliases(): Promise<void> {
  const request = ++aliasSequence; if (!selected.value) return; aliasLoading.value = true;
  try { const response = await window.sefiplanApi.catalog.aliases({ id: selected.value.id, page: aliasPage.value });
    if (request === aliasSequence) { aliases.value = response.items; aliasTotal.value = response.total; }
  } catch (cause) { if (request === aliasSequence) error.value = errorMessage(cause, 'No se pudieron consultar los alias.'); }
  finally { if (request === aliasSequence) aliasLoading.value = false; }
}
function select(item: CatalogEntry): void { selected.value = item; aliasPage.value = 1; aliases.value = []; aliasTotal.value = 0; void loadAliases(); }
async function exportConflicts(): Promise<void> {
  exporting.value = true; exportMessage.value = ''; error.value = '';
  try { const result = await window.sefiplanApi.catalog.exportConflicts(); if (result) exportMessage.value = `Diagnóstico exportado: ${result.path}`; }
  catch (cause) { error.value = errorMessage(cause, 'No se pudo exportar el diagnóstico.'); }
  finally { exporting.value = false; }
}

watch([entity, search, filter, pageSize, () => catalog.status?.syncedAt], () => {
  ++sequence; ++aliasSequence; selected.value = null; page.value = 1; clearTimeout(timer); loading.value = true; timer = setTimeout(() => { void load(); }, 200);
}, { immediate: true });
watch(page, () => { clearTimeout(timer); void load(); });
watch(aliasPage, () => { void loadAliases(); });
onBeforeUnmount(() => { ++sequence; ++aliasSequence; clearTimeout(timer); });
</script>
<template>
  <PageHeader title="Catálogo central" description="Consulta la réplica local, sus UUID y los registros pendientes de vincular. Las modificaciones se realizan en Laravel." />
  <CatalogStatusPanel />
  <div v-if="entity === 'conflicts'" class="mb-3"><p>Los registros sin enlace central no se usan en nuevos procesamientos. Solicita su registro o revisión en la administración central.</p><button class="btn btn-outline-primary" type="button" :disabled="exporting || loading || !total" @click="exportConflicts">{{ exporting ? 'Exportando…' : 'Exportar diagnóstico JSON' }}</button><p v-if="exportMessage" class="mt-2" role="status">{{ exportMessage }}</p></div>
  <div v-if="error" class="alert alert-danger" role="alert">{{ error }} <button class="btn btn-outline-danger btn-sm" type="button" @click="load">Reintentar</button></div>
  <div class="row g-3 mb-3">
    <div class="col-md-3"><label for="catalog-entity" class="form-label">Catálogo</label><select id="catalog-entity" v-model="entity" class="form-select"><option value="concepts">Conceptos</option><option value="groups">Grupos</option><option value="types">Tipos de nómina</option><option value="conflicts">Diagnóstico de vinculación</option></select></div>
    <template v-if="entity !== 'conflicts'"><div class="col-md-5"><label for="catalog-search" class="form-label">Buscar por código, nombre o alias</label><input id="catalog-search" v-model="search" class="form-control" type="search" maxlength="120" /></div>
      <div class="col-md-2"><label for="catalog-filter" class="form-label">Estado</label><select id="catalog-filter" v-model="filter" class="form-select"><option value="all">Todos</option><option value="active">Activos centrales</option><option value="inactive">Inactivos</option><option value="legacy">Sin enlace central</option></select></div>
      <div class="col-md-2"><label for="catalog-size" class="form-label">Filas</label><select id="catalog-size" v-model.number="pageSize" class="form-select"><option :value="25">25</option><option :value="50">50</option><option :value="100">100</option></select></div></template>
  </div>
  <div :aria-busy="loading">
    <p v-if="loading" role="status">Consultando registros…</p>
    <p v-else-if="!total" class="border rounded p-4" role="status">Sin registros para esta consulta. Si aún no existe una copia central, inicia sesión y sincroniza el catálogo.</p>
    <div v-else class="table-responsive"><table class="table table-striped align-middle"><caption>{{ total }} registros · Página {{ page }} de {{ pages }}</caption>
      <template v-if="entity === 'conflicts'"><thead><tr><th scope="col">Entidad / ID local</th><th scope="col">Código</th><th scope="col">Diagnóstico</th></tr></thead><tbody><tr v-for="item in conflicts" :key="item.id"><td>{{ item.entityType }} / {{ item.localId }}</td><td>{{ item.code || '—' }}</td><td>{{ item.description }}</td></tr></tbody></template>
      <template v-else><thead><tr><th scope="col">Código / UUID</th><th scope="col">Nombre</th><th scope="col">Estado</th><th v-if="entity === 'concepts'" scope="col">Grupo / Operación</th><th v-if="entity === 'concepts'" scope="col">Alias</th></tr></thead>
        <tbody><tr v-for="item in items" :key="item.id"><td><strong>{{ item.code }}</strong><small class="d-block text-break">{{ item.uuid || `Local #${item.id}` }}</small></td><td>{{ item.name }}</td><td><span :class="item.mappingStatus === 'LEGACY_UNMAPPED' ? 'badge text-bg-warning' : ''">{{ item.mappingStatus === 'LEGACY_UNMAPPED' ? 'Sin enlace central' : item.active ? 'Activo' : 'Inactivo' }}</span></td><td v-if="entity === 'concepts'">{{ item.groupName || 'Sin grupo' }} · {{ item.operationFactor === -1 ? 'Resta' : 'Suma' }}</td><td v-if="entity === 'concepts'"><button class="btn btn-outline-secondary btn-sm" type="button" :disabled="loading" :aria-label="`Consultar alias de ${item.name}`" @click="select(item)">{{ item.aliasCount }} · Ver alias</button></td></tr></tbody></template>
    </table></div>
    <nav class="d-flex gap-3 align-items-center mb-4" aria-label="Paginación del catálogo"><button class="btn btn-outline-secondary" type="button" :disabled="loading || page <= 1" @click="page--">Anterior</button><span aria-live="polite">Página {{ page }} de {{ pages }}</span><button class="btn btn-outline-secondary" type="button" :disabled="loading || page >= pages" @click="page++">Siguiente</button></nav>
  </div>
  <section v-if="selected && entity === 'concepts'" class="border rounded p-3" aria-label="Detalle de alias" :aria-busy="aliasLoading">
    <h2 class="h5">Alias de {{ selected.name }}</h2><p class="small text-break">UUID: {{ selected.uuid || 'Sin enlace central' }} · Revisión: {{ selected.revision ?? 'Legado' }}</p>
    <p v-if="aliasLoading" role="status">Consultando alias…</p><p v-else-if="!aliasTotal">Sin alias.</p>
    <ul v-else><li v-for="alias in aliases" :key="alias.id">{{ alias.sourceDescription }} · {{ alias.active ? 'Activo' : 'Inactivo' }}<small class="d-block text-break">{{ alias.uuid || 'Sin enlace central' }}</small></li></ul>
    <div class="d-flex gap-3 align-items-center"><button class="btn btn-outline-secondary btn-sm" type="button" :disabled="aliasLoading || aliasPage <= 1" @click="aliasPage--">Alias anteriores</button><span>{{ aliasPage }} / {{ Math.max(1, Math.ceil(aliasTotal / 25)) }}</span><button class="btn btn-outline-secondary btn-sm" type="button" :disabled="aliasLoading || aliasPage * 25 >= aliasTotal" @click="aliasPage++">Alias siguientes</button></div>
  </section>
</template>
