<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { PayrollType, BatchStatus } from '@shared/enums/payroll';
import type { PreflightResult, ProcessPayrollRequest, ProcessingProgress as Progress, ProcessResult, SelectedFile } from '@shared/types/payroll';
import PageHeader from '../components/PageHeader.vue';
import StepSection from '../components/StepSection.vue';
import ParsedPreviewTable from '../components/ParsedPreviewTable.vue';
import ProcessingProgress from '../components/ProcessingProgress.vue';
import MoneyValue from '../components/MoneyValue.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { errorMessage } from '../utils/errorMessage';
import { serializeExclusions } from '../utils/serializeExclusions';

const currentYear = new Date().getFullYear();
const file = ref<SelectedFile | null>(null);
const preflight = ref<PreflightResult | null>(null);
const inspecting = ref(false);
const starting = ref(false);
const choosingDirectory = ref(false);
const canceling = ref(false);
const openingReports = ref(false);
const error = ref('');
const errorAlert = ref<HTMLElement | null>(null);
const statusMessage = ref('');
const year = ref(currentYear);
const fortnight = ref(1);
const payrollType = ref<PayrollType>(PayrollType.SUELDOS);
const exclusions = ref({ retained: true, cancelled: true, other: true, includeAudit: true });
const exportDirectory = ref<{ token: string; name: string } | null>(null);
const progress = ref<Progress | null>(null);
const processId = ref('');
const result = ref<ProcessResult | null>(null);
const processing = computed(() => starting.value || Boolean(processId.value && !result.value));
const canProcess = computed(() => Boolean(file.value && preflight.value?.canProcess && !processing.value));
const payrollTypes = Object.values(PayrollType);

function showError(message: string): void {
  error.value = message;
  void nextTick(() => {
    errorAlert.value?.focus();
    errorAlert.value?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });
}

const stopProgress = window.sefiplanApi.subscribeToProgress((value) => {
  if (processId.value && value.processId !== processId.value) return;
  if (!processId.value && !starting.value) return;
  processId.value ||= value.processId;
  progress.value = value;
  statusMessage.value = 'Procesando el archivo de nómina…';
});
const stopCompletion = window.sefiplanApi.subscribeToCompletion((value) => {
  if (processId.value && value.processId !== processId.value) return;
  if (!processId.value && !starting.value) return;
  processId.value ||= value.processId;
  result.value = value;
  starting.value = false;
  if (value.status === BatchStatus.FAILED) {
    showError(value.errorMessage ?? 'No se pudo completar el procesamiento.');
    statusMessage.value = '';
  } else if (value.status === BatchStatus.CANCELLED) {
    statusMessage.value = 'El procesamiento fue cancelado.';
  } else {
    statusMessage.value = 'Procesamiento completado. Los reportes están listos.';
  }
});
onBeforeUnmount(() => { stopProgress(); stopCompletion(); });

async function selectFile(): Promise<void> {
  error.value = '';
  statusMessage.value = '';
  try {
    const selected = await window.sefiplanApi.selectTxtFile();
    if (!selected) return;
    file.value = selected;
    preflight.value = null;
    processId.value = '';
    progress.value = null;
    result.value = null;
    inspecting.value = true;
    preflight.value = await window.sefiplanApi.inspectTxtFile({ fileToken: selected.token });
  } catch (cause) {
    showError(errorMessage(cause, 'No se pudo seleccionar o revisar el archivo.'));
  } finally {
    inspecting.value = false;
  }
}

async function chooseExportDirectory(): Promise<void> {
  error.value = '';
  choosingDirectory.value = true;
  try {
    const selected = await window.sefiplanApi.selectExportDirectory();
    if (selected) {
      exportDirectory.value = selected;
      statusMessage.value = `Se usará ${selected.name} como carpeta raíz; los reportes se organizarán por año y quincena.`;
    }
  } catch (cause) {
    showError(errorMessage(cause, 'No se pudo seleccionar la carpeta de reportes.'));
  } finally {
    choosingDirectory.value = false;
  }
}

async function start(duplicateAction?: ProcessPayrollRequest['duplicateAction']): Promise<void> {
  if (!file.value || !preflight.value?.canProcess || processing.value) {
    showError('El archivo todavía no está listo para procesarse. Revisa los pasos anteriores.');
    return;
  }
  error.value = '';
  statusMessage.value = 'Iniciando el procesamiento…';
  starting.value = true;
  processId.value = '';
  result.value = null;
  progress.value = null;
  const request: ProcessPayrollRequest = {
    fileToken: file.value.token, year: year.value, fortnight: fortnight.value, payrollType: payrollType.value,
    conceptFamily: 'ISR', exclusions: serializeExclusions(exclusions.value),
    ...(exportDirectory.value ? { exportDirectoryToken: exportDirectory.value.token } : {}),
    ...(duplicateAction ? { duplicateAction } : {}),
  };
  try {
    const started = await window.sefiplanApi.processPayrollFile(request);
    processId.value ||= started.processId;
    if (!result.value) statusMessage.value = 'Procesamiento iniciado. Preparando la lectura del archivo…';
  } catch (cause) {
    processId.value = '';
    statusMessage.value = '';
    showError(errorMessage(cause, 'No se pudo iniciar el procesamiento.'));
  } finally {
    starting.value = false;
  }
}

async function cancel(): Promise<void> {
  if (!processId.value || canceling.value) return;
  error.value = '';
  canceling.value = true;
  try {
    const requested = await window.sefiplanApi.cancelProcessing(processId.value);
    if (!requested) throw new Error('El proceso ya había terminado o no se encontró activo.');
    statusMessage.value = 'Cancelación solicitada. Espera a que termine la operación actual…';
  } catch (cause) {
    showError(errorMessage(cause, 'No se pudo cancelar el procesamiento.'));
  } finally {
    canceling.value = false;
  }
}

async function openReportFolder(): Promise<void> {
  if (!result.value || openingReports.value) return;
  error.value = '';
  openingReports.value = true;
  try {
    const opened = await window.sefiplanApi.openReportFolder(result.value.batchId);
    if (!opened) throw new Error('No se encontró la carpeta o los reportes generados para este lote.');
  } catch (cause) {
    showError(errorMessage(cause, 'No se pudo abrir la carpeta de reportes.'));
  } finally {
    openingReports.value = false;
  }
}
</script>

<template>
  <PageHeader title="Nueva importación" description="Procesa un archivo oficial de nómina y genera los reportes de ISR para conciliación." />

  <div v-if="error" ref="errorAlert" class="alert alert-danger d-flex gap-3" role="alert" tabindex="-1">
    <i class="bi bi-exclamation-octagon" aria-hidden="true" /><div><strong>No se pudo completar la operación</strong><p class="mb-0">{{ error }}</p>
      <div v-if="error.includes('ya fue procesado') || error.includes('periodo seleccionado')" class="mt-3 d-flex gap-2 flex-wrap">
        <button class="btn btn-outline-danger btn-sm" type="button" :disabled="processing" @click="start('REPLACE')">Reemplazar lote anterior</button>
        <button class="btn btn-outline-secondary btn-sm" type="button" :disabled="processing" @click="start('NEW_VERSION')">Crear nueva versión</button>
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
          <div><strong>{{ preflight.canProcess ? 'Archivo listo para procesar' : 'El archivo necesita revisión' }}</strong><p class="mb-0">{{ preflight.canProcess ? `${preflight.sampleSize} registros revisados correctamente.` : `Se encontraron problemas en los ${preflight.sampleSize} registros revisados.` }}</p></div>
        </div>
        <ul v-if="preflight.errors.length" class="error-list"><li v-for="item in preflight.errors" :key="item">{{ item }}</li></ul>
        <div v-if="preflight.warnings.length" class="alert alert-warning" role="status"><strong>Observaciones</strong><ul class="mb-0"><li v-for="item in preflight.warnings" :key="item">{{ item }}</li></ul></div>
        <ParsedPreviewTable :rows="preflight.preview" />
      </template>
      <p v-else class="text-secondary mb-0">Selecciona un archivo para mostrar la inspección.</p>
    </StepSection>

    <StepSection :number="5" title="Procesar y conciliar" description="Los parámetros se bloquean mientras se lee, clasifica y generan los reportes." :disabled="!preflight?.canProcess">
      <ProcessingProgress v-if="progress && processing" :progress="progress" />
      <div v-else-if="processing" class="processing-panel" role="status" aria-live="polite"><div class="inline-loading p-0"><span class="spinner-border spinner-border-sm" aria-hidden="true" /> {{ statusMessage || 'Iniciando el procesamiento…' }}</div></div>
      <div v-if="result && result.status !== BatchStatus.FAILED" class="result-panel">
        <div><span class="eyebrow">Resultado del lote {{ result.batchId }}</span><StatusBadge :status="result.status" /></div>
        <div class="result-total"><span>Total ISR a conciliar</span><MoneyValue :cents="result.totalAmountCents" /></div>
        <dl class="result-metrics"><div><dt>Registros válidos</dt><dd>{{ result.validLines.toLocaleString('es-MX') }}</dd></div><div><dt>Excluidos</dt><dd>{{ result.excludedLines.toLocaleString('es-MX') }}</dd></div><div><dt>Inválidos</dt><dd>{{ result.invalidLines.toLocaleString('es-MX') }}</dd></div></dl>
        <div class="d-flex gap-2 flex-wrap"><button class="btn btn-outline-primary" type="button" :disabled="openingReports" @click="openReportFolder"><span v-if="openingReports" class="spinner-border spinner-border-sm" aria-hidden="true" /><i v-else class="bi bi-folder2-open" aria-hidden="true" /> {{ openingReports ? 'Abriendo…' : 'Abrir carpeta de reportes' }}</button><RouterLink class="btn btn-outline-secondary" to="/historico">Ver histórico</RouterLink></div>
      </div>
      <div v-else-if="!processing" class="process-ready">
        <div><strong>Listo para procesar ISR</strong><p class="mb-0">{{ `Quincena ${String(fortnight).padStart(2, '0')} · ${year} · ${payrollType}` }}</p></div>
        <div class="d-flex gap-2 flex-wrap"><button class="btn btn-outline-secondary" type="button" :disabled="choosingDirectory" @click="chooseExportDirectory"><span v-if="choosingDirectory" class="spinner-border spinner-border-sm" aria-hidden="true" /><i v-else class="bi bi-folder" aria-hidden="true" /> {{ choosingDirectory ? 'Abriendo…' : exportDirectory ? 'Cambiar carpeta' : 'Carpeta de reportes' }}</button><button class="btn btn-primary" type="button" :disabled="!canProcess" @click="start()"><span v-if="starting" class="spinner-border spinner-border-sm" aria-hidden="true" /><i v-else class="bi bi-play-fill" aria-hidden="true" /> {{ starting ? 'Iniciando…' : 'Procesar archivo' }}</button></div>
      </div>
      <button v-if="processing" class="btn btn-outline-danger mt-3" type="button" :disabled="starting || canceling" @click="cancel"><span v-if="canceling" class="spinner-border spinner-border-sm" aria-hidden="true" /><i v-else class="bi bi-stop-circle" aria-hidden="true" /> {{ canceling ? 'Cancelando…' : 'Cancelar procesamiento' }}</button>
      <p v-if="statusMessage && !processing && !error" class="operation-status mb-0 mt-3" role="status" aria-live="polite"><i class="bi bi-info-circle" aria-hidden="true" /> {{ statusMessage }}</p>
    </StepSection>
  </div>
</template>
