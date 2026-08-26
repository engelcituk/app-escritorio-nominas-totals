<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useRoute } from 'vue-router';
import AppSidebar from './components/AppSidebar.vue';
import { useAuthStore } from './stores/auth';
import { useCatalogStore } from './stores/catalog';

const auth = useAuthStore();
const catalog = useCatalogStore();
onMounted(() => { void auth.start(); void catalog.start(); });
onBeforeUnmount(() => { auth.stop(); catalog.stop(); });

const route = useRoute();
const collapsed = ref(window.matchMedia('(max-width: 767px)').matches);
const pageTitle = computed(() => String(route.meta.title ?? 'SEFIPLAN Nómina'));
</script>

<template>
  <a class="skip-link" href="#main-content">Saltar al contenido principal</a>
  <div class="app-shell" :class="{ 'sidebar-collapsed': collapsed }">
    <AppSidebar :collapsed="collapsed" @toggle="collapsed = !collapsed" />
    <div class="app-workspace">
      <header class="app-topbar">
        <button class="btn btn-icon d-lg-none" type="button" :aria-label="collapsed ? 'Mostrar navegación' : 'Ocultar navegación'" :aria-expanded="!collapsed" @click="collapsed = !collapsed">
          <i class="bi bi-list" aria-hidden="true" />
        </button>
        <div>
          <span class="topbar-context">Conciliación y totales de retenciones</span>
          <strong>{{ pageTitle }}</strong>
        </div>
        <div class="topbar-session">
          <RouterLink :to="auth.hasSession ? '/configuracion' : '/acceso'">{{ auth.label }}</RouterLink>
          <span v-if="auth.status" class="app-version">Versión {{ auth.status.appVersion }}</span>
        </div>
      </header>
      <main id="main-content" class="app-content" tabindex="-1">
        <RouterView />
      </main>
    </div>
  </div>
</template>
