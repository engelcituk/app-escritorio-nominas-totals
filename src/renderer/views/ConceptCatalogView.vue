<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { ConceptGroup, PayrollConcept } from '@shared/types/payroll';
import { canonicalizeConceptDescription } from '@shared/utils/normalization';
import EmptyState from '../components/EmptyState.vue';
import PageHeader from '../components/PageHeader.vue';
import { errorMessage } from '../utils/errorMessage';

const groups = ref<ConceptGroup[]>([]); const concepts = ref<PayrollConcept[]>([]); const loading = ref(true); const saving = ref(false);
const error = ref(''); const success = ref(''); const search = ref(''); const aliasText = ref(''); const selectedId = ref<number | null>(null);
const conceptDraft = reactive({ id: undefined as number | undefined, code: '', name: '', groupId: null as number | null,
  operationFactor: 1 as 1 | -1, active: true });
const groupDraft = reactive({ id: undefined as number | undefined, code: '', name: '', active: true });
const filtered = computed(() => { const q = canonicalizeConceptDescription(search.value); return concepts.value.filter((concept) =>
  !q || canonicalizeConceptDescription(`${concept.name} ${concept.code} ${concept.groupName ?? ''} ${concept.aliases.map((a) => a.sourceDescription).join(' ')}`).includes(q)); });
const selected = computed(() => concepts.value.find((concept) => concept.id === selectedId.value) ?? null);

async function load(): Promise<void> { loading.value = true; try { const catalog = await window.sefiplanApi.getConceptCatalog(); groups.value = catalog.groups; concepts.value = catalog.concepts; }
  catch (cause) { error.value = errorMessage(cause, 'No se pudo consultar el catálogo.'); } finally { loading.value = false; } }
onMounted(load);
function edit(concept: PayrollConcept): void { selectedId.value = concept.id; Object.assign(conceptDraft, { id: concept.id, code: concept.code,
  name: concept.name, groupId: concept.groupId, operationFactor: concept.operationFactor, active: concept.active }); }
function clearConcept(): void { selectedId.value = null; aliasText.value = ''; Object.assign(conceptDraft, { id: undefined, code: '', name: '', groupId: null, operationFactor: 1, active: true }); }
async function saveConcept(): Promise<void> { saving.value = true; error.value = ''; try { const id = await window.sefiplanApi.savePayrollConcept({
  ...(conceptDraft.id ? { id: conceptDraft.id } : {}), code: conceptDraft.code, name: conceptDraft.name, groupId: conceptDraft.groupId,
  operationFactor: conceptDraft.operationFactor, active: conceptDraft.active });
  success.value = 'Concepto guardado. Los lotes anteriores conservarán su fotografía.'; await load(); const found = concepts.value.find((item) => item.id === id); if (found) edit(found); }
  catch (cause) { error.value = errorMessage(cause, 'No se pudo guardar el concepto.'); } finally { saving.value = false; } }
function editGroup(group: ConceptGroup): void { Object.assign(groupDraft, group); }
function clearGroup(): void { Object.assign(groupDraft, { id: undefined, code: '', name: '', active: true }); }
async function saveGroup(): Promise<void> { saving.value = true; error.value = ''; try { await window.sefiplanApi.saveConceptGroup({
  ...(groupDraft.id ? { id: groupDraft.id } : {}), code: groupDraft.code, name: groupDraft.name, active: groupDraft.active }); success.value = 'Grupo guardado.';
  clearGroup(); await load(); } catch (cause) { error.value = errorMessage(cause, 'No se pudo guardar el grupo.'); } finally { saving.value = false; } }
async function addAlias(): Promise<void> { if (!selected.value || !aliasText.value.trim()) return; saving.value = true; error.value = '';
  try { await window.sefiplanApi.addConceptAlias({ conceptId: selected.value.id, sourceDescription: aliasText.value }); aliasText.value = '';
    success.value = 'Alias añadido.'; await load(); } catch (cause) { error.value = errorMessage(cause, 'No se pudo añadir el alias.'); } finally { saving.value = false; } }
async function removeAlias(id: number): Promise<void> { try { await window.sefiplanApi.removeConceptAlias(id); success.value = 'Alias desactivado.'; await load(); }
  catch (cause) { error.value = errorMessage(cause, 'No se pudo desactivar el alias.'); } }
</script>

<template>
  <PageHeader title="Catálogo de conceptos" description="Administra los conceptos disponibles, su operación, grupo y descripciones reconocidas." />
  <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div><div v-if="success" class="alert alert-success" role="status">{{ success }}</div>
  <div v-if="loading" class="inline-loading" role="status"><span class="spinner-border spinner-border-sm" /> Cargando catálogo…</div>
  <div v-else class="catalog-layout">
    <section class="catalog-panel" aria-labelledby="concept-list-title"><div class="catalog-panel__header"><div><span class="eyebrow">{{ concepts.length }} conceptos</span><h2 id="concept-list-title">Conceptos de nómina</h2></div><button class="btn btn-primary btn-sm" type="button" @click="clearConcept"><i class="bi bi-plus-lg" /> Nuevo concepto</button></div>
      <label class="visually-hidden" for="catalog-search">Buscar conceptos</label><input id="catalog-search" v-model="search" class="form-control mb-3" placeholder="Buscar por nombre, código, grupo o alias" />
      <EmptyState v-if="!filtered.length" title="Sin resultados" description="Prueba con otro término de búsqueda." icon="bi-search" />
      <div v-else class="catalog-list"><button v-for="concept in filtered" :key="concept.id" class="catalog-list__item" :class="{ active: selectedId === concept.id }" type="button" @click="edit(concept)"><span><strong>{{ concept.name }}</strong><small>{{ concept.code }} · {{ concept.groupName || 'Sin grupo' }}</small></span><span class="catalog-operation" :class="concept.operationFactor === -1 ? 'subtract' : 'add'">{{ concept.operationFactor === -1 ? 'Resta' : 'Suma' }}</span></button></div>
    </section>
    <section class="catalog-editor" aria-labelledby="concept-editor-title"><h2 id="concept-editor-title">{{ conceptDraft.id ? 'Editar concepto' : 'Nuevo concepto' }}</h2>
      <form class="row g-3" @submit.prevent="saveConcept"><div class="col-md-5"><label class="form-label" for="concept-code">Código estable</label><input id="concept-code" v-model.trim="conceptDraft.code" class="form-control" pattern="[A-Z0-9_]+" required :disabled="Boolean(conceptDraft.id)" /></div>
        <div class="col-md-7"><label class="form-label" for="concept-name">Nombre</label><input id="concept-name" v-model.trim="conceptDraft.name" class="form-control" required /></div>
        <div class="col-md-5"><label class="form-label" for="concept-group">Grupo</label><select id="concept-group" v-model="conceptDraft.groupId" class="form-select"><option :value="null">Sin grupo</option><option v-for="group in groups.filter(g => g.active)" :key="group.id" :value="group.id">{{ group.name }}</option></select></div>
        <div class="col-md-4"><label class="form-label" for="concept-operation">Operación</label><select id="concept-operation" v-model.number="conceptDraft.operationFactor" class="form-select"><option :value="1">Suma</option><option :value="-1">Resta</option></select></div>
        <div class="col-md-3 d-flex align-items-end"><label class="form-check"><input v-model="conceptDraft.active" class="form-check-input" type="checkbox" /><span>Activo</span></label></div>
        <div class="col-12 text-end"><button class="btn btn-primary" type="submit" :disabled="saving">Guardar concepto</button></div></form>
      <div v-if="selected" class="alias-editor"><h3>Descripciones reconocidas</h3><p>La coincidencia ignora mayúsculas, acentos y espacios repetidos.</p>
        <ul class="alias-list"><li v-for="alias in selected.aliases.filter(a => a.active)" :key="alias.id"><span>{{ alias.sourceDescription }}</span><button class="btn btn-link btn-sm text-danger" type="button" @click="removeAlias(alias.id)">Desactivar</button></li></ul>
        <form class="input-group" @submit.prevent="addAlias"><label class="visually-hidden" for="alias">Nuevo alias</label><input id="alias" v-model.trim="aliasText" class="form-control" placeholder="Descripción exacta del TXT" required /><button class="btn btn-outline-primary" type="submit" :disabled="saving">Añadir alias</button></form></div>
      <div class="group-editor"><div class="d-flex justify-content-between align-items-center"><h3>{{ groupDraft.id ? 'Editar grupo' : 'Nuevo grupo' }}</h3><button v-if="groupDraft.id" class="btn btn-link btn-sm" type="button" @click="clearGroup">Cancelar edición</button></div>
        <div class="d-flex gap-2 flex-wrap mb-3"><button v-for="group in groups" :key="group.id" class="btn btn-sm" :class="group.active ? 'btn-outline-secondary' : 'btn-outline-danger'" type="button" @click="editGroup(group)">{{ group.name }}{{ group.active ? '' : ' · Inactivo' }}</button></div>
        <form class="row g-2" @submit.prevent="saveGroup"><div class="col-md-3"><input v-model.trim="groupDraft.code" class="form-control" placeholder="CÓDIGO" pattern="[A-Z0-9_]+" required :disabled="Boolean(groupDraft.id)" /></div><div class="col-md-5"><input v-model.trim="groupDraft.name" class="form-control" placeholder="Nombre del grupo" required /></div><div class="col-md-2 d-flex align-items-center"><label class="form-check"><input v-model="groupDraft.active" class="form-check-input" type="checkbox" /><span>Activo</span></label></div><div class="col-md-2"><button class="btn btn-outline-primary w-100" type="submit" :disabled="saving">Guardar</button></div></form></div>
    </section>
  </div>
</template>
