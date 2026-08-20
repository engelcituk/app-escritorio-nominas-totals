import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import { conceptAliasDraftSchema, conceptGroupDraftSchema, fileTokenSchema, historyQuerySchema, payrollConceptDraftSchema,
  monthlyReconciliationKeySchema, payrollTypeDraftSchema, processMonthlyImportRequestSchema, retainedValidationSchema } from '../../shared/schemas/ipc.js';
import type { BatchSummary, ConceptAlias, ConceptGroup, MonthlyReconciliationSummary, PayrollConcept, PayrollTypeDraft,
  PayrollTypeSummary, RetainedValidationResult, SelectedFile } from '../../shared/types/payroll.js';
import { canonicalConceptName, canonicalizeConceptDescription } from '../../shared/utils/normalization.js';
import { DatabaseService } from '../database/DatabaseService.js';
import { BackupService } from '../services/BackupService.js';
import { ACTIVE_CONCEPT_MATCHERS_SQL, ConceptMatcher, type ConceptMatchRule } from '../services/ConceptMatcher.js';
import { inspectPayrollFile } from '../services/PreflightService.js';
import { ProcessingService } from '../services/ProcessingService.js';
import { getMonthlyReportDirectory } from '../services/ReportPathService.js';
import { TxtStreamParser } from '../services/TxtStreamParser.js';

const fileTokens = new Map<string, string>(); const directoryTokens = new Map<string, string>();

export function registerIpcHandlers(windowProvider: () => BrowserWindow | null, databasePath: string): ProcessingService {
  const processing = new ProcessingService(databasePath, windowProvider);
  ipcMain.handle('file:select-txts', async (): Promise<SelectedFile[]> => {
    const result = await dialog.showOpenDialog(windowProvider()!, { title: 'Seleccionar archivos de nómina', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Archivos de nómina', extensions: ['txt'] }] });
    if (result.canceled) return []; const { stat } = await import('node:fs/promises');
    return Promise.all(result.filePaths.map(async (path) => { const info = await stat(path); const token = randomUUID(); fileTokens.set(token, path);
      return { token, name: basename(path), size: info.size, modifiedAt: info.mtime.toISOString() }; }));
  });
  ipcMain.handle('file:inspect', async (_event, raw: unknown) => {
    const payload = fileTokenSchema.parse(raw); const path = resolveToken(fileTokens, payload.fileToken, 'El archivo seleccionado ya no está disponible.');
    const { stat } = await import('node:fs/promises'); const info = await stat(path); const db = new DatabaseService(databasePath);
    try {
      const rules = db.connection.prepare(ACTIVE_CONCEPT_MATCHERS_SQL).all() as ConceptMatchRule[];
      const result = await inspectPayrollFile(path, { token: payload.fileToken, name: basename(path), size: info.size,
        modifiedAt: info.mtime.toISOString() }, payload.includePreview, rules);
      const duplicate = db.connection.prepare(`SELECT id FROM payroll_batches WHERE file_hash_sha256=? AND is_active=1
        ORDER BY id DESC LIMIT 1`).get(result.fileHashSha256) as { id: number } | undefined;
      result.historicalDuplicateBatchId = duplicate?.id ?? null;
      if (duplicate) result.warnings.push(`Este contenido ya fue procesado en el lote ${duplicate.id}.`);
      return result;
    } finally { db.close(); }
  });
  ipcMain.handle('directory:select-export', async () => { const result = await dialog.showOpenDialog(windowProvider()!, {
    title: 'Seleccionar carpeta de reportes', properties: ['openDirectory', 'createDirectory'] }); const path = result.filePaths[0];
    if (result.canceled || !path) return null; const token = randomUUID(); directoryTokens.set(token, path); return { token, name: path }; });
  ipcMain.handle('payroll:process-month', (_event, raw: unknown) => {
    const request = processMonthlyImportRequestSchema.parse(raw); const files = request.files.map((file) => {
      const filePath = resolveToken(fileTokens, file.fileToken, 'Selecciona nuevamente los archivos de nómina.'); return { filePath, name: basename(filePath) }; });
    const db = new DatabaseService(databasePath); const setting = db.connection.prepare(`SELECT value FROM app_settings WHERE key='reports_directory'`).get() as { value: string } | undefined; db.close();
    const outputDirectory = request.exportDirectoryToken ? resolveToken(directoryTokens, request.exportDirectoryToken, 'Selecciona nuevamente la carpeta de reportes.')
      : (setting?.value ?? join(app.getPath('documents'), 'SEFIPLAN_Nomina'));
    return { processId: processing.start(request, { files, outputDirectory }) };
  });
  ipcMain.handle('payroll:validate-retained', async (_event, raw: unknown): Promise<RetainedValidationResult> => {
    const request = retainedValidationSchema.parse(raw); const db = new DatabaseService(databasePath);
    const rules = db.connection.prepare(ACTIVE_CONCEPT_MATCHERS_SQL).all() as ConceptMatchRule[]; db.close(); const matcher = new ConceptMatcher(rules);
    const matches: RetainedValidationResult['matches'] = [];
    for (const source of request.files) {
      const path = resolveToken(fileTokens, source.fileToken, 'Selecciona nuevamente los archivos de nómina.');
      const selected = new Set(source.selectedConceptIds); const byEmployee = new Map(source.retainedEmployeeNumbers.map((number) => [number,
        { fileToken: source.fileToken, employeeNumber: number, employeeName: null as string | null, found: false, matchingRecords: 0 }]));
      for await (const item of new TxtStreamParser().parse(path)) { if (!item.record) continue; const found = byEmployee.get(item.record.employeeNumber); if (!found) continue;
        found.found = true; found.employeeName ||= item.record.employeeName; const classification = matcher.classify(item.record);
        if (classification.conceptId && selected.has(classification.conceptId)) found.matchingRecords += 1; }
      matches.push(...byEmployee.values());
    }
    return { matches, missingCount: matches.filter((item) => !item.found).length };
  });
  ipcMain.handle('payroll:cancel', (_event, id: unknown) => processing.cancel(String(id)));

  ipcMain.handle('concepts:list', () => listCatalog(databasePath));
  ipcMain.handle('concepts:save-group', (_event, raw: unknown) => saveGroup(databasePath, conceptGroupDraftSchema.parse(raw)));
  ipcMain.handle('concepts:save-concept', (_event, raw: unknown) => saveConcept(databasePath, payrollConceptDraftSchema.parse(raw)));
  ipcMain.handle('concepts:add-alias', (_event, raw: unknown) => addAlias(databasePath, conceptAliasDraftSchema.parse(raw)));
  ipcMain.handle('concepts:remove-alias', (_event, id: unknown) => { const db = new DatabaseService(databasePath); const now = new Date().toISOString(); try {
    const aliasId = Number(id); db.connection.transaction(() => { db.connection.prepare('UPDATE concept_aliases SET active=0,updated_at=? WHERE id=?').run(now, aliasId);
      db.connection.prepare(`INSERT INTO audit_logs(action,entity_type,entity_id,description,created_at)
        VALUES ('DEACTIVATE','CONCEPT_ALIAS',?,'Se desactivó un alias de concepto.',?)`).run(String(aliasId), now); })(); } finally { db.close(); } });
  ipcMain.handle('payroll-types:list', (_event, includeInactive: unknown) => listPayrollTypes(databasePath, Boolean(includeInactive)));
  ipcMain.handle('payroll-types:save', (_event, raw: unknown) => savePayrollType(databasePath, payrollTypeDraftSchema.parse(raw)));
  ipcMain.handle('monthly:get-or-create', (_event, raw: unknown) => getOrCreateMonthly(databasePath, monthlyReconciliationKeySchema.parse(raw)));

  ipcMain.handle('history:list', (_event, payload: unknown) => listBatchHistory(databasePath, payload));
  ipcMain.handle('history:monthly', (_event, payload: unknown) => listMonthlyHistory(databasePath, payload));
  ipcMain.handle('report:open-folder', (_event, id: unknown) => openReport(databasePath, 'batch_id', Number(id)));
  ipcMain.handle('report:open-month-folder', (_event, id: unknown) => openMonthlyReportDirectory(databasePath, Number(id)));
  ipcMain.handle('settings:get', () => { const db = new DatabaseService(databasePath); const rows = db.connection.prepare('SELECT key,value FROM app_settings').all() as Array<{ key: string; value: string }>; db.close(); return Object.fromEntries(rows.map((row) => [row.key, row.value])); });
  ipcMain.handle('settings:update', (_event, payload: unknown) => updateSettings(databasePath, payload));
  ipcMain.handle('backup:create', async () => createBackup(databasePath, windowProvider));
  ipcMain.handle('backup:restore', async () => restoreBackup(databasePath, windowProvider));
  return processing;
}

function listCatalog(databasePath: string): { groups: ConceptGroup[]; concepts: PayrollConcept[] } {
  const db = new DatabaseService(databasePath); try {
    const groups = (db.connection.prepare('SELECT * FROM concept_groups ORDER BY name').all() as Array<Record<string, string | number>>)
      .map((r) => ({ id: Number(r.id), code: String(r.code), name: String(r.name), active: Boolean(r.active) }));
    const aliases = db.connection.prepare('SELECT * FROM concept_aliases ORDER BY source_description').all() as Array<Record<string, string | number>>;
    const conceptRows = db.connection.prepare(`SELECT c.*,g.name group_name FROM payroll_concepts c LEFT JOIN concept_groups g ON g.id=c.group_id ORDER BY c.name`).all() as Array<Record<string, string | number | null>>;
    const concepts = conceptRows.map((r): PayrollConcept => ({ id: Number(r.id), code: String(r.code), name: String(r.name),
        groupId: r.group_id === null ? null : Number(r.group_id), groupName: r.group_name === null ? null : String(r.group_name),
        operationFactor: Number(r.operation_factor) === -1 ? -1 : 1, active: Boolean(r.active), aliases: aliases.filter((a) => Number(a.concept_id) === Number(r.id))
          .map((a): ConceptAlias => ({ id: Number(a.id), conceptId: Number(a.concept_id), sourceDescription: String(a.source_description),
            normalizedDescription: String(a.normalized_description), active: Boolean(a.active) })) }));
    return { groups, concepts };
  } finally { db.close(); }
}

function saveGroup(databasePath: string, value: { id?: number | undefined; code: string; name: string; active: boolean }): number {
  const db = new DatabaseService(databasePath); const now = new Date().toISOString(); try { return db.connection.transaction(() => {
    const id = value.id ?? Number(db.connection.prepare(`INSERT INTO concept_groups(code,name,active,created_at,updated_at) VALUES (?,?,?,?,?)`)
      .run(value.code, value.name, value.active ? 1 : 0, now, now).lastInsertRowid);
    if (value.id) db.connection.prepare(`UPDATE concept_groups SET name=?,active=?,updated_at=? WHERE id=?`).run(value.name, value.active ? 1 : 0, now, id);
    db.connection.prepare(`INSERT INTO audit_logs(action,entity_type,entity_id,description,metadata_json,created_at)
      VALUES ('SAVE','CONCEPT_GROUP',?,'Se guardó un grupo de conceptos.',?,?)`).run(String(id), JSON.stringify({ active: value.active }), now);
    return id; })(); } finally { db.close(); }
}
function saveConcept(databasePath: string, value: { id?: number | undefined; code: string; name: string; groupId: number | null; operationFactor: 1 | -1; active: boolean; sourceDescription?: string | undefined }): number {
  const db = new DatabaseService(databasePath); const now = new Date().toISOString(); try { return db.connection.transaction(() => {
    const name = canonicalConceptName(value.name);
    let id = value.id; if (id) db.connection.prepare(`UPDATE payroll_concepts SET name=?,group_id=?,operation_factor=?,active=?,updated_at=? WHERE id=?`)
      .run(name, value.groupId, value.operationFactor, value.active ? 1 : 0, now, id);
    else id = Number(db.connection.prepare(`INSERT INTO payroll_concepts(code,name,group_id,operation_factor,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run(value.code, name, value.groupId, value.operationFactor, value.active ? 1 : 0, now, now).lastInsertRowid);
    if (value.sourceDescription) insertAlias(db, id, value.sourceDescription, now);
    db.connection.prepare(`INSERT INTO audit_logs(action,entity_type,entity_id,description,metadata_json,created_at) VALUES ('SAVE','PAYROLL_CONCEPT',?,?,?,?)`)
      .run(String(id), 'Se guardó un concepto de nómina.', JSON.stringify({ operationFactor: value.operationFactor, groupId: value.groupId }), now); return id; })(); } finally { db.close(); }
}
function addAlias(databasePath: string, value: { conceptId: number; sourceDescription: string }): number { const db = new DatabaseService(databasePath);
  const now = new Date().toISOString(); try { return db.connection.transaction(() => { const id = insertAlias(db, value.conceptId, value.sourceDescription, now);
    db.connection.prepare(`INSERT INTO audit_logs(action,entity_type,entity_id,description,metadata_json,created_at)
      VALUES ('CREATE','CONCEPT_ALIAS',?,'Se agregó un alias de concepto.',?,?)`).run(String(id), JSON.stringify({ conceptId: value.conceptId }), now);
    return id; })(); } finally { db.close(); } }
function insertAlias(db: DatabaseService, conceptId: number, description: string, now: string): number { const normalized = canonicalizeConceptDescription(description);
  try { return Number(db.connection.prepare(`INSERT INTO concept_aliases(concept_id,source_description,normalized_description,active,created_at,updated_at)
    VALUES (?,?,?,1,?,?)`).run(conceptId, description, normalized, now, now).lastInsertRowid); }
  catch (error) { if (/UNIQUE/i.test(error instanceof Error ? error.message : '')) throw new Error('Esta descripción ya está asignada a otro concepto.'); throw error; } }

function listPayrollTypes(databasePath:string,includeInactive=false):PayrollTypeSummary[]{ const db=new DatabaseService(databasePath); try{
  return (db.connection.prepare(`SELECT pt.*,EXISTS(SELECT 1 FROM payroll_batches pb WHERE pb.payroll_type_id=pt.id) used FROM payroll_types pt
    ${includeInactive?'':'WHERE pt.active=1'} ORDER BY pt.name`).all() as Array<Record<string,string|number>>).map(r=>({ id:Number(r.id),code:String(r.code),
    name:String(r.name),active:Boolean(r.active),used:Boolean(r.used) })); }finally{db.close();} }
function savePayrollType(databasePath:string,value:PayrollTypeDraft):number{ const db=new DatabaseService(databasePath); const now=new Date().toISOString(); try{
  return db.connection.transaction(()=>{ if(value.id){ const current=db.connection.prepare('SELECT code FROM payroll_types WHERE id=?').get(value.id) as { code:string }|undefined;
      if(!current)throw new Error('No se encontró el tipo de nómina.'); if(current.code!==value.code&&db.connection.prepare('SELECT 1 FROM payroll_batches WHERE payroll_type_id=? LIMIT 1').get(value.id))
        throw new Error('El código de un tipo utilizado no puede modificarse.'); db.connection.prepare('UPDATE payroll_types SET code=?,name=?,active=?,updated_at=? WHERE id=?')
        .run(value.code,value.name,value.active?1:0,now,value.id); return value.id; }
    return Number(db.connection.prepare('INSERT INTO payroll_types(code,name,active,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(value.code,value.name,value.active?1:0,now,now).lastInsertRowid); })(); }finally{db.close();} }

function getOrCreateMonthly(databasePath:string,key:{ year:number;month:number;conceptGroupId:number }):MonthlyReconciliationSummary{ const db=new DatabaseService(databasePath); try{
  let row=db.connection.prepare('SELECT id FROM monthly_reconciliations WHERE year=? AND month=? AND concept_group_id=?')
    .get(key.year,key.month,key.conceptGroupId) as { id:number }|undefined; if(!row){ const now=new Date().toISOString(); row={ id:Number(db.connection.prepare(`INSERT INTO monthly_reconciliations
      (year,month,concept_group_id,status,started_at,created_at,updated_at) VALUES (?,?,?,'DRAFT',?,?,?)`).run(key.year,key.month,key.conceptGroupId,now,now,now).lastInsertRowid) }; }
  return mapMonthly(db,row.id); }finally{db.close();} }

function listBatchHistory(databasePath: string, raw: unknown): { items: BatchSummary[]; total: number } {
  const q=historyQuerySchema.parse(raw); const where=['1=1']; const values:unknown[]=[]; if(q.year){where.push('pb.year=?');values.push(q.year);} if(q.month){where.push('pb.month=?');values.push(q.month);}
  if(q.fortnight){where.push('pb.fortnight=?');values.push(q.fortnight);} if(q.payrollTypeId){where.push('pb.payroll_type_id=?');values.push(q.payrollTypeId);}
  if(q.status){where.push('pb.status=?');values.push(q.status);} if(q.search){where.push('pb.original_filename LIKE ?');values.push(`%${q.search.replace(/[%_]/g,'')}%`);}
  const db=new DatabaseService(databasePath); const total=(db.connection.prepare(`SELECT COUNT(*) count FROM payroll_batches pb WHERE ${where.join(' AND ')}`).get(...values) as { count:number }).count;
  const rows=db.connection.prepare(`SELECT pb.*,pt.code payroll_type_code,pt.name payroll_type_name FROM payroll_batches pb JOIN payroll_types pt ON pt.id=pb.payroll_type_id
    WHERE ${where.join(' AND ')} ORDER BY pb.created_at DESC LIMIT ? OFFSET ?`).all(...values,q.pageSize,(q.page-1)*q.pageSize) as Array<Record<string,string|number|null>>; db.close();
  return { items: rows.map(mapBatch), total };
}
function listMonthlyHistory(databasePath:string,raw:unknown):{ items:MonthlyReconciliationSummary[];total:number }{ const q=historyQuerySchema.parse(raw);
  const where=['mr.file_count > 0'];const values:unknown[]=[];if(q.year){where.push('mr.year=?');values.push(q.year);}if(q.month){where.push('mr.month=?');values.push(q.month);}
  if(q.status){where.push('mr.status=?');values.push(q.status);}const db=new DatabaseService(databasePath);try{ const total=Number((db.connection.prepare(
    `SELECT COUNT(*) count FROM monthly_reconciliations mr WHERE ${where.join(' AND ')}`).get(...values) as { count:number }).count);
    const ids=(db.connection.prepare(`SELECT mr.id FROM monthly_reconciliations mr WHERE ${where.join(' AND ')} ORDER BY mr.year DESC,mr.month DESC LIMIT ? OFFSET ?`)
      .all(...values,q.pageSize,(q.page-1)*q.pageSize) as Array<{ id:number }>).map(r=>r.id); return { items:ids.map(id=>mapMonthly(db,id)),total }; }finally{db.close();} }
function mapMonthly(db:DatabaseService,id:number):MonthlyReconciliationSummary{ const r=db.connection.prepare(`SELECT mr.*,cg.code group_code,cg.name group_name,
    ra.file_path report_path FROM monthly_reconciliations mr JOIN concept_groups cg ON cg.id=mr.concept_group_id LEFT JOIN report_artifacts ra
    ON ra.reconciliation_id=mr.id AND ra.report_type='MONTHLY_TOTALS' WHERE mr.id=?`).get(id) as Record<string,string|number|null>|undefined;
  if(!r)throw new Error('No se encontró el expediente mensual.'); const batches=(db.connection.prepare(`SELECT pb.*,pt.code payroll_type_code,pt.name payroll_type_name
    FROM payroll_batches pb JOIN payroll_types pt ON pt.id=pb.payroll_type_id WHERE pb.reconciliation_id=? AND pb.is_active=1 ORDER BY pb.fortnight,pt.name`)
    .all(id) as Array<Record<string,string|number|null>>).map(mapBatch); return { id:Number(r.id),year:Number(r.year),month:Number(r.month),conceptGroupId:Number(r.concept_group_id),
    conceptGroupCode:String(r.group_code),conceptGroupName:String(r.group_name),revision:Number(r.revision),status:String(r.status) as MonthlyReconciliationSummary['status'],
    fortnights:[...new Set(batches.filter(b=>b.active).map(b=>b.fortnight))].sort((a,b)=>a-b),fileCount:Number(r.file_count),completedFiles:Number(r.completed_files),
    totalLines:Number(r.total_lines),excludedLines:Number(r.excluded_lines),invalidLines:Number(r.invalid_lines),totalAmountCents:Number(r.total_amount_cents),
    completedAt:r.completed_at?String(r.completed_at):null,reportPath:r.report_path?String(r.report_path):null,batches }; }
function mapBatch(r:Record<string,string|number|null>):BatchSummary{return{ id:Number(r.id),year:Number(r.year),month:Number(r.month),fortnight:Number(r.fortnight),
  payrollTypeId:Number(r.payroll_type_id),payrollTypeCode:String(r.payroll_type_code),payrollTypeName:String(r.payroll_type_name),version:Number(r.version),
  originalFilename:String(r.original_filename),active:Boolean(r.is_active),status:String(r.status) as BatchSummary['status'],totalLines:Number(r.total_lines),
  excludedLines:Number(r.excluded_lines),invalidLines:Number(r.invalid_lines),totalAmountCents:Number(r.total_amount_cents),completedAt:r.completed_at?String(r.completed_at):null};}
async function openReport(databasePath:string,column:'batch_id'|'reconciliation_id',id:number):Promise<boolean>{if(!Number.isInteger(id)||id<1)return false;
  const db=new DatabaseService(databasePath);const row=db.connection.prepare(`SELECT file_path FROM report_artifacts WHERE ${column}=? ORDER BY updated_at DESC LIMIT 1`).get(id) as { file_path:string }|undefined;db.close();
  if(!row||!existsSync(row.file_path))return false;return(await shell.openPath(dirname(row.file_path)))==='';}
async function openMonthlyReportDirectory(databasePath:string,id:number):Promise<boolean>{if(!Number.isInteger(id)||id<1)return false;
  const db=new DatabaseService(databasePath);try{const artifact=db.connection.prepare(`SELECT file_path FROM report_artifacts WHERE reconciliation_id=? ORDER BY updated_at DESC LIMIT 1`).get(id) as { file_path:string }|undefined;
    if(artifact&&existsSync(artifact.file_path))return(await shell.openPath(dirname(artifact.file_path)))==='';
    const period=db.connection.prepare(`SELECT mr.year,mr.month,cg.code group_code FROM monthly_reconciliations mr JOIN concept_groups cg ON cg.id=mr.concept_group_id WHERE mr.id=?`).get(id) as { year:number;month:number;group_code:string }|undefined;
    if(!period)return false;const setting=db.connection.prepare(`SELECT value FROM app_settings WHERE key='reports_directory'`).get() as { value:string }|undefined;
    const root=setting?.value??join(app.getPath('documents'),'SEFIPLAN_Nomina');const directory=getMonthlyReportDirectory(root,period.year,period.month,period.group_code);
    await mkdir(directory,{recursive:true});return(await shell.openPath(directory))==='';
  }finally{db.close();}}
function updateSettings(databasePath: string, payload: unknown): void { const allowed = new Set(['minimum_year','maximum_year']); if (!payload || typeof payload !== 'object') throw new Error('La configuración no es válida.');
  const db = new DatabaseService(databasePath); const upsert = db.connection.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`);
  db.connection.transaction(() => { for (const [key, value] of Object.entries(payload)) { if (key === 'reports_directory_token' && typeof value === 'string') upsert.run('reports_directory', resolveToken(directoryTokens, value, 'Selecciona nuevamente la carpeta de reportes.'), new Date().toISOString());
    else if (allowed.has(key) && typeof value === 'string') upsert.run(key, value, new Date().toISOString()); } })(); db.close(); }
async function createBackup(databasePath: string, provider: () => BrowserWindow | null): Promise<{ path: string } | null> { const result = await dialog.showSaveDialog(provider()!, { title: 'Crear respaldo', defaultPath: `Respaldo_SEFIPLAN_${new Date().toISOString().slice(0, 10)}.zip`, filters: [{ name: 'Respaldo ZIP', extensions: ['zip'] }] });
  if (result.canceled || !result.filePath) return null; const snapshot = join(app.getPath('temp'), `sefiplan-backup-${randomUUID()}.sqlite`); const source = new DatabaseService(databasePath);
  try { await source.connection.backup(snapshot); } finally { source.close(); } try { await new BackupService().create(snapshot, result.filePath); } finally { void (await import('node:fs/promises')).unlink(snapshot).catch(() => undefined); } return { path: result.filePath }; }
async function restoreBackup(databasePath: string, provider: () => BrowserWindow | null): Promise<{ restored: boolean; automaticBackupPath: string } | null> { const chosen = await dialog.showOpenDialog(provider()!, { title: 'Restaurar respaldo', properties: ['openFile'], filters: [{ name: 'Respaldo ZIP', extensions: ['zip'] }] });
  const archive = chosen.filePaths[0]; if (chosen.canceled || !archive) return null; const confirmation = await dialog.showMessageBox(provider()!, { type: 'warning', buttons: ['Restaurar','Cancelar'], defaultId: 1, cancelId: 1, message: 'La información actual será reemplazada.', detail: 'Antes se creará automáticamente un respaldo de la base actual.' });
  if (confirmation.response !== 0) return null; const temporary = await mkdtemp(join(app.getPath('temp'), 'sefiplan-restore-')); const automaticBackupPath = join(app.getPath('userData'), 'backups', `Antes_de_restaurar_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);
  try { await new BackupService().create(databasePath, automaticBackupPath); const restoredPath = await new BackupService().extractValidated(archive, temporary); const candidate = new DatabaseService(restoredPath); candidate.close();
    await rm(`${databasePath}-wal`, { force: true }); await rm(`${databasePath}-shm`, { force: true }); await copyFile(restoredPath, databasePath); return { restored: true, automaticBackupPath }; } finally { await rm(temporary, { recursive: true, force: true }); } }
function resolveToken(registry: Map<string, string>, token: string, message: string): string { const value = registry.get(token); if (!value) throw new Error(message); return value; }
