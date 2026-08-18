<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
</script>
<template>
  <PageHeader title="Inicio" description="Control de importaciones y conciliación de retenciones de nómina.">
    <template #actions><RouterLink class="btn btn-primary" to="/importar"><i class="bi bi-file-earmark-arrow-up" aria-hidden="true" /> Nueva importación</RouterLink></template>
  </PageHeader>
  <section class="home-primary">
    <div><span class="eyebrow">Flujo principal</span><h2>Prepara un expediente de nómina</h2><p>Selecciona uno o varios TXT, indica la quincena de cada archivo y marca los conceptos que necesitas totalizar.</p><RouterLink class="btn btn-primary" to="/importar">Comenzar importación <i class="bi bi-arrow-right" aria-hidden="true" /></RouterLink></div>
    <ol class="process-outline"><li><span>1</span><div><strong>Selecciona y confirma</strong><small>Archivo, año, quincena y tipo.</small></div></li><li><span>2</span><div><strong>Revisa la muestra</strong><small>Estructura e importes válidos.</small></div></li><li><span>3</span><div><strong>Concilia el resultado</strong><small>Detalle, totales y auditoría.</small></div></li></ol>
  </section>
  <div class="home-links">
    <RouterLink to="/historico"><i class="bi bi-clock-history" aria-hidden="true" /><span><strong>Consultar histórico</strong><small>Busca lotes, reportes y versiones anteriores.</small></span><i class="bi bi-chevron-right" aria-hidden="true" /></RouterLink>
    <RouterLink to="/consolidado"><i class="bi bi-table" aria-hidden="true" /><span><strong>Consolidado</strong><small>Revisa el avance por quincena y tipo de nómina.</small></span><i class="bi bi-chevron-right" aria-hidden="true" /></RouterLink>
    <RouterLink to="/catalogo-conceptos"><i class="bi bi-journal-check" aria-hidden="true" /><span><strong>Administrar conceptos</strong><small>Consulta operaciones, grupos y alias reconocidos.</small></span><i class="bi bi-chevron-right" aria-hidden="true" /></RouterLink>
  </div>
</template>
