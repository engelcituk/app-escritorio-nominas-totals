<script setup lang="ts">
import CatalogStatusPanel from '../components/CatalogStatusPanel.vue';
import CentralSession from '../components/CentralSession.vue';
import { onMounted,ref } from 'vue';import PageHeader from '../components/PageHeader.vue';import { errorMessage } from '../utils/errorMessage';
const directory=ref('');const token=ref('');const saved=ref(false);const loading=ref(true);const choosing=ref(false);const saving=ref(false);const error=ref('');
onMounted(load);async function load():Promise<void>{try{const settings=await window.sefiplanApi.getSettings();directory.value=settings.reports_directory??'';}catch(cause){error.value=errorMessage(cause,'No se pudo cargar la configuración.');}finally{loading.value=false;}}
async function choose():Promise<void>{choosing.value=true;try{const selected=await window.sefiplanApi.selectExportDirectory();if(selected){directory.value=selected.name;token.value=selected.token;saved.value=false;}}catch(cause){error.value=errorMessage(cause,'No se pudo seleccionar la carpeta.');}finally{choosing.value=false;}}
async function saveDirectory():Promise<void>{if(!token.value)return;saving.value=true;try{await window.sefiplanApi.updateSettings({reports_directory_token:token.value});saved.value=true;token.value='';}catch(cause){error.value=errorMessage(cause,'No se pudo guardar la configuración.');}finally{saving.value=false;}}
</script>
<template><PageHeader title="Configuración" description="Consulta la sesión del equipo y configura el trabajo local." /><div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
  <CentralSession />
  <section class="settings-panel"><div><h2>Carpeta de reportes</h2><label class="form-label" for="reports-dir">Carpeta raíz</label><div class="input-group"><input id="reports-dir" :value="directory" class="form-control" readonly placeholder="Documentos\SEFIPLAN_Nomina" /><button class="btn btn-outline-primary" type="button" :disabled="loading||choosing||saving" @click="choose">{{ choosing?'Abriendo…':'Seleccionar' }}</button></div><div class="form-text">Se organizará como 2026\M07\ISR.</div></div><div><button class="btn btn-primary" type="button" :disabled="!token||saving" @click="saveDirectory">Guardar carpeta</button><span v-if="saved" class="text-success ms-3" role="status"><i class="bi bi-check-circle" /> Guardada</span></div></section>
  <CatalogStatusPanel /><RouterLink to="/catalogo-conceptos?entity=types">Consultar tipos de nómina centrales</RouterLink>
</template>
