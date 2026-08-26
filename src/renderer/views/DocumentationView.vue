<script setup lang="ts">
import { useRoute } from 'vue-router';
import PageHeader from '../components/PageHeader.vue';

const route = useRoute();
const topics = [
  { id: 'expedientes', label: 'Expedientes mensuales' },
  { id: 'reconocimiento', label: 'Reconocimiento' },
  { id: 'operaciones', label: 'Suma y resta' },
  { id: 'retenidos', label: 'Retenidos' },
  { id: 'duplicados', label: 'Duplicados' },
  { id: 'reportes', label: 'Reportes' },
  { id: 'conceptos', label: 'Conceptos vigentes' },
] as const;
function isActiveTopic(id: string): boolean { return (route.hash || '#expedientes') === `#${id}`; }
</script>

<template>
  <PageHeader title="Documentación" description="Consulta cómo reconoce, excluye y totaliza la aplicación sin modificar sus reglas internas." />
  <div class="documentation-layout"><nav class="documentation-index" aria-label="Temas de documentación"><RouterLink v-for="topic in topics" :key="topic.id" :to="{ name: 'documentation', hash: `#${topic.id}` }" active-class="" exact-active-class="" :class="{ active: isActiveTopic(topic.id) }" :aria-current="isActiveTopic(topic.id) ? 'location' : undefined">{{ topic.label }}</RouterLink></nav>
    <div class="documentation-content"><section id="expedientes"><span class="eyebrow">Flujo mensual</span><h2>Un expediente por periodo y grupo</h2><p>Cada combinación de año, mes y grupo de conceptos abre siempre el mismo expediente. El mes acepta únicamente su pareja de quincenas: enero Q01/Q02, julio Q13/Q14 y diciembre Q23/Q24. La matriz muestra la versión activa de cada tipo de nómina.</p></section>
      <section id="reconocimiento"><span class="eyebrow">Reconocimiento</span><h2>Conceptos y alias</h2><p>Cada movimiento se compara con alias exactos del catálogo. La comparación ignora mayúsculas, acentos y espacios repetidos; también interpreta “I S R” como “ISR”. No se aplican coincidencias abiertas por fragmentos.</p></section>
      <section id="operaciones"><span class="eyebrow">Cálculo</span><h2>Contribución firmada</h2><p>Solo se totalizan conceptos marcados para el TXT. Un concepto con operación <strong>Suma</strong> conserva su importe; uno con <strong>Resta</strong> multiplica el importe por −1.</p><div class="documentation-example"><strong>REINTEGRO DE ISR PAGADO EN EXCESO</strong><span>Importe original $500.00 × −1 = contribución −$500.00</span></div><p>Los conceptos del mismo grupo generan un subtotal, como <strong>Total ISR</strong>. El total general es la suma firmada de todos los lotes activos.</p></section>
      <section id="retenidos"><span class="eyebrow">Exclusiones</span><h2>Empleados retenidos</h2><p>Los retenidos se capturan por TXT. Se excluyen todos sus movimientos correspondientes a los conceptos seleccionados en ese archivo. Los no encontrados requieren confirmación y quedan en auditoría.</p></section>
      <section id="duplicados"><span class="eyebrow">Trazabilidad</span><h2>Duplicados y versiones</h2><p>El hash SHA-256 identifica el contenido. No puede repetirse dentro del mismo expediente. Un archivo histórico solo puede reprocesarse como nueva versión; la anterior se supera después de que la nueva concilia correctamente.</p></section>
      <section id="reportes"><span class="eyebrow">Evidencia</span><h2>Procesamiento y reportes</h2><p>En la carpeta <strong>año / mes / grupo</strong>, cada archivo genera su <strong>TXT Completo</strong> y el expediente mantiene un único Excel de <strong>Totales mensuales</strong>. Este último contiene Resumen mensual, Por nómina, Desglose agrupado y Retenidos. La conciliación se valida internamente antes de guardar el reporte.</p></section>
      <section id="conceptos"><span class="eyebrow">Catálogo central</span><h2>Consulta y vigencia</h2><p>Los conceptos, grupos, alias y tipos de nómina se administran en Laravel. Antes de la primera carga se requiere iniciar sesión y descargar un catálogo verificado. Sin conexión puedes procesar mientras la sesión guardada y el catálogo lo permitan; al vencer, debes sincronizar.</p><p>Los registros locales sin enlace central se conservan para el historial y no pueden utilizarse en nuevas cargas. Cada lote nuevo conserva la revisión y las reglas utilizadas para su cálculo.</p><RouterLink to="/catalogo-conceptos">Consultar catálogo y diagnóstico de vinculación</RouterLink></section>
    </div>
  </div>
</template>
