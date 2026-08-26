import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import ImportView from '../views/ImportView.vue';

export default createRouter({
  history: createWebHashHistory(),
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition;
    if (to.hash) return {
      el: to.hash,
      top: 96,
      behavior: typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    };
    return { top: 0 };
  },
  routes: [
    { path: '/sincronizacion', name: 'sync', component: () => import('../views/SyncView.vue'), meta: { title: 'Sincronización' } },
    { path: '/acceso', name: 'login', component: () => import('../views/LoginView.vue'), meta: { title: 'Acceso institucional' } },
    { path: '/', name: 'home', component: HomeView, meta: { title: 'Inicio' } },
    { path: '/importar', name: 'import', component: ImportView, meta: { title: 'Expedientes mensuales' } },
    { path: '/historico', name: 'history', component: () => import('../views/HistoryView.vue'), meta: { title: 'Histórico' } },
    { path: '/consolidado', name: 'consolidated', component: () => import('../views/ConsolidatedView.vue'), meta: { title: 'Consolidado' } },
    { path: '/matriz-anual', name: 'annual', component: () => import('../views/AnnualMatrixView.vue'), meta: { title: 'Matriz anual' } },
    { path: '/catalogo-conceptos', name: 'concept-catalog', component: () => import('../views/ConceptCatalogView.vue'), meta: { title: 'Catálogo de conceptos' } },
    { path: '/documentacion', name: 'documentation', component: () => import('../views/DocumentationView.vue'), meta: { title: 'Documentación' } },
    { path: '/configuracion', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { title: 'Configuración' } },
    { path: '/respaldos', name: 'backups', component: () => import('../views/BackupsView.vue'), meta: { title: 'Respaldos' } },
  ],
});
