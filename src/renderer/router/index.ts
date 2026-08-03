import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import ImportView from '../views/ImportView.vue';

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { title: 'Inicio' } },
    { path: '/importar', name: 'import', component: ImportView, meta: { title: 'Nueva importación' } },
    { path: '/historico', name: 'history', component: () => import('../views/HistoryView.vue'), meta: { title: 'Histórico' } },
    { path: '/consolidado', name: 'consolidated', component: () => import('../views/ConsolidatedView.vue'), meta: { title: 'Consolidado quincenal' } },
    { path: '/matriz-anual', name: 'annual', component: () => import('../views/AnnualMatrixView.vue'), meta: { title: 'Matriz anual' } },
    { path: '/reglas-isr', name: 'concept-rules', component: () => import('../views/RulesView.vue'), meta: { title: 'Reglas de ISR' } },
    { path: '/reglas-exclusion', name: 'exclusion-rules', component: () => import('../views/RulesView.vue'), meta: { title: 'Reglas de exclusión' } },
    { path: '/configuracion', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { title: 'Configuración' } },
    { path: '/respaldos', name: 'backups', component: () => import('../views/BackupsView.vue'), meta: { title: 'Respaldos' } },
  ],
});
