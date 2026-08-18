<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { BatchStatus, PayrollType } from '@shared/enums/payroll';
import type { ConceptGroup, DetectedConcept, PayrollConcept, PreflightResult, ProcessingProgress, ProcessImportGroupRequest,
  ProcessResult, RetainedEmployeeMatch, SelectedFile } from '@shared/types/payroll';
import { canonicalConceptName } from '@shared/utils/normalization';
import ConceptMultiSelect from '../components/ConceptMultiSelect.vue';
import MoneyValue from '../components/MoneyValue.vue';
import PageHeader from '../components/PageHeader.vue';
import ParsedPreviewTable from '../components/ParsedPreviewTable.vue';
import ProcessingProgressView from '../components/ProcessingProgress.vue';
import StatusBadge from '../components/StatusBadge.vue';
import StepSection from '../components/StepSection.vue';
import { errorMessage } from '../utils/errorMessage';
import { serializeImportRequest } from '../utils/serializeImportRequest';

interface FileState {
  file: SelectedFile; preflight: PreflightResult | null; inspecting: boolean; fortnight: number; payrollType: PayrollType;
  selectedConceptIds: number[]; retainedText: string; retainedMatches: RetainedEmployeeMatch[] | null;
  missingAcknowledged: boolean; duplicateDecision?: 'REPROCESS'; duplicateWithinGroup: boolean;
}
interface QuickConcept { fileToken: string; detectedKey: string; name: string; code: string; groupId: number | null; operationFactor: 1 | -1 }

const currentYear = new Date().getFullYear(); const year = ref(currentYear); const files = ref<FileState[]>([]);
const groups = ref<ConceptGroup[]>([]); const concepts = ref<PayrollConcept[]>([]); const catalogLoading = ref(true);
const selecting = ref(false); const starting = ref(false); const choosingDirectory = ref(false); const validatingRetained = ref(false);
const canceling = ref(false); const openingReports = ref(false); const processId = ref(''); const progress = ref<ProcessingProgress | null>(null);
const result = ref<ProcessResult | null>(null); const error = ref(''); const success = ref(''); const statusMessage = ref('');
const exportDirectory = ref<{ token: string; name: string } | null>(null); const errorAlert = ref<HTMLElement | null>(null);
const quickConcept = ref<QuickConcept | null>(null); const savingConcept = ref(false); const payrollTypes = Object.values(PayrollType);
const bulkPayrollType = ref(PayrollType.SUELDOS); const processing = computed(() => starting.value || Boolean(processId.value && !result.value));
const parsedRetained = (file: FileState): string[] => [...new Set(file.retainedText.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean))];
function blockingReasons(file: FileState): string[] { const reasons: string[] = [];
  if (file.inspecting) reasons.push('La inspección todavía no termina.');
  else if (!file.preflight?.canProcess) reasons.push(file.preflight?.errors.join(' ') || 'La estructura del TXT no es compatible.');
  if (!file.selectedConceptIds.length) reasons.push('Selecciona al menos un concepto.');
  if (file.duplicateWithinGroup) reasons.push('Retira el contenido duplicado dentro del expediente.');
  if (file.preflight?.historicalDuplicateBatchId && file.duplicateDecision !== 'REPROCESS') reasons.push('Retira el duplicado histórico o autoriza su reproceso.');
  if (parsedRetained(file).length && !file.retainedMatches) reasons.push('Valida los empleados retenidos capturados.');
  if (file.retainedMatches?.some((match) => !match.found) && !file.missingAcknowledged) reasons.push('Confirma los empleados retenidos no encontrados.');
  return reasons; }
const processBlockers = computed(() => [
  ...((Number.isInteger(year.value) && year.value >= 2000 && year.value <= currentYear + 1) ? [] : [{ filename: 'Expediente', reason: 'Captura un año válido.' }]),
  ...files.value.flatMap((file) => blockingReasons(file).map((reason) => ({ filename: file.file.name, reason }))),
]);
const canProcess = computed(() => files.value.length > 0 && processBlockers.value.length === 0 && !processing.value);

function showError(message: string): void { error.value = message; success.value = ''; void nextTick(() => { errorAlert.value?.focus(); errorAlert.value?.scrollIntoView({ block: 'start' }); }); }
async function loadCatalog(): Promise<void> { const catalog = await window.sefiplanApi.getConceptCatalog(); groups.value = catalog.groups; concepts.value = catalog.concepts; }
onMounted(async () => { try { await loadCatalog(); } catch (cause) { showError(errorMessage(cause, 'No se pudo cargar el catálogo.')); } finally { catalogLoading.value = false; } });

const stopProgress = window.sefiplanApi.subscribeToProgress((value) => { if (processId.value && value.processId !== processId.value) return;
  processId.value ||= value.processId; progress.value = value; statusMessage.value = 'Procesando el expediente…'; });
const stopCompletion = window.sefiplanApi.subscribeToCompletion((value) => { if (processId.value && value.processId !== processId.value) return;
  processId.value ||= value.processId; result.value = value; starting.value = false;
  if (value.status === BatchStatus.FAILED) { showError(value.errorMessage ?? 'No se pudo completar el expediente.'); statusMessage.value = ''; }
  else { statusMessage.value = 'Expediente completado y conciliado.'; success.value = 'Los reportes individuales y el consolidado están disponibles.'; } });
onBeforeUnmount(() => { stopProgress(); stopCompletion(); });

async function selectFiles(): Promise<void> {
  selecting.value = true; error.value = ''; try { const selected = await window.sefiplanApi.selectTxtFiles();
    const start = files.value.length; const states = selected.map((file): FileState => ({ file, preflight: null, inspecting: true,
      fortnight: 1, payrollType: PayrollType.SUELDOS, selectedConceptIds: [], retainedText: '', retainedMatches: null,
      missingAcknowledged: false, duplicateWithinGroup: false })); files.value.push(...states);
    // Actualizar siempre el proxy reactivo; mutar `states` directamente no notifica al Renderer.
    for (let index = 0; index < states.length; index += 1) await inspectFile(files.value[start + index]!, start + index === 0);
    flagCurrentDuplicates();
  } catch (cause) { showError(errorMessage(cause, 'No se pudieron inspeccionar los archivos.')); } finally { selecting.value = false; }
}
async function inspectFile(file: FileState, includePreview: boolean): Promise<void> { file.inspecting = true;
  try { file.preflight = await window.sefiplanApi.inspectTxtFile({ fileToken: file.file.token, includePreview }); }
  finally { file.inspecting = false; } }
function flagCurrentDuplicates(): void { const hashes = new Set<string>(); for (const file of files.value) { const hash = file.preflight?.fileHashSha256;
  file.duplicateWithinGroup = Boolean(hash && hashes.has(hash)); if (hash) hashes.add(hash); } }
async function removeFile(index: number): Promise<void> { const wasFirst = index === 0; files.value.splice(index, 1); flagCurrentDuplicates();
  if (wasFirst && files.value[0] && !files.value[0].preflight?.preview.length) await inspectFile(files.value[0], true); }
function applyPayrollType(): void { files.value.forEach((file) => { file.payrollType = bulkPayrollType.value; file.retainedMatches = null; }); }
function copyFirstSelection(): void { const first = files.value[0]; if (!first) return; for (const file of files.value.slice(1)) { const available = new Set((file.preflight?.detectedConcepts ?? [])
  .flatMap((item) => item.catalogConcept ? [item.catalogConcept.id] : [])); file.selectedConceptIds = first.selectedConceptIds.filter((id) => available.has(id)); resetRetained(file); } }
function resetRetained(file: FileState): void { file.retainedMatches = null; file.missingAcknowledged = false; }
function startQuickCreate(file: FileState, item: DetectedConcept): void { quickConcept.value = { fileToken: file.file.token, detectedKey: item.key,
  name: canonicalConceptName(item.sourceDescription), code: stableCode(item.normalizedDescription), groupId: null, operationFactor: 1 }; }
async function saveQuickConcept(): Promise<void> { const draft = quickConcept.value; if (!draft) return; savingConcept.value = true; error.value = '';
  try { const id = await window.sefiplanApi.savePayrollConcept({ code: draft.code, name: draft.name, groupId: draft.groupId,
    operationFactor: draft.operationFactor, active: true, sourceDescription: draft.name }); await loadCatalog(); const file = files.value.find((item) => item.file.token === draft.fileToken);
    const concept = concepts.value.find((item) => item.id === id); const detected = file?.preflight?.detectedConcepts.find((item) => item.key === draft.detectedKey);
    if (file && concept && detected) { detected.catalogConcept = { id: concept.id, code: concept.code, name: concept.name, groupId: concept.groupId,
      groupName: concept.groupName, operationFactor: concept.operationFactor, active: concept.active }; file.selectedConceptIds.push(id); }
    quickConcept.value = null; success.value = 'Concepto registrado y seleccionado en el archivo actual.';
  } catch (cause) { showError(errorMessage(cause, 'No se pudo registrar el concepto.')); } finally { savingConcept.value = false; } }
function stableCode(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 72); }

async function validateRetained(): Promise<void> { const targets = files.value.filter((file) => parsedRetained(file).length); if (!targets.length) return;
  validatingRetained.value = true; error.value = ''; try { const validation = await window.sefiplanApi.validateRetainedEmployees({ files: targets.map((file) => ({
    fileToken: file.file.token, payrollType: file.payrollType, selectedConceptIds: [...file.selectedConceptIds],
    retainedEmployeeNumbers: parsedRetained(file) })) }); for (const file of targets) { file.retainedMatches = validation.matches.filter((match) => match.fileToken === file.file.token);
      file.missingAcknowledged = false; } } catch (cause) { showError(errorMessage(cause, 'No se pudieron validar los empleados retenidos.')); }
  finally { validatingRetained.value = false; } }
async function chooseExportDirectory(): Promise<void> { choosingDirectory.value = true; try { const selected = await window.sefiplanApi.selectExportDirectory(); if (selected) exportDirectory.value = selected; }
  catch (cause) { showError(errorMessage(cause, 'No se pudo seleccionar la carpeta.')); } finally { choosingDirectory.value = false; } }
async function start(): Promise<void> { if (!canProcess.value) return; starting.value = true; result.value = null; progress.value = null; error.value = ''; success.value = '';
  const request: ProcessImportGroupRequest = { year: year.value, files: files.value.map((file) => ({ fileToken: file.file.token,
    fortnight: file.fortnight, payrollType: file.payrollType, selectedConceptIds: file.selectedConceptIds,
    retainedEmployeeNumbers: parsedRetained(file), missingAcknowledged: file.missingAcknowledged,
    ...(file.duplicateDecision ? { duplicateDecision: file.duplicateDecision } : {}) })),
    ...(exportDirectory.value ? { exportDirectoryToken: exportDirectory.value.token } : {}) };
  try { const started = await window.sefiplanApi.processImportGroup(serializeImportRequest(request)); processId.value = started.processId; statusMessage.value = 'Expediente iniciado…'; }
  catch (cause) { starting.value = false; showError(errorMessage(cause, 'No se pudo iniciar el expediente.')); } }
async function resume(): Promise<void> { if (!result.value?.groupId) return; const groupId = result.value.groupId; result.value = null; error.value = '';
  try { const resumed = await window.sefiplanApi.resumeImportGroup(groupId); processId.value = resumed.processId; statusMessage.value = 'Reanudando expediente…'; }
  catch (cause) { showError(errorMessage(cause, 'No se pudo reanudar el expediente.')); } }
async function cancel(): Promise<void> { if (!processId.value) return; canceling.value = true; try { await window.sefiplanApi.cancelProcessing(processId.value); }
  finally { canceling.value = false; } }
async function openReports(): Promise<void> { if (!result.value?.groupId) return; openingReports.value = true; try { if (!await window.sefiplanApi.openGroupReportFolder(result.value.groupId)) throw new Error('No se encontró la carpeta de reportes.'); }
  catch (cause) { showError(errorMessage(cause, 'No se pudieron abrir los reportes.')); } finally { openingReports.value = false; } }
</script>

<template>
  <PageHeader title="Nueva importación" description="Selecciona uno o varios TXT del mismo año y configura cada archivo de forma independiente." />
  <div v-if="error" ref="errorAlert" class="alert alert-danger" role="alert" tabindex="-1"><strong>No se pudo completar la operación</strong><div>{{ error }}</div>
    <button v-if="result?.groupId" class="btn btn-outline-danger btn-sm mt-2" type="button" @click="resume">Reanudar expediente</button></div>
  <div v-if="success" class="alert alert-success" role="status">{{ success }}</div>
  <div class="process-steps">
    <StepSection :number="1" title="Archivos del expediente" description="Todos pertenecen al mismo año; cada TXT conserva su quincena y tipo de nómina.">
      <fieldset :disabled="processing" class="row g-3 mb-3"><div class="col-md-3"><label class="form-label" for="year">Año</label><input id="year" v-model.number="year" class="form-control" type="number" min="2000" :max="currentYear + 1" /></div>
        <div class="col-md-4 d-flex align-items-end"><button class="btn btn-primary w-100" type="button" :disabled="selecting || catalogLoading" @click="selectFiles"><span v-if="selecting" class="spinner-border spinner-border-sm" /> <i v-else class="bi bi-files" /> {{ files.length ? 'Agregar otros TXT' : 'Seleccionar archivos TXT' }}</button></div>
        <div v-if="files.length > 1" class="col-md-5"><label class="form-label" for="bulk-type">Aplicar tipo a todos</label><div class="input-group"><select id="bulk-type" v-model="bulkPayrollType" class="form-select"><option v-for="type in payrollTypes" :key="type">{{ type }}</option></select><button class="btn btn-outline-secondary" type="button" @click="applyPayrollType">Aplicar</button></div></div></fieldset>
      <div v-if="!files.length" class="empty-inline">Selecciona al menos un archivo. Puedes agregar más después.</div>
      <div v-else class="file-queue"><article v-for="(item,index) in files" :key="item.file.token" class="file-queue__item">
        <div class="file-queue__name"><i class="bi bi-file-earmark-text" /><div><strong>{{ item.file.name }}</strong><small>{{ (item.file.size / 1024 / 1024).toFixed(2) }} MB</small></div></div>
        <label :for="`q-${index}`">Quincena<select :id="`q-${index}`" v-model.number="item.fortnight" class="form-select form-select-sm"><option v-for="q in 24" :key="q" :value="q">Q{{ String(q).padStart(2,'0') }}</option></select></label>
        <label :for="`type-${index}`">Tipo<select :id="`type-${index}`" v-model="item.payrollType" class="form-select form-select-sm" @change="resetRetained(item)"><option v-for="type in payrollTypes" :key="type">{{ type }}</option></select></label>
        <StatusBadge :status="item.inspecting ? 'PROCESSING' : item.preflight?.canProcess ? 'VALID' : 'INVALID'" />
        <button class="btn btn-icon" type="button" :aria-label="`Retirar ${item.file.name}`" @click="removeFile(index)"><i class="bi bi-x-lg" /></button>
        <div v-if="item.duplicateWithinGroup" class="alert alert-danger file-queue__preview" role="alert">Este contenido ya fue agregado. Conserva únicamente la primera aparición.</div>
        <div v-else-if="item.preflight?.historicalDuplicateBatchId" class="alert alert-warning file-queue__preview"><strong>Procesado anteriormente en el lote {{ item.preflight.historicalDuplicateBatchId }}</strong>
          <label class="form-check mt-2"><input v-model="item.duplicateDecision" class="form-check-input" type="checkbox" true-value="REPROCESS" :false-value="undefined" /><span>Reprocesar como nueva versión</span></label></div>
        <details v-if="item.preflight && index === 0" class="file-queue__preview" open><summary>Preview del primer TXT</summary><div v-if="item.preflight.errors.length" class="alert alert-danger mt-2">{{ item.preflight.errors.join(' ') }}</div><ParsedPreviewTable :rows="item.preflight.preview" /></details>
        <div v-else-if="item.preflight" class="file-queue__preview compact-file-summary"><span>{{ item.preflight.totalLines.toLocaleString('es-MX') }} líneas</span><span>{{ item.preflight.detectedConcepts.length }} conceptos detectados</span><span>{{ item.preflight.validPercentage }}% compatible</span></div>
      </article></div>
    </StepSection>

    <StepSection :number="2" title="Conceptos por archivo" description="Marca únicamente los conceptos que deben contribuir a la totalización." :disabled="!files.length">
      <div class="d-flex justify-content-end mb-3"><button v-if="files.length > 1" class="btn btn-outline-secondary btn-sm" type="button" :disabled="!files[0]?.selectedConceptIds.length" @click="copyFirstSelection"><i class="bi bi-copy" /> Copiar selección del primer TXT</button></div>
      <details v-for="item in files" :key="`concept-${item.file.token}`" class="concept-file" open><summary><strong>{{ item.file.name }}</strong><span>{{ item.inspecting ? 'Analizando…' : `${item.selectedConceptIds.length} seleccionados` }}</span></summary>
        <ConceptMultiSelect v-model="item.selectedConceptIds" :options="item.preflight?.detectedConcepts ?? []" :filename="item.file.name" :loading="item.inspecting" :disabled="Boolean(item.preflight && !item.preflight.canProcess)" @change="resetRetained(item)" @create="startQuickCreate(item, $event)" />
        <div v-if="!item.inspecting && !item.selectedConceptIds.length" class="field-error" role="alert">Selecciona al menos un concepto de este archivo.</div>
      </details>
      <form v-if="quickConcept" class="quick-concept-form" @submit.prevent="saveQuickConcept"><div><h3>Dar de alta concepto</h3><p>Se creará un alias exacto con la descripción encontrada en el TXT.</p></div>
        <label>Nombre<input v-model.trim="quickConcept.name" class="form-control" required /></label><label>Código estable<input v-model.trim="quickConcept.code" class="form-control" pattern="[A-Z0-9_]+" required /></label>
        <label>Grupo<select v-model="quickConcept.groupId" class="form-select"><option :value="null">Sin grupo</option><option v-for="group in groups.filter(g => g.active)" :key="group.id" :value="group.id">{{ group.name }}</option></select></label>
        <label>Operación<select v-model.number="quickConcept.operationFactor" class="form-select"><option :value="1">Suma</option><option :value="-1">Resta</option></select></label>
        <div class="d-flex gap-2 align-items-end"><button class="btn btn-primary" type="submit" :disabled="savingConcept">Guardar y seleccionar</button><button class="btn btn-outline-secondary" type="button" @click="quickConcept=null">Cancelar</button></div></form>
    </StepSection>

    <StepSection :number="3" title="Empleados retenidos" description="La lista es opcional e independiente para cada TXT." :disabled="!files.length">
      <div class="retained-files"><details v-for="item in files" :key="`retained-${item.file.token}`"><summary><strong>{{ item.file.name }}</strong><span>{{ parsedRetained(item).length }} empleados</span></summary>
        <label class="form-label" :for="`retained-text-${item.file.token}`">Números de empleado</label><textarea :id="`retained-text-${item.file.token}`" v-model="item.retainedText" class="form-control" rows="3" placeholder="Uno por línea o separados por coma" @input="resetRetained(item)" />
        <div v-if="item.retainedMatches" class="validation-results mt-2"><ul><li v-for="match in item.retainedMatches" :key="match.employeeNumber"><span>{{ match.employeeNumber }} · {{ match.employeeName || 'Sin nombre' }}</span><span>{{ match.found ? `${match.matchingRecords} movimientos seleccionados` : 'No encontrado' }}</span></li></ul>
          <label v-if="item.retainedMatches.some(match => !match.found)" class="form-check"><input v-model="item.missingAcknowledged" class="form-check-input" type="checkbox" /><span>Confirmo continuar con empleados no encontrados</span></label></div>
      </details></div><button v-if="files.some(file => parsedRetained(file).length)" class="btn btn-outline-primary mt-3" type="button" :disabled="validatingRetained || files.some(file => !file.selectedConceptIds.length)" @click="validateRetained"><span v-if="validatingRetained" class="spinner-border spinner-border-sm" /> Validar retenidos</button>
    </StepSection>

    <StepSection :number="4" title="Revisar y procesar" description="Los TXT se procesarán en orden y el consolidado se generará al final." :disabled="!files.length">
      <ProcessingProgressView v-if="progress && processing" :progress="progress" />
      <div v-else class="review-files"><article v-for="item in files" :key="`review-${item.file.token}`"><strong>{{ item.file.name }}</strong><span>Q{{ item.fortnight }} · {{ item.payrollType }}</span><span>{{ item.selectedConceptIds.length }} conceptos · {{ parsedRetained(item).length }} retenidos</span></article></div>
      <div v-if="processBlockers.length && !processing" class="alert alert-warning process-blockers" role="status"><strong>Falta completar lo siguiente:</strong><ul><li v-for="(blocker,index) in processBlockers" :key="`${blocker.filename}-${index}`"><span>{{ blocker.filename }}:</span> {{ blocker.reason }}</li></ul></div>
      <div v-else-if="files.length && !processing && !result" class="alert alert-success process-ready-message" role="status"><i class="bi bi-check-circle" aria-hidden="true" /> La importación está lista para procesarse.</div>
      <div v-if="result && result.status !== BatchStatus.FAILED" class="result-panel"><div><span class="eyebrow">Expediente {{ result.groupId }}</span><StatusBadge :status="result.status" /></div><div class="result-total"><span>Total general</span><MoneyValue :cents="result.totalAmountCents" /></div><button class="btn btn-outline-primary" type="button" :disabled="openingReports" @click="openReports"><i class="bi bi-folder2-open" /> Abrir reportes</button></div>
      <div v-else-if="!processing" class="process-ready"><div><strong>{{ files.length }} TXT en el expediente</strong><p class="mb-0">Ejercicio {{ year }}</p></div><div class="d-flex gap-2 flex-wrap"><button class="btn btn-outline-secondary" type="button" :disabled="choosingDirectory" @click="chooseExportDirectory"><i class="bi bi-folder" /> {{ exportDirectory ? 'Cambiar carpeta' : 'Carpeta de reportes' }}</button><button class="btn btn-primary" type="button" :disabled="!canProcess" @click="start"><i class="bi bi-play-fill" /> Procesar expediente</button></div></div>
      <button v-if="processing" class="btn btn-outline-danger mt-3" type="button" :disabled="canceling" @click="cancel">Cancelar expediente</button><p v-if="statusMessage" class="operation-status mt-3" role="status">{{ statusMessage }}</p>
    </StepSection>
  </div>
</template>
