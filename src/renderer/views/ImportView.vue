<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { PayrollType, BatchStatus } from '@shared/enums/payroll';
import type { PreflightResult, ProcessPayrollRequest, ProcessingProgress as Progress, ProcessResult, SelectedFile } from '@shared/types/payroll';
import PageHeader from '../components/PageHeader.vue';
import StepSection from '../components/StepSection.vue';
import ParsedPreviewTable from '../components/ParsedPreviewTable.vue';
import ProcessingProgress from '../components/ProcessingProgress.vue';
import MoneyValue from '../components/MoneyValue.vue';
import StatusBadge from '../components/StatusBadge.vue';

const currentYear = new Date().getFullYear();
const file = ref<SelectedFile | null>(null);
const preflight = ref<PreflightResult | null>(null);
const inspecting = ref(false);
const error = ref('');
const year = ref(currentYear);
const fortnight = ref(1);
const payrollType = ref<PayrollType>(PayrollType.SUELDOS);
const exclusions = ref({ retained: true, cancelled: true, other: true, includeAudit: true });
const exportDirectory = ref<{ token: string; name: string } | null>(null);
const progress = ref<Progress | null>(null);
const processId = ref('');
const result = ref<ProcessResult | null>(null);
const processing = computed(() => Boolean(processId.value && !result.value));
const canProcess = computed(() => Boolean(file.value && preflight.value?.canProcess && !processing.value));
const payrollTypes = Object.values(PayrollType);

const stopProgress = window.sefiplanApi.subscribeToProgress((value) => {
  if (value.processId === processId.value) progress.value = value;
});
const stopCompletion = window.sefiplanApi.subscribeToCompletion((value) => {
  if (value.processId !== processId.value) return;
  result.value = value;
  if (value.status === BatchStatus.FAILED) error.value = value.errorMessage ?? 'No se pudo completar el procesamiento.';
});
onBeforeUnmount(() => { stopProgress(); stopCompletion(); });

async function selectFile(): Promise<void> {
  error.value = '';
  result.value = null;
  const selected = await window.sefiplanApi.selectTxtFile();
  if (!selected) return;
  file.value = selected;
  preflight.value = null;
  inspecting.value = true;
  try { preflight.value = await window.sefiplanApi.inspectTxtFile({ fileToken: selected.token }); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'No se pudo inspeccionar el archivo.'; }
  finally { inspecting.value = false; }
}

async function chooseExportDirectory(): Promise<void> {
  exportDirectory.value = await window.sefiplanApi.selectExportDirectory();
}

async function start(duplicateAction?: ProcessPayrollRequest['duplicateAction']): Promise<void> {
  if (!file.value || !canProcess.value) return;
  error.value = '';
  result.value = null;
  progress.value = null;
  const request: ProcessPayrollRequest = {
    fileToken: file.value.token, year: year.value, fortnight: fortnight.value, payrollType: payrollType.value,
    conceptFamily: 'ISR', exclusions: exclusions.value,
    ...(exportDirectory.value ? { exportDirectoryToken: exportDirectory.value.token } : {}),
    ...(duplicateAction ? { duplicateAction } : {}),
  };
  const started = await window.sefiplanApi.processPayrollFile(request);
  processId.value = started.processId;
}

async function cancel(): Promise<void> { if (processId.value) await window.sefiplanApi.cancelProcessing(processId.value); }
async function openReportFolder(): Promise<void> { if (result.value) await window.sefiplanApi.openReportFolder(result.value.batchId); }
</script>

<template>
  <PageHeader title="Nueva importación" description="Procesa un archivo oficial de nómina y genera los reportes de ISR para conciliación." />

  <div v-if="error" class="alert alert-danger d-flex gap-3" role="alert" tabindex="-1">
    <i class="bi bi-exclamation-octagon" aria-hidden="true" /><div><strong>No se pudo completar la operación</strong><p class="mb-0">{{ error }}</p>
      <div v-if="error.includes('ya fue procesado') || error.includes('periodo seleccionado')" class="mt-3 d-flex gap-2 flex-wrap">
        <button class="btn btn-outline-danger btn-sm" type="button" @click="start('REPLACE')">Reemplazar lote anterior</button>
        <button class="btn btn-outline-secondary btn-sm" type="button" @click="start('NEW_VERSION')">Crear nueva versión</button>
      </div>
    </div>
  </div>

  <div class="steps-stack">
    <StepSection :number="1" title="Selecciona el archivo" description="Usa el TXT oficial delimitado por |. El archivo no se modifica.">
      <div class="file-selector" :class="{ 'has-file': file }">
        <i class="bi" :class="file ? 'bi-file-earmark-check' : 'bi-file-earmark-text'" aria-hidden="true" />
        <div class="flex-grow-1"><strong>{{ file?.name ?? 'Ningún archivo seleccionado' }}</strong>
          <p v-if="file" class="mb-0">{{ (file.size / 1024 / 1024).toFixed(2) }} MB · Modificado {{ new Date(file.modifiedAt).toLocaleString('es-MX') }}</p>
          <p v-else class="mb-0">Selecciona un archivo .txt para verificar su estructura antes de procesarlo.</p></div>
        <button class="btn btn-outline-primary" type="button" :disabled="processing" @click="selectFile"><i class="bi bi-folder2-open" aria-hidden="true" /> {{ file ? 'Cambiar archivo' : 'Seleccionar archivo' }}</button>
      </div>
    </StepSection>

    <StepSection :number="2" title="Datos de control" description="Confirma cada dato; el nombre del archivo solo sirve como referencia." :disabled="!file">
      <fieldset :disabled="!file || processing" class="row g-3">
        <div class="col-sm-6 col-xl-3"><label class="form-label" for="year">Año</label><input id="year" v-model.number="year" class="form-control" type="number" min="2000" :max="currentYear + 1" /></div>
        <div class="col-sm-6 col-xl-3"><label class="form-label" for="fortnight">Quincena</label><select id="fortnight" v-model.number="fortnight" class="form-select"><option v-for="n in 24" :key="n" :value="n">Quincena {{ String(n).padStart(2, '0') }}</option></select></div>
        <div class="col-sm-6 col-xl-3"><label class="form-label" for="payrollType">Tipo de nómina</label><select id="payrollType" v-model="payrollType" class="form-select"><option v-for="type in payrollTypes" :key="type" :value="type">{{ type }}</option></select></div>
        <div class="col-sm-6 col-xl-3"><label class="form-label" for="concept">Concepto</label><select id="concept" class="form-select"><option>ISR</option></select></div>
      </fieldset>
    </StepSection>

    <StepSection :number="3" title="Exclusiones" description="Las reglas activas conservan el registro y su motivo, pero lo retiran del total." :disabled="!file">
      <fieldset :disabled="!file || processing" class="option-grid">
        <label class="form-check"><input v-model="exclusions.retained" class="form-check-input" type="checkbox" /><span><strong>Aplicar reglas de retenidos</strong><small>Excluye coincidencias confirmadas como retenidas.</small></span></label>
        <label class="form-check"><input v-model="exclusions.cancelled" class="form-check-input" type="checkbox" /><span><strong>Aplicar reglas de cancelados</strong><small>Excluye pagos o movimientos cancelados.</small></span></label>
        <label class="form-check"><input v-model="exclusions.other" class="form-check-input" type="checkbox" /><span><strong>Otras exclusiones activas</strong><small>Aplica reglas vigentes de otras categorías.</small></span></label>
        <label class="form-check"><input v-model="exclusions.includeAudit" class="form-check-input" type="checkbox" /><span><strong>Incluir evidencia en auditoría</strong><small>Conserva la línea original para revisión local.</small></span></label>
      </fieldset>
    </StepSection>

    <StepSection :number="4" title="Vista previa y compatibilidad" description="Se revisan hasta 20 líneas antes de habilitar el procesamiento." :disabled="!file">
      <div v-if="inspecting" class="inline-loading"><span class="spinner-border spinner-border-sm" aria-hidden="true" /> Inspeccionando la estructura…</div>
      <template v-else-if="preflight">
        <div class="preflight-summary" :class="preflight.canProcess ? 'is-compatible' : 'is-incompatible'">
          <i class="bi" :class="preflight.canProcess ? 'bi-check-circle' : 'bi-x-octagon'" aria-hidden="true" />
          <div><strong>{{ preflight.canProcess ? 'Archivo compatible' : 'Archivo no compatible' }}</strong><p class="mb-0">{{ preflight.validPercentage.toFixed(0) }}% válido en la muestra · {{ preflight.columnCount }} columnas · {{ preflight.layoutCode }} v{{ preflight.layoutVersion }} · {{ preflight.encoding }}</p></div>
        </div>
        <ul v-if="preflight.errors.length" class="error-list"><li v-for="item in preflight.errors" :key="item">{{ item }}</li></ul>
        <ParsedPreviewTable :rows="preflight.preview" />
      </template>
      <p v-else class="text-secondary mb-0">Selecciona un archivo para mostrar la inspección.</p>
    </StepSection>

    <StepSection :number="5" title="Procesar y conciliar" description="Los parámetros se bloquean mientras se lee, clasifica y generan los reportes." :disabled="!preflight?.canProcess">
      <ProcessingProgress v-if="progress && processing" :progress="progress" />
      <div v-if="result && result.status !== BatchStatus.FAILED" class="result-panel">
        <div><span class="eyebrow">Resultado del lote {{ result.batchId }}</span><StatusBadge :status="result.status" /></div>
        <div class="result-total"><span>Total ISR a conciliar</span><MoneyValue :cents="result.totalAmountCents" /></div>
        <dl class="result-metrics"><div><dt>Registros válidos</dt><dd>{{ result.validLines.toLocaleString('es-MX') }}</dd></div><div><dt>Excluidos</dt><dd>{{ result.excludedLines.toLocaleString('es-MX') }}</dd></div><div><dt>Inválidos</dt><dd>{{ result.invalidLines.toLocaleString('es-MX') }}</dd></div></dl>
        <div class="d-flex gap-2 flex-wrap"><button class="btn btn-outline-primary" type="button" @click="openReportFolder"><i class="bi bi-folder2-open" aria-hidden="true" /> Abrir carpeta de reportes</button><RouterLink class="btn btn-outline-secondary" to="/historico">Ver histórico</RouterLink></div>
      </div>
      <div v-else-if="!processing" class="process-ready">
        <div><strong>Listo para procesar ISR</strong><p class="mb-0">{{ `Quincena ${String(fortnight).padStart(2, '0')} · ${year} · ${payrollType}` }}</p></div>
        <div class="d-flex gap-2"><button class="btn btn-outline-secondary" type="button" @click="chooseExportDirectory"><i class="bi bi-folder" aria-hidden="true" /> {{ exportDirectory ? 'Cambiar carpeta' : 'Carpeta de reportes' }}</button><button class="btn btn-primary" type="button" :disabled="!canProcess" @click="start()"><i class="bi bi-play-fill" aria-hidden="true" /> Procesar archivo</button></div>
      </div>
      <button v-if="processing" class="btn btn-outline-danger mt-3" type="button" @click="cancel"><i class="bi bi-stop-circle" aria-hidden="true" /> Cancelar procesamiento</button>
    </StepSection>
  </div>
</template>
