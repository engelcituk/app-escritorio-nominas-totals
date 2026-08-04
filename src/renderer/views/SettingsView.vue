<script setup lang="ts">
import { onMounted, ref } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import { errorMessage } from '../utils/errorMessage';

const directory = ref('');
const token = ref('');
const saved = ref(false);
const loading = ref(true);
const choosing = ref(false);
const saving = ref(false);
const error = ref('');

onMounted(async () => {
  try {
    directory.value = (await window.sefiplanApi.getSettings()).reports_directory ?? '';
  } catch (cause) {
    error.value = errorMessage(cause, 'No se pudo cargar la configuración.');
  } finally {
    loading.value = false;
  }
});

async function choose(): Promise<void> {
  error.value = '';
  choosing.value = true;
  try {
    const selected = await window.sefiplanApi.selectExportDirectory();
    if (selected) {
      directory.value = selected.name;
      token.value = selected.token;
      saved.value = false;
    }
  } catch (cause) {
    error.value = errorMessage(cause, 'No se pudo seleccionar la carpeta.');
  } finally {
    choosing.value = false;
  }
}

async function save(): Promise<void> {
  if (!token.value || saving.value) return;
  error.value = '';
  saving.value = true;
  try {
    await window.sefiplanApi.updateSettings({ reports_directory_token: token.value });
    saved.value = true;
    token.value = '';
  } catch (cause) {
    error.value = errorMessage(cause, 'No se pudo guardar la configuración.');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <PageHeader title="Configuración" description="Define preferencias locales de reportes y periodos." />
  <div v-if="error" class="alert alert-danger" role="alert"><strong>No se pudo completar la operación.</strong><div>{{ error }}</div></div>
  <form class="settings-panel" @submit.prevent="save">
    <div><label class="form-label" for="reports-dir">Carpeta predeterminada de reportes</label><div class="input-group"><input id="reports-dir" :value="directory" class="form-control" type="text" readonly placeholder="Documentos\SEFIPLAN Nomina" /><button class="btn btn-outline-primary" type="button" :disabled="loading || choosing || saving" @click="choose"><span v-if="choosing" class="spinner-border spinner-border-sm" aria-hidden="true" />{{ choosing ? 'Abriendo…' : 'Seleccionar' }}</button></div><div class="form-text">La carpeta se selecciona mediante el diálogo seguro de Windows.</div></div>
    <div class="d-flex align-items-center gap-3 flex-wrap"><button class="btn btn-primary" type="submit" :disabled="!token || saving"><span v-if="saving" class="spinner-border spinner-border-sm" aria-hidden="true" />{{ saving ? 'Guardando…' : 'Guardar configuración' }}</button><span v-if="saved" class="text-success" role="status"><i class="bi bi-check-circle" aria-hidden="true" /> Configuración guardada</span></div>
  </form>
</template>
