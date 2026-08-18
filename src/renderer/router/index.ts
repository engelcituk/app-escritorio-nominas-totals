import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import ImportView from '../views/ImportView.vue';

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { title: 'Inicio' } },
    { path: '/importar', name: 'import', component: ImportView, meta: { title: 'Nueva importación' } },
    { path: '/historico', name: 'history', component: () => import('../views/HistoryView.vue'), meta: { title: 'Histórico' } },
    { path: '/consolidado', name: 'consolidated', component: () => import('../views/ConsolidatedView.vue'), meta: { title: 'Consolidado' } },
    { path: '/matriz-anual', name: 'annual', component: () => import('../views/AnnualMatrixView.vue'), meta: { title: 'Matriz anual' } },
    { path: '/catalogo-conceptos', name: 'concept-catalog', component: () => import('../views/ConceptCatalogView.vue'), meta: { title: 'Catálogo de conceptos' } },
    { path: '/documentacion', name: 'documentation', component: () => import('../views/DocumentationView.vue'), meta: { title: 'Documentación' } },
    { path: '/configuracion', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { title: 'Configuración' } },
    { path: '/respaldos', name: 'backups', component: () => import('../views/BackupsView.vue'), meta: { title: 'Respaldos' } },
  ],
});
