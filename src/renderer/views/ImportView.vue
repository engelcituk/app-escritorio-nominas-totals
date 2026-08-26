<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { BatchStatus } from '@shared/enums/payroll';
import type { ConceptGroup, DetectedConcept, MonthlyReconciliationResult, MonthlyReconciliationSummary,
  PayrollTypeSummary, PreflightResult, ProcessingProgress, ProcessMonthlyImportRequest, RetainedEmployeeMatch, SelectedFile } from '@shared/types/payroll';
import { fortnightsForMonth } from '@shared/utils/payrollPeriod';
import { parseEmployeeNumbers } from '@shared/utils/employeeNumbers';
import CatalogStatusPanel from '../components/CatalogStatusPanel.vue';
import { useCatalogStore } from '../stores/catalog';
import ConceptMultiSelect from '../components/ConceptMultiSelect.vue';
import PageHeader from '../components/PageHeader.vue';
import ParsedPreviewTable from '../components/ParsedPreviewTable.vue';
import ProcessingProgressView from '../components/ProcessingProgress.vue';
import StatusBadge from '../components/StatusBadge.vue';
import StepSection from '../components/StepSection.vue';
import { serializeImportRequest } from '../utils/serializeImportRequest';
import { errorMessage } from '../utils/errorMessage';

interface FileState { file:SelectedFile;preflight:PreflightResult|null;inspecting:boolean;fortnight:number;payrollTypeId:number;
  selectedConceptIds:number[];retainedText:string;retainedMatches:RetainedEmployeeMatch[]|null;missingAcknowledged:boolean;
  replaceActiveBatch:boolean;analysisError:string;conceptSelectionTouched:boolean }
const catalog=useCatalogStore();
const now=new Date(); const year=ref(now.getFullYear()); const month=ref(now.getMonth()+1); const conceptGroupId=ref<number|null>(null);
const groups=ref<ConceptGroup[]>([]); const payrollTypes=ref<PayrollTypeSummary[]>([]);
const reconciliation=ref<MonthlyReconciliationSummary|null>(null); const contextLoading=ref(true); const files=ref<FileState[]>([]);
const selecting=ref(false); const starting=ref(false); const validatingRetained=ref(false); const openingReports=ref(false);
const processId=ref(''); const progress=ref<ProcessingProgress|null>(null); const result=ref<MonthlyReconciliationResult|null>(null);
const error=ref(''); const statusMessage=ref(''); const errorAlert=ref<HTMLElement|null>(null);
const bulkPayrollTypeId=ref<number|null>(null);
const allowedFortnights=computed(()=>fortnightsForMonth(month.value)); const activeBatches=computed(()=>reconciliation.value?.batches.filter(b=>b.active)??[]);
const processing=computed(()=>starting.value||Boolean(processId.value&&!result.value));
const parsedRetained=(file:FileState)=>parseEmployeeNumbers(file.retainedText);
const activeFor=(typeId:number,fortnight:number)=>activeBatches.value.find(b=>b.payrollTypeId===typeId&&b.fortnight===fortnight);
const visibleTypes=computed(()=>payrollTypes.value.filter(type=>type.active||activeBatches.value.some(batch=>batch.payrollTypeId===type.id)));
const ANALYSIS_TIMEOUT_MS=45_000;

function conceptOptions(file:FileState):DetectedConcept[]{return (file.preflight?.detectedConcepts??[])
  .filter(item=>!item.catalogConcept||item.catalogConcept.groupId===conceptGroupId.value);}
async function withTimeout<T>(promise:Promise<T>,milliseconds:number):Promise<T>{let timeout:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,
  new Promise<T>((_resolve,reject)=>{timeout=setTimeout(()=>reject(new Error('El análisis excedió 45 segundos. Puedes reintentarlo sin volver a seleccionar el archivo.')),milliseconds);})]);}
finally{if(timeout)clearTimeout(timeout);}}

function blockers(file:FileState):string[]{ const reasons:string[]=[]; if(file.preflight && file.preflight.catalogRevision!==catalog.status?.revision)reasons.push('Cambió el catálogo. Vuelve a analizar el TXT y confirma los conceptos.'); if(file.inspecting)reasons.push('El análisis todavía no termina.');
  else if(!file.preflight?.canProcess)reasons.push(file.preflight?.errors.join(' ')||'La estructura no es compatible.');
  if(file.preflight?.suggestedYear&&file.preflight.suggestedYear!==year.value)reasons.push(`El nombre indica el año ${file.preflight.suggestedYear}.`);
  if(file.preflight?.suggestedFortnight&&file.preflight.suggestedFortnight!==file.fortnight)reasons.push(`El nombre indica la quincena Q${String(file.preflight.suggestedFortnight).padStart(2,'0')}.`);
  const selectedType=payrollTypes.value.find(type=>type.id===file.payrollTypeId); if(file.preflight?.suggestedPayrollTypeCode&&selectedType?.code!==file.preflight.suggestedPayrollTypeCode)
    reasons.push(`El nombre indica el tipo ${file.preflight.suggestedPayrollTypeCode.replaceAll('_',' ')}.`);
  if(!allowedFortnights.value.includes(file.fortnight))reasons.push('La quincena no pertenece al mes.'); if(!selectedType?.active)reasons.push('Selecciona un tipo de nómina central activo.'); if(!groups.value.some(g=>g.id===conceptGroupId.value&&g.active))reasons.push('El grupo ya no está activo. Selecciona otro grupo.');
  if(!file.selectedConceptIds.length)reasons.push('Selecciona al menos un concepto.'); if(activeFor(file.payrollTypeId,file.fortnight)&&!file.replaceActiveBatch)
    reasons.push('Confirma que esta carga reemplazará la versión activa.'); if(parsedRetained(file).length&&!file.retainedMatches)reasons.push('Valida los empleados retenidos.');
  if(file.retainedMatches?.some(m=>!m.found)&&!file.missingAcknowledged)reasons.push('Confirma los empleados no encontrados.'); return reasons; }
const processBlockers=computed(()=>{const result=files.value.flatMap(file=>blockers(file).map(reason=>({ filename:file.file.name,reason })));
  const occupied=new Set<string>();for(const file of files.value){const slot=`${file.fortnight}:${file.payrollTypeId}`;if(occupied.has(slot))result.push({filename:file.file.name,reason:'Ya agregaste otro TXT para la misma quincena y tipo.'});occupied.add(slot);}return result;});
const canProcess=computed(()=>Boolean(catalog.canProcess&&reconciliation.value&&files.value.length&&!processBlockers.value.length&&!processing.value));

async function loadCatalogs():Promise<void>{ const [centralGroups,types]=await Promise.all([window.sefiplanApi.getConceptGroups(),window.sefiplanApi.getPayrollTypes(false)]);
  groups.value=centralGroups; payrollTypes.value=types; if(!files.value.length&&!groups.value.some(g=>g.id===conceptGroupId.value))conceptGroupId.value=null; conceptGroupId.value??=groups.value.find(g=>g.code==='ISR')?.id??groups.value.find(g=>g.active)?.id??null;
  bulkPayrollTypeId.value??=types.find(t=>t.code==='SUELDOS')?.id??types[0]?.id??null; }
async function loadContext():Promise<void>{ if(!conceptGroupId.value){contextLoading.value=false;reconciliation.value=null;return;} contextLoading.value=true; error.value=''; try{ reconciliation.value=await window.sefiplanApi.getOrCreateMonthlyReconciliation({
    year:year.value,month:month.value,conceptGroupId:conceptGroupId.value }); files.value=[]; result.value=null; }
  catch(cause){showError(errorMessage(cause,'No se pudo abrir el expediente mensual.'));}finally{contextLoading.value=false;} }
let contextInitialized=false; let contextSequence=0;
watch([year,month,conceptGroupId],()=>{
  // Initial catalog selection is already followed by loadContext in onMounted.
  // A second delayed load would silently clear files selected just after startup.
  if(!contextInitialized)return;
  contextLoading.value=true;
  const sequence=++contextSequence; setTimeout(()=>{if(sequence===contextSequence)void loadContext();},180);
});

async function selectFiles():Promise<void>{ selecting.value=true; try{ const selected=await window.sefiplanApi.selectTxtFiles(); const baseType=bulkPayrollTypeId.value??payrollTypes.value[0]?.id??0;
    const states=selected.map((file):FileState=>reactive({ file,preflight:null,inspecting:true,fortnight:allowedFortnights.value[0],payrollTypeId:baseType,selectedConceptIds:[],
      retainedText:'',retainedMatches:null,missingAcknowledged:false,replaceActiveBatch:false,analysisError:'',conceptSelectionTouched:false })); files.value.push(...states);
    await Promise.all(states.map((state,index)=>inspectFile(state,files.value.length-states.length+index===0))); }
  catch(cause){showError(errorMessage(cause,'No se pudieron seleccionar los TXT.'));}finally{selecting.value=false;} }
async function inspectFile(state:FileState,includePreview:boolean):Promise<void>{state.inspecting=true;state.analysisError='';try{state.preflight=await withTimeout(
    window.sefiplanApi.inspectTxtFile({ fileToken:state.file.token,includePreview }),ANALYSIS_TIMEOUT_MS);
    if(state.preflight.suggestedFortnight&&allowedFortnights.value.includes(state.preflight.suggestedFortnight))state.fortnight=state.preflight.suggestedFortnight;
    const suggested=payrollTypes.value.find(t=>t.code===state.preflight?.suggestedPayrollTypeCode); if(suggested)state.payrollTypeId=suggested.id;
    if(!state.conceptSelectionTouched)state.selectedConceptIds=[...new Set(state.preflight.detectedConcepts.filter(c=>c.catalogConcept?.groupId===conceptGroupId.value).map(c=>c.catalogConcept!.id))];
  }catch(cause){state.analysisError=errorMessage(cause,`No se pudo analizar ${state.file.name}.`);showError(state.analysisError);}finally{state.inspecting=false;} }
function retryInspection(state:FileState):void{state.preflight=null;state.selectedConceptIds=[];state.conceptSelectionTouched=false;resetRetained(state);void inspectFile(state,files.value.indexOf(state)===0);}
function removeFile(index:number):void{files.value.splice(index,1);} function applyPayrollType():void{if(!bulkPayrollTypeId.value)return;files.value.forEach(f=>{f.payrollTypeId=bulkPayrollTypeId.value!;f.retainedMatches=null;});}
function resetRetained(file:FileState):void{file.retainedMatches=null;file.missingAcknowledged=false;}
function handleConceptChange(file:FileState):void{file.conceptSelectionTouched=true;resetRetained(file);}
async function validateRetained():Promise<void>{const targets=files.value.filter(f=>parsedRetained(f).length);if(!targets.length)return;validatingRetained.value=true;try{const response=await window.sefiplanApi.validateRetainedEmployees({
    files:targets.map(f=>({ fileToken:f.file.token,payrollTypeId:f.payrollTypeId,selectedConceptIds:[...f.selectedConceptIds],retainedEmployeeNumbers:parsedRetained(f) })) });
    targets.forEach(f=>{f.retainedMatches=response.matches.filter(m=>m.fileToken===f.file.token);});}catch(cause){showError(errorMessage(cause,'No se pudieron validar los retenidos.'));}finally{validatingRetained.value=false;} }
async function start():Promise<void>{if(!canProcess.value||!reconciliation.value||!conceptGroupId.value)return;starting.value=true;result.value=null;progress.value=null;error.value='';
  const request:ProcessMonthlyImportRequest={ catalogRevision:catalog.status!.revision!,reconciliationId:reconciliation.value.id,year:year.value,month:month.value,conceptGroupId:conceptGroupId.value,
    files:files.value.map(f=>({ fileToken:f.file.token,fortnight:f.fortnight,payrollTypeId:f.payrollTypeId,selectedConceptIds:[...f.selectedConceptIds],
      retainedEmployeeNumbers:parsedRetained(f),missingAcknowledged:f.missingAcknowledged,replaceActiveBatch:f.replaceActiveBatch })) };
  try{const started=await window.sefiplanApi.processMonthlyImport(serializeImportRequest(request));processId.value=started.processId;statusMessage.value='Actualizando expediente mensual…';}
  catch(cause){starting.value=false;showError(errorMessage(cause,'No se pudo iniciar el procesamiento.'));}}
async function cancel():Promise<void>{if(processId.value)await window.sefiplanApi.cancelProcessing(processId.value);} async function openReports():Promise<void>{if(!reconciliation.value)return;openingReports.value=true;
  try{if(!await window.sefiplanApi.openMonthlyReportFolder(reconciliation.value.id))throw new Error('El reporte mensual todavía no está disponible.');}catch(cause){showError(errorMessage(cause,'No se pudo abrir el reporte.'));}finally{openingReports.value=false;}}
function showError(message:string):void{error.value=message;void nextTick(()=>errorAlert.value?.focus());}
const stopProgress=window.sefiplanApi.subscribeToProgress(value=>{if(processId.value&&value.processId!==processId.value)return;processId.value||=value.processId;progress.value=value;starting.value=false;});
const stopCompletion=window.sefiplanApi.subscribeToCompletion(value=>{if(processId.value&&value.processId!==processId.value)return;result.value=value;starting.value=false;processId.value='';
  if(value.status===BatchStatus.FAILED)showError(value.errorMessage??'No se pudo actualizar el expediente.');else{statusMessage.value='Expediente y reporte mensual actualizados. Sincronización pendiente; consulta la cola de sincronización.';void loadContext();}});
onMounted(async()=>{try{await loadCatalogs();await loadContext();}catch(cause){showError(errorMessage(cause,'No se pudo preparar la pantalla.'));}
  finally{contextInitialized=true;contextLoading.value=false;}});
watch(()=>catalog.status?.revision,async(revision,previous)=>{if(!contextInitialized||revision===previous)return;try{await loadCatalogs();if(!reconciliation.value)await loadContext();}catch(cause){showError(errorMessage(cause,'No se pudo actualizar la selección de catálogos.'));}});
onUnmounted(()=>{++contextSequence;stopProgress();stopCompletion();});
</script>

<template>
  <PageHeader title="Expedientes mensuales" description="Integra las dos quincenas del mes y actualiza un único reporte por grupo de conceptos.">
    <template #actions><button class="btn btn-outline-primary" type="button" :disabled="openingReports||!reconciliation?.reportPath" @click="openReports"><i class="bi bi-folder2-open" aria-hidden="true" /> {{ openingReports?'Abriendo…':'Abrir reporte mensual' }}</button></template>
  </PageHeader>
  <CatalogStatusPanel />
  <div ref="errorAlert" tabindex="-1"><div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div></div>
  <section class="period-workspace" aria-labelledby="period-title"><div><span class="eyebrow">Periodo de trabajo</span><h2 id="period-title">Abrir expediente mensual</h2><p>Las cargas nuevas se acumulan; una carga del mismo tipo y quincena reemplaza la versión activa.</p></div>
    <div class="period-workspace__fields"><label>Año<input v-model.number="year" class="form-control" type="number" min="2000" max="2200" :disabled="processing" /></label>
      <label>Mes<select v-model.number="month" class="form-select" :disabled="processing"><option v-for="n in 12" :key="n" :value="n">{{ new Date(2026,n-1,1).toLocaleDateString('es-MX',{month:'long'}) }}</option></select></label>
      <label>Grupo<select v-model.number="conceptGroupId" class="form-select" :disabled="processing"><option v-if="conceptGroupId&&!groups.some(g=>g.id===conceptGroupId)" :value="conceptGroupId" disabled>Grupo anterior no disponible</option><option v-for="group in groups.filter(g=>g.active)" :key="group.id" :value="group.id">{{ group.name }}</option></select></label></div></section>
  <div v-if="contextLoading" class="inline-loading" role="status"><span class="spinner-border spinner-border-sm" /> Abriendo expediente…</div>

  <div class="process-steps mt-4">
    <StepSection :number="1" title="Archivos para actualizar" :description="`Solo ${allowedFortnights.map(q=>`Q${String(q).padStart(2,'0')}`).join(' y ')} pertenecen a este mes.`">
      <div class="row g-3 mb-3 align-items-end"><div class="col-md-4"><button class="btn btn-primary w-100" type="button" :disabled="selecting||processing||contextLoading||!catalog.canProcess||!conceptGroupId" @click="selectFiles"><span v-if="selecting" class="spinner-border spinner-border-sm" /><i v-else class="bi bi-files" aria-hidden="true" /> {{ files.length?'Agregar otros TXT':'Seleccionar archivos TXT' }}</button></div>
        <div class="col-md-5"><label class="form-label" for="bulk-type">Aplicar tipo a todos</label><div class="input-group"><select id="bulk-type" v-model.number="bulkPayrollTypeId" class="form-select"><option v-for="type in payrollTypes" :key="type.id" :value="type.id">{{ type.name }}</option></select><button class="btn btn-outline-secondary" type="button" @click="applyPayrollType">Aplicar</button></div></div></div>
      <div v-if="!files.length" class="compact-empty"><i class="bi bi-file-earmark-text" /><span>No hay archivos pendientes en esta actualización.</span></div>
      <article v-for="(item,index) in files" :key="item.file.token" class="file-queue__item"><div class="file-queue__main"><div class="file-queue__name"><i class="bi bi-file-earmark-text" aria-hidden="true" /><div><strong>{{ item.file.name }}</strong><small>{{ (item.file.size/1048576).toFixed(1) }} MB</small></div></div>
                                                                                               <label>Quincena<select v-model.number="item.fortnight" class="form-select form-select-sm"><option v-for="q in allowedFortnights" :key="q" :value="q">Q{{ String(q).padStart(2,'0') }}</option></select></label>
                                                                                               <label>Tipo<select v-model.number="item.payrollTypeId" class="form-select form-select-sm" @change="resetRetained(item)"><option v-for="type in visibleTypes" :key="type.id" :value="type.id" :disabled="!type.active&&!activeFor(type.id,item.fortnight)">{{ type.name }}{{ type.active?'':' · inactivo' }}</option></select></label>
                                                                                               <StatusBadge :status="item.inspecting?'PROCESSING':item.preflight?.canProcess?'VALID':'INVALID'" /><button class="btn btn-link text-danger" type="button" :aria-label="`Quitar ${item.file.name}`" @click="removeFile(index)"><i class="bi bi-trash" /></button></div>
        <div v-if="item.analysisError" class="file-analysis-error" role="alert"><span><i class="bi bi-exclamation-circle" aria-hidden="true" /> {{ item.analysisError }}</span><button class="btn btn-outline-danger btn-sm" type="button" @click="retryInspection(item)">Reintentar análisis</button></div>
        <button v-if="item.preflight && item.preflight.catalogRevision!==catalog.status?.revision" class="btn btn-outline-primary btn-sm my-2" type="button" :disabled="processing||item.inspecting||!catalog.canProcess" @click="retryInspection(item)">Reanalizar con el catálogo vigente</button>
        <label v-if="activeFor(item.payrollTypeId,item.fortnight)" class="form-check replacement-confirm"><input v-model="item.replaceActiveBatch" class="form-check-input" type="checkbox" /><span>Reemplazar la versión {{ activeFor(item.payrollTypeId,item.fortnight)?.version }} activa sin duplicar sus importes</span></label>
        <details v-if="item.preflight&&index===0" class="file-queue__preview"><summary>Vista previa del primer TXT</summary><ParsedPreviewTable :rows="item.preflight.preview" /></details></article>
    </StepSection>
    <StepSection :number="2" title="Conceptos de la actualización" description="Solo los conceptos seleccionados contribuirán al total mensual." :disabled="!files.length"><details v-for="item in files" :key="`concept-${item.file.token}`" open class="concept-file"><summary><strong>{{ item.file.name }}</strong><span>{{ item.selectedConceptIds.length }} seleccionados</span></summary>
      <ConceptMultiSelect v-model="item.selectedConceptIds" :options="conceptOptions(item)" :filename="item.file.name" :loading="item.inspecting" :disabled="processing||item.inspecting" @change="handleConceptChange(item)" /></details>
    </StepSection>
    <StepSection class="retained-files" :number="3" title="Empleados retenidos" description="La lista es opcional e independiente para cada TXT." :disabled="!files.length">
      <details v-for="item in files" :key="`ret-${item.file.token}`">
        <summary><strong>{{ item.file.name }}</strong><span>{{ parsedRetained(item).length }} empleados</span></summary>
        <label class="form-label" :for="`retained-${item.file.token}`">Números de empleado</label>
        <textarea :id="`retained-${item.file.token}`" v-model="item.retainedText" class="form-control" rows="4" placeholder="Ejemplo: 22215, 24772 o uno por línea" :disabled="validatingRetained||processing" :aria-describedby="`retained-help-${item.file.token}`" @input="resetRetained(item)" />
        <div :id="`retained-help-${item.file.token}`" class="form-text">Captura hasta 500 números, uno por línea o separados por coma o punto y coma. Se comparan con la columna “Número de empleado” del TXT completo.</div>
        <ul v-if="item.retainedMatches" class="validation-results mt-2" role="status">
          <li v-for="match in item.retainedMatches" :key="match.employeeNumber"><span>{{ match.employeeNumber }} · {{ match.employeeName||'Sin nombre' }}</span><span>{{ match.found?`${match.matchingRecords} movimientos`:'No encontrado' }}</span></li>
        </ul>
        <label v-if="item.retainedMatches?.some(m=>!m.found)" class="form-check"><input v-model="item.missingAcknowledged" class="form-check-input" type="checkbox" :disabled="processing" /> Confirmo continuar con empleados no encontrados</label>
      </details>
      <button v-if="files.some(f=>parsedRetained(f).length)" class="btn btn-outline-primary mt-3" type="button" :disabled="validatingRetained||processing" @click="validateRetained"><span v-if="validatingRetained" class="spinner-border spinner-border-sm" aria-hidden="true" /> {{ validatingRetained?'Validando retenidos…':'Validar retenidos' }}</button>
    </StepSection>
    <StepSection :number="4" title="Actualizar expediente" description="Cada archivo conciliado actualiza el reporte mensual vigente." :disabled="!files.length"><ProcessingProgressView v-if="progress&&processing" :progress="progress" />
      <div v-if="processBlockers.length&&!processing" class="alert alert-warning" role="status"><strong>Falta completar:</strong><ul><li v-for="(blocker,index) in processBlockers" :key="index"><strong>{{ blocker.filename }}:</strong> {{ blocker.reason }}</li></ul></div>
      <div class="process-ready"><div><strong>{{ files.length }} TXT en esta actualización</strong><p class="mb-0">El reporte mensual se sobrescribirá al conciliar.</p></div><div class="d-flex gap-2 flex-wrap"><button class="btn btn-outline-secondary" type="button" :disabled="openingReports||!reconciliation" @click="openReports"><i class="bi bi-folder2-open" aria-hidden="true" /> {{ openingReports?'Abriendo…':'Abrir carpeta de reportes' }}</button><button class="btn btn-primary" type="button" :disabled="!canProcess" @click="start"><i class="bi bi-arrow-repeat" aria-hidden="true" /> Actualizar expediente</button></div></div>
      <button v-if="processing" class="btn btn-outline-danger mt-3" type="button" @click="cancel">Cancelar</button><p v-if="statusMessage" class="operation-status mt-3" role="status">{{ statusMessage }}</p></StepSection>
  </div>
</template>
