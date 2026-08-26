<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
</script>
<template>
  <PageHeader title="Inicio" description="Control de importaciones y conciliación de retenciones de nómina.">
    <template #actions><RouterLink class="btn btn-primary" to="/importar"><i class="bi bi-calendar2-check" aria-hidden="true" /> Abrir expediente mensual</RouterLink></template>
  </PageHeader>
  <section class="home-primary">
    <div><span class="eyebrow">Flujo principal</span><h2>Integra el ISR del mes</h2><p>Abre un periodo, agrega las dos quincenas y actualiza un único reporte conforme llegan los distintos tipos de nómina.</p><RouterLink class="btn btn-primary" to="/importar">Abrir expediente <i class="bi bi-arrow-right" aria-hidden="true" /></RouterLink></div>
    <ol class="process-outline"><li><span>1</span><div><strong>Abre el mes</strong><small>Año, mes y grupo de conceptos.</small></div></li><li><span>2</span><div><strong>Agrega o reemplaza TXT</strong><small>Quincena, tipo, conceptos y retenidos.</small></div></li><li><span>3</span><div><strong>Consulta el reporte</strong><small>Totales mensuales conciliados y auditables.</small></div></li></ol>
  </section>
  <div class="home-links">
    <RouterLink to="/historico"><i class="bi bi-clock-history" aria-hidden="true" /><span><strong>Consultar histórico</strong><small>Busca lotes, reportes y versiones anteriores.</small></span><i class="bi bi-chevron-right" aria-hidden="true" /></RouterLink>
    <RouterLink to="/consolidado"><i class="bi bi-table" aria-hidden="true" /><span><strong>Consolidado mensual</strong><small>Revisa el total vigente por mes y grupo.</small></span><i class="bi bi-chevron-right" aria-hidden="true" /></RouterLink>
    <RouterLink to="/catalogo-conceptos"><i class="bi bi-journal-check" aria-hidden="true" /><span><strong>Consultar catálogo</strong><small>Consulta operaciones, grupos y alias reconocidos.</small></span><i class="bi bi-chevron-right" aria-hidden="true" /></RouterLink>
  </div>
</template>
