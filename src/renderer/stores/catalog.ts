import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { CatalogStatus } from '@shared/types/catalog';
export const useCatalogStore = defineStore('catalog', () => {
  const status = ref<CatalogStatus | null>(null); const error = ref('');
  let unsubscribe: (() => void) | undefined; let timer: ReturnType<typeof setInterval> | undefined; let sequence = 0;
  const canProcess = computed(() => status.value?.canProcess === true);
  async function refresh(): Promise<void> {
    const request = ++sequence;
    try { const value = await window.sefiplanApi.catalog.status(); if (request === sequence) status.value = value; }
    catch { if (request === sequence) { status.value = null; error.value = 'No se pudo consultar la vigencia del catálogo.'; } }
  }
  async function start(): Promise<void> {
    if (unsubscribe) return;
    unsubscribe = window.sefiplanApi.catalog.onChanged(value => { ++sequence; status.value = value; error.value = ''; });
    timer = setInterval(() => { void refresh(); }, 30_000); await refresh();
  }
  function stop(): void { ++sequence; unsubscribe?.(); unsubscribe = undefined; clearInterval(timer); }
  async function synchronize(): Promise<void> {
    error.value = '';
    try { await window.sefiplanApi.catalog.synchronize(); await refresh(); }
    catch { error.value = 'No se pudo sincronizar el catálogo. Revisa la sesión y vuelve a intentarlo.'; }
  }
  return { status, error, canProcess, start, stop, refresh, synchronize };
});
