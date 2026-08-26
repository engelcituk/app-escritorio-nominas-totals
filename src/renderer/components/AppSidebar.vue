<script setup lang="ts">
defineProps<{ collapsed: boolean }>();
defineEmits<{ toggle: [] }>();

const entries = [
  ['/', 'bi-house-door', 'Inicio'], ['/importar', 'bi-calendar2-check', 'Expedientes mensuales'],
  ['/historico', 'bi-clock-history', 'Histórico mensual'], ['/consolidado', 'bi-table', 'Consolidado mensual'],
  ['/matriz-anual', 'bi-calendar3', 'Matriz anual'], ['/catalogo-conceptos', 'bi-journal-check', 'Catálogo de conceptos'],
  ['/sincronizacion', 'bi-arrow-repeat', 'Sincronización'],
  ['/documentacion', 'bi-book', 'Documentación'], ['/configuracion', 'bi-gear', 'Configuración'],
  ['/respaldos', 'bi-shield-check', 'Respaldos'],
] as const;
</script>

<template>
  <aside class="app-sidebar" aria-label="Navegación principal">
    <div class="brand-block">
      <span class="brand-mark" aria-hidden="true">S</span>
      <span v-if="!collapsed" class="brand-copy"><strong>SEFIPLAN</strong><small>Nómina</small></span>
    </div>
    <nav class="sidebar-nav">
      <RouterLink v-for="[path, icon, label] in entries" :key="path" :to="path" class="sidebar-link" :title="collapsed ? label : undefined">
        <i class="bi" :class="icon" aria-hidden="true" /><span v-if="!collapsed">{{ label }}</span>
      </RouterLink>
    </nav>
    <button class="sidebar-collapse" type="button" :aria-label="collapsed ? 'Ampliar navegación' : 'Contraer navegación'" @click="$emit('toggle')">
      <i class="bi" :class="collapsed ? 'bi-chevron-right' : 'bi-chevron-left'" aria-hidden="true" />
      <span v-if="!collapsed">Contraer</span>
    </button>
  </aside>
</template>
