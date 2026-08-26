<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import type { DetectedConcept } from '@shared/types/payroll';
import { canonicalizeConceptDescription } from '@shared/utils/normalization';
import MoneyValue from './MoneyValue.vue';

const props = defineProps<{ modelValue: number[]; options: DetectedConcept[]; filename: string; loading?: boolean; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [number[]]; change: [] }>();
const root = ref<HTMLElement | null>(null); const searchInput = ref<HTMLInputElement | null>(null);
const inputId = useId(); const listId = useId(); const helperId = useId();
const open = ref(false); const search = ref('');
const catalogued = computed(() => props.options.filter((option) => option.catalogConcept));
const filtered = computed(() => { const query = canonicalizeConceptDescription(search.value); return props.options.filter((option) =>
  !query || canonicalizeConceptDescription(`${option.sourceDescription} ${option.catalogConcept?.name ?? ''} ${option.catalogConcept?.groupName ?? ''}`).includes(query)); });
const selectedOptions = computed(() => { const ids = new Set<number>(); return catalogued.value.filter((option) => {
  const id = option.catalogConcept!.id; if (!props.modelValue.includes(id) || ids.has(id)) return false; ids.add(id); return true; }); });
const summary = computed(() => props.modelValue.length ? `${props.modelValue.length} conceptos seleccionados` : 'Elegir conceptos');
const helper = computed(() => props.loading
  ? 'Analizando el TXT con el catálogo central vigente…'
  : `${props.options.length} conceptos detectados en ${props.filename}`);

async function toggle(): Promise<void> { if (props.disabled) return; open.value = !open.value; if (open.value) { await nextTick(); searchInput.value?.focus(); } }
function update(id: number, selected: boolean): void { const next = selected ? [...new Set([...props.modelValue, id])] : props.modelValue.filter((value) => value !== id);
  emit('update:modelValue', next); emit('change'); }
function selectVisible(): void { const ids = filtered.value.flatMap((option) => option.catalogConcept ? [option.catalogConcept.id] : []);
  emit('update:modelValue', [...new Set([...props.modelValue, ...ids])]); emit('change'); }
function clear(): void { emit('update:modelValue', []); emit('change'); }
function clickOutside(event: MouseEvent): void { if (root.value && !root.value.contains(event.target as Node)) open.value = false; }
onMounted(() => document.addEventListener('mousedown', clickOutside));
onBeforeUnmount(() => document.removeEventListener('mousedown', clickOutside));
</script>

<template>
  <div ref="root" class="concept-multiselect" @keydown.esc="open = false">
    <div v-if="selectedOptions.length" class="concept-multiselect__chips" aria-label="Conceptos seleccionados">
      <span v-for="option in selectedOptions" :key="option.catalogConcept!.id" class="concept-chip">
        {{ option.catalogConcept!.name }}
        <button type="button" :disabled="disabled||loading" :aria-label="`Quitar ${option.catalogConcept!.name}`" @click="update(option.catalogConcept!.id, false)"><i class="bi bi-x" aria-hidden="true" /></button>
      </span>
    </div>
    <button class="concept-multiselect__trigger" type="button" :aria-expanded="open" :aria-controls="listId" :aria-describedby="helperId" :disabled="disabled||loading" @click="toggle">
      <span class="concept-multiselect__trigger-icon"><i class="bi bi-list-check" aria-hidden="true" /></span>
      <span class="concept-multiselect__trigger-copy">
        <strong>{{ summary }}</strong>
        <small :id="helperId" aria-live="polite">{{ helper }}</small>
      </span>
      <span class="concept-multiselect__trigger-action">
        <span>{{ open ? 'Cerrar lista' : 'Abrir lista' }}</span>
        <i class="bi" :class="open ? 'bi-chevron-up' : 'bi-chevron-down'" aria-hidden="true" />
      </span>
    </button>
    <div v-if="open" class="concept-multiselect__panel">
      <div v-if="loading" class="concept-multiselect__analysis-note" role="status">
        <i class="bi bi-info-circle" aria-hidden="true" />
        Espera a que termine el análisis para seleccionar los conceptos reconocidos.
      </div>
      <div class="concept-multiselect__toolbar">
        <label class="visually-hidden" :for="inputId">Buscar conceptos detectados</label>
        <div class="input-group"><span class="input-group-text"><i class="bi bi-search" aria-hidden="true" /></span><input :id="inputId" ref="searchInput" v-model="search" class="form-control" placeholder="Buscar por concepto o grupo" /></div>
        <button class="btn btn-outline-secondary btn-sm" type="button" @click="selectVisible">Seleccionar visibles</button>
        <button class="btn btn-link btn-sm" type="button" :disabled="!modelValue.length" @click="clear">Limpiar</button>
      </div>
      <div :id="listId" class="concept-multiselect__list" role="group" :aria-label="`Conceptos detectados en ${filename}`">
        <div v-if="!filtered.length" class="concept-multiselect__empty">{{ options.length ? 'No hay conceptos que coincidan con la búsqueda.' : 'No se detectaron conceptos en este TXT.' }}</div>
        <div v-for="option in filtered" :key="option.key" class="concept-multiselect__option">
          <label v-if="option.catalogConcept" class="form-check">
            <input class="form-check-input" type="checkbox" :checked="modelValue.includes(option.catalogConcept.id)" @change="update(option.catalogConcept.id, ($event.target as HTMLInputElement).checked)" />
            <span><strong>{{ option.catalogConcept.name }}</strong><small>{{ option.sourceDescription }}</small></span>
          </label>
          <div v-else class="concept-multiselect__unknown"><span><span class="badge text-bg-warning">Sin catalogar</span><strong>{{ option.sourceDescription }}</strong></span><RouterLink to="/catalogo-conceptos">Consultar catálogo central</RouterLink></div>
          <div class="concept-multiselect__meta"><span>{{ loading && !option.recordCount ? 'Disponible para seleccionar' : `${option.recordCount.toLocaleString('es-MX')} registros` }}</span><MoneyValue v-if="!loading || option.recordCount" :cents="option.originalAmountCents" /><span v-if="option.catalogConcept">{{ option.catalogConcept.groupName || 'Sin grupo' }} · {{ option.catalogConcept.operationFactor === -1 ? 'Resta' : 'Suma' }}</span></div>
        </div>
      </div>
    </div>
  </div>
</template>
