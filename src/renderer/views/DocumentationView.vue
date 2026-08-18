<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { PayrollConcept } from '@shared/types/payroll';
import PageHeader from '../components/PageHeader.vue';

const route = useRoute();
const topics = [
  { id: 'reconocimiento', label: 'Reconocimiento' },
  { id: 'operaciones', label: 'Suma y resta' },
  { id: 'retenidos', label: 'Retenidos' },
  { id: 'duplicados', label: 'Duplicados' },
  { id: 'reportes', label: 'Reportes' },
  { id: 'conceptos', label: 'Conceptos vigentes' },
] as const;
const concepts = ref<PayrollConcept[]>([]); const loading = ref(true); const search = ref('');
const filtered = computed(() => { const q = search.value.trim().toLocaleUpperCase('es-MX'); return concepts.value.filter((concept) => !q
  || `${concept.name} ${concept.groupName ?? ''} ${concept.aliases.map((a) => a.sourceDescription).join(' ')}`.toLocaleUpperCase('es-MX').includes(q)); });
function isActiveTopic(id: string): boolean { return (route.hash || '#reconocimiento') === `#${id}`; }
onMounted(async () => { try { concepts.value = (await window.sefiplanApi.getConceptCatalog()).concepts.filter((concept) => concept.active); } finally { loading.value = false; } });
</script>

<template>
  <PageHeader title="Documentación" description="Consulta cómo reconoce, excluye y totaliza la aplicación sin modificar sus reglas internas." />
  <div class="documentation-layout"><nav class="documentation-index" aria-label="Temas de documentación"><RouterLink v-for="topic in topics" :key="topic.id" :to="{ name: 'documentation', hash: `#${topic.id}` }" active-class="" exact-active-class="" :class="{ active: isActiveTopic(topic.id) }" :aria-current="isActiveTopic(topic.id) ? 'location' : undefined">{{ topic.label }}</RouterLink></nav>
    <div class="documentation-content"><section id="reconocimiento"><span class="eyebrow">Reconocimiento</span><h2>Conceptos y alias</h2><p>Cada movimiento se compara con alias exactos del catálogo. La comparación ignora mayúsculas, acentos y espacios repetidos; también interpreta “I S R” como “ISR”. No se aplican coincidencias abiertas por fragmentos.</p></section>
      <section id="operaciones"><span class="eyebrow">Cálculo</span><h2>Contribución firmada</h2><p>Solo se totalizan conceptos marcados para el TXT. Un concepto con operación <strong>Suma</strong> conserva su importe; uno con <strong>Resta</strong> multiplica el importe por −1.</p><div class="documentation-example"><strong>REINTEGRO DE ISR PAGADO EN EXCESO</strong><span>Importe original $500.00 × −1 = contribución −$500.00</span></div><p>Los conceptos del mismo grupo generan un subtotal, como <strong>Total ISR</strong>. El total general es la suma firmada de todos los lotes activos.</p></section>
      <section id="retenidos"><span class="eyebrow">Exclusiones</span><h2>Empleados retenidos</h2><p>Los retenidos se capturan por TXT. Se excluyen todos sus movimientos correspondientes a los conceptos seleccionados en ese archivo. Los no encontrados requieren confirmación y quedan en auditoría.</p></section>
      <section id="duplicados"><span class="eyebrow">Trazabilidad</span><h2>Duplicados y versiones</h2><p>El hash SHA-256 identifica el contenido. No puede repetirse dentro del mismo expediente. Un archivo histórico solo puede reprocesarse como nueva versión; la anterior se supera después de que la nueva concilia correctamente.</p></section>
      <section id="reportes"><span class="eyebrow">Evidencia</span><h2>Procesamiento y reportes</h2><p>Los TXT se procesan secuencialmente. Cada uno genera detalle, totales, exclusiones y auditoría. El expediente añade un consolidado por quincena, tipo, concepto, grupo y archivo.</p></section>
      <section id="conceptos"><span class="eyebrow">Catálogo vigente</span><h2>Conceptos documentados</h2><label class="visually-hidden" for="docs-search">Buscar concepto</label><input id="docs-search" v-model="search" class="form-control mb-3" placeholder="Buscar concepto o alias" />
        <div v-if="loading" class="inline-loading" role="status"><span class="spinner-border spinner-border-sm" /> Cargando…</div><div v-else class="documented-concepts"><article v-for="concept in filtered" :key="concept.id"><div><strong>{{ concept.name }}</strong><small>{{ concept.groupName || 'Sin grupo' }} · {{ concept.operationFactor === -1 ? 'Resta' : 'Suma' }}</small></div><ul><li v-for="alias in concept.aliases.filter(a => a.active)" :key="alias.id">{{ alias.sourceDescription }}</li></ul></article></div></section>
    </div>
  </div>
</template>
