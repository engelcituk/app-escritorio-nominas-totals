<script setup lang="ts">
import { computed, ref } from 'vue';
import { useCatalogStore } from '../stores/catalog';
const catalog = useCatalogStore(); const openError = ref('');
const errors: Record<string, string> = {
  HTTP_ERROR: 'El servidor no pudo entregar el catálogo.', NETWORK_ERROR: 'No se pudo contactar al servidor.',
  CHECKSUM_MISMATCH: 'La descarga no superó la verificación de integridad.', MAPPING_CONFLICT: 'Hay identidades locales ambiguas; consulta los conflictos.',
  FORBIDDEN: 'El dispositivo no tiene permiso para consultar catálogos.', TLS_ERROR: 'No se pudo verificar el certificado del servidor.',
  RATE_LIMITED: 'El servidor pidió esperar antes de volver a intentar.', NORMALIZATION_MISMATCH: 'La normalización de alias del servidor no coincide con la aplicación.',
  PROCESS_ACTIVE: 'Espera a que termine el procesamiento antes de sincronizar.',
};
const detail = computed(() => { const code = catalog.status?.errorCode; return code ? errors[code] ?? `No se pudo completar la sincronización (${code}).` : ''; });
function date(value: string | null): string { return value ? new Date(value).toLocaleString('es-MX') : 'Pendiente'; }
async function openCentral(): Promise<void> { try { await window.sefiplanApi.openBackoffice(); } catch { openError.value = 'No se pudo abrir la administración central.'; } }
</script>
<template>
  <section class="border rounded p-3 mb-4" aria-label="Estado del catálogo central" :aria-busy="catalog.status?.busy">
    <div class="d-flex justify-content-between gap-3 flex-wrap">
      <div><h2 class="h6 mb-1">Catálogo central · Solo consulta</h2><p class="mb-1" role="status">{{ catalog.status?.message ?? 'Consultando catálogo…' }}</p></div>
      <div class="d-flex gap-2 align-items-start flex-wrap">
        <button class="btn btn-outline-primary btn-sm" type="button" :disabled="!catalog.status?.canSynchronize" @click="catalog.synchronize">{{ catalog.status?.busy ? 'Sincronizando…' : 'Sincronizar catálogo' }}</button>
        <button class="btn btn-outline-secondary btn-sm" type="button" @click="openCentral">Administración central <i class="bi bi-box-arrow-up-right" aria-hidden="true" /></button>
      </div>
    </div>
    <p v-if="catalog.status?.revision !== null && catalog.status?.revision !== undefined" class="small mb-1">Revisión {{ catalog.status.revision }} · Verificado: {{ date(catalog.status.syncedAt) }} · Válido hasta: {{ date(catalog.status.validUntil) }}</p>
    <p v-if="detail || catalog.error || openError" class="text-danger mb-1" role="alert">{{ catalog.error || openError || detail }}</p>
    <p v-if="catalog.status?.legacyCount" class="small mb-1">{{ catalog.status.legacyCount }} registros locales sin enlace central: se conservan para el historial y no se utilizan en cargas nuevas.</p>
    <RouterLink v-if="catalog.status?.state === 'AUTH_REQUIRED'" to="/acceso">Iniciar o verificar sesión</RouterLink>
    <p class="small text-body-secondary mb-0">El catálogo se consulta desde Laravel. Los resultados y Excel se conservan localmente; revisa su entrega en Sincronización.</p>
  </section>
</template>
