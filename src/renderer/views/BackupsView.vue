<script setup lang="ts">
import { ref } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import { errorMessage } from '../utils/errorMessage';

const message = ref('');
const error = ref('');
const activeAction = ref<'backup' | 'restore' | null>(null);

async function backup(): Promise<void> {
  error.value = '';
  message.value = '';
  activeAction.value = 'backup';
  try {
    const result = await window.sefiplanApi.createBackup();
    if (result) message.value = `Respaldo creado correctamente en ${result.path}`;
  } catch (cause) {
    error.value = errorMessage(cause, 'No se pudo crear el respaldo.');
  } finally {
    activeAction.value = null;
  }
}

async function restore(): Promise<void> {
  error.value = '';
  message.value = '';
  activeAction.value = 'restore';
  try {
    const result = await window.sefiplanApi.restoreBackup();
    if (result?.restored) message.value = `Información restaurada correctamente. Respaldo previo: ${result.automaticBackupPath}`;
  } catch (cause) {
    error.value = errorMessage(cause, 'No se pudo restaurar el respaldo.');
  } finally {
    activeAction.value = null;
  }
}
</script>

<template>
  <PageHeader title="Respaldos" description="Protege la base local, la configuración y las reglas de la aplicación." />
  <div v-if="error" class="alert alert-danger" role="alert"><strong>No se pudo completar la operación.</strong><div>{{ error }}</div></div>
  <section class="backup-panel">
    <i class="bi bi-shield-check" aria-hidden="true" />
    <div><h2>Crear respaldo completo</h2><p>Genera un archivo ZIP local con una copia consistente de SQLite y un manifiesto de versión.</p>
      <div class="d-flex gap-2 flex-wrap">
        <button class="btn btn-primary" type="button" :disabled="activeAction !== null" @click="backup"><span v-if="activeAction === 'backup'" class="spinner-border spinner-border-sm" aria-hidden="true" /><i v-else class="bi bi-archive" aria-hidden="true" /> {{ activeAction === 'backup' ? 'Creando…' : 'Crear respaldo' }}</button>
        <button class="btn btn-outline-danger" type="button" :disabled="activeAction !== null" @click="restore"><span v-if="activeAction === 'restore'" class="spinner-border spinner-border-sm" aria-hidden="true" /><i v-else class="bi bi-arrow-counterclockwise" aria-hidden="true" /> {{ activeAction === 'restore' ? 'Restaurando…' : 'Restaurar respaldo' }}</button>
      </div>
      <p v-if="message" class="success-message" role="status" aria-live="polite"><i class="bi bi-check-circle" aria-hidden="true" /> {{ message }}</p>
    </div>
  </section>
</template>
