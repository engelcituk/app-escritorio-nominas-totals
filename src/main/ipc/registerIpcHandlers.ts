import { randomUUID } from 'node:crypto';
import { trustedHandler } from './trustedSender.js';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { app, dialog, shell, type BrowserWindow } from 'electron';
import { fileTokenSchema, historyQuerySchema, monthlyReconciliationKeySchema, processMonthlyImportRequestSchema, retainedValidationSchema } from '../../shared/schemas/ipc.js';
import type { BatchSummary, ConceptGroup, MonthlyReconciliationSummary,
  PayrollTypeSummary, RetainedValidationResult, SelectedFile } from '../../shared/types/payroll.js';
import { DatabaseService } from '../database/DatabaseService.js';
import { BackupService } from '../services/BackupService.js';
import { ACTIVE_CONCEPT_MATCHERS_SQL, type ConceptMatchRule } from '../services/ConceptMatcher.js';
import { inspectPayrollFile } from '../services/PreflightService.js';
import { ProcessingService } from '../services/ProcessingService.js';
import { getMonthlyReportDirectory } from '../services/ReportPathService.js';
import { TxtStreamParser } from '../services/TxtStreamParser.js';
import { DeviceService } from '../services/central/DeviceService.js';
import type { CatalogSyncService } from '../services/central/CatalogSyncService.js';
import { CatalogRepository } from '../services/central/CatalogRepository.js';
import type { SyncOrchestrator } from '../services/central/SyncOrchestrator.js';
import { SyncOutboxService } from '../services/central/SyncOutboxService.js';

const fileTokens = new Map<string, string>(); const directoryTokens = new Map<string, string>();

export function registerIpcHandlers(windowProvider: () => BrowserWindow | null, databasePath: string, catalog: CatalogSyncService, sync: SyncOrchestrator): ProcessingService {
  let maintenance = false;
  const processing = new ProcessingService(databasePath, windowProvider, (revision) => {
    if (maintenance) throw new Error('Espera a que termine la restauración.');
    catalog.assertCanProcess(revision);
  }, () => { catalog.sessionChanged(); sync.activityChanged(); });
  const handle = trustedHandler(windowProvider);
  handle('file:select-txts', async (): Promise<SelectedFile[]> => {
    const result = await dialog.showOpenDialog(windowProvider()!, { title: 'Seleccionar archivos de nómina', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Archivos de nómina', extensions: ['txt'] }] });
    if (result.canceled) return []; const { stat } = await import('node:fs/promises');
    return Promise.all(result.filePaths.map(async (path) => { const info = await stat(path); const token = randomUUID(); fileTokens.set(token, path);
      return { token, name: basename(path), size: info.size, modifiedAt: info.mtime.toISOString() }; }));
  });
  handle('file:inspect', async (_event, raw: unknown) => {
    if (maintenance) throw new Error('Espera a que termine la restauración.');
    const payload = fileTokenSchema.parse(raw); const path = resolveToken(fileTokens, payload.fileToken, 'El archivo seleccionado ya no está disponible.');
    const { stat } = await import('node:fs/promises'); const info = await stat(path); const db = new DatabaseService(databasePath);
    let capture: { rules: ConceptMatchRule[]; revision: number | null };
    try {
      capture = db.connection.transaction(() => ({ rules: db.connection.prepare(ACTIVE_CONCEPT_MATCHERS_SQL).all() as ConceptMatchRule[],
        revision: new CatalogRepository(db.connection).state()?.revision ?? null }))();
    } finally { db.close(); }
    const result = await inspectPayrollFile(path, { token: payload.fileToken, name: basename(path), size: info.size,
      modifiedAt: info.mtime.toISOString() }, payload.includePreview, capture.rules);
    // Do not hold a SQLite handle while streaming TXT; restore may replace the DB.
    resolveToken(fileTokens, payload.fileToken, 'La base se restauró. Selecciona nuevamente los archivos.');
    const current = new DatabaseService(databasePath);
    try {
      const duplicate = current.connection.prepare(`SELECT id FROM payroll_batches WHERE file_hash_sha256=? AND is_active=1 ORDER BY id DESC LIMIT 1`)
        .get(result.fileHashSha256) as { id: number } | undefined;
      result.catalogRevision = capture.revision; result.historicalDuplicateBatchId = duplicate?.id ?? null;
      if (duplicate) result.warnings.push(`Este contenido ya fue procesado en el lote ${duplicate.id}.`);
      return result;
    } finally { current.close(); }
  });
  handle('directory:select-export', async () => { const result = await dialog.showOpenDialog(windowProvider()!, {
    title: 'Seleccionar carpeta de reportes', properties: ['openDirectory', 'createDirectory'] }); const path = result.filePaths[0];
    if (result.canceled || !path) return null; const token = randomUUID(); directoryTokens.set(token, path); return { token, name: path }; });
  handle('payroll:process-month', (_event, raw: unknown) => {
    const request = processMonthlyImportRequestSchema.parse(raw); const files = request.files.map((file) => {
      const filePath = resolveToken(fileTokens, file.fileToken, 'Selecciona nuevamente los archivos de nómina.'); return { filePath, name: basename(filePath) }; });
    const db = new DatabaseService(databasePath); const setting = db.connection.prepare(`SELECT value FROM app_settings WHERE key='reports_directory'`).get() as { value: string } | undefined; db.close();
    const outputDirectory = request.exportDirectoryToken ? resolveToken(directoryTokens, request.exportDirectoryToken, 'Selecciona nuevamente la carpeta de reportes.')
      : (setting?.value ?? join(app.getPath('documents'), 'SEFIPLAN_Nomina'));
    return { processId: processing.start(request, { files, outputDirectory }) };
  });
  handle('payroll:validate-retained', async (_event, raw: unknown): Promise<RetainedValidationResult> => {
    const request = retainedValidationSchema.parse(raw);
    const matches: RetainedValidationResult['matches'] = [];
    for (const source of request.files) {
      const path = resolveToken(fileTokens, source.fileToken, 'Selecciona nuevamente los archivos de nómina.');
      const byEmployee = new Map(source.retainedEmployeeNumbers.map((number) => [number,
        { fileToken: source.fileToken, employeeNumber: number, employeeName: null as string | null, found: false, matchingRecords: 0 }]));
      for await (const item of new TxtStreamParser().parse(path)) { if (!item.record) continue; const found = byEmployee.get(item.record.employeeNumber); if (!found) continue;
        found.found = true; found.employeeName ||= item.record.employeeName; found.matchingRecords += 1; }
      matches.push(...byEmployee.values());
    }
    return { matches, missingCount: matches.filter((item) => !item.found).length };
  });
  handle('payroll:cancel', (_event, id: unknown) => processing.cancel(String(id)));

  handle('concepts:groups', () => listGroups(databasePath));
  handle('payroll-types:list', (_event, includeInactive: unknown) => listPayrollTypes(databasePath, includeInactive === true));
  handle('monthly:get-or-create', (_event, raw: unknown) => { if (maintenance) throw new Error('Restauración en curso.'); return getOrCreateMonthly(databasePath, monthlyReconciliationKeySchema.parse(raw)); });

  handle('history:list', (_event, payload: unknown) => listBatchHistory(databasePath, payload));
  handle('history:monthly', (_event, payload: unknown) => listMonthlyHistory(databasePath, payload));
  handle('report:open-folder', (_event, id: unknown) => openReport(databasePath, 'batch_id', Number(id)));
  handle('report:open-month-folder', (_event, id: unknown) => openMonthlyReportDirectory(databasePath, Number(id)));
  handle('settings:get', () => { const db = new DatabaseService(databasePath); const rows = db.connection.prepare('SELECT key,value FROM app_settings').all() as Array<{ key: string; value: string }>; db.close(); return Object.fromEntries(rows.map((row) => [row.key, row.value])); });
  handle('settings:update', (_event, payload: unknown) => { if (maintenance) throw new Error('Restauración en curso.'); return updateSettings(databasePath, payload); });
  handle('backup:create', async () => createBackup(databasePath, windowProvider));
  handle('backup:restore', async () => {
    if (maintenance || processing.hasActiveProcesses() || catalog.getStatus().busy || sync.getStatus().busy) throw new Error('Espera a que termine el procesamiento o la sincronización.');
    maintenance = true;
    processing.setMaintenance(true);
    try { const result = await restoreBackup(databasePath, windowProvider); if (result?.restored) { fileTokens.clear(); directoryTokens.clear(); catalog.restoredBackup(); sync.restoredBackup(); } return result; }
    finally { maintenance = false; processing.setMaintenance(false); catalog.sessionChanged(); sync.activityChanged(); }
  });
  return processing;
}

function listGroups(databasePath: string): ConceptGroup[] {
  const db = new DatabaseService(databasePath);
  try {
    const rows = db.connection.prepare("SELECT id,code,name,active FROM concept_groups WHERE active=1 AND mapping_status='MAPPED' AND present_in_snapshot=1 ORDER BY name LIMIT 1001").all() as Array<{ id: number; code: string; name: string; active: number }>;
    if (rows.length > 1000) throw new Error('El selector admite hasta 1000 grupos activos. Consulta el catálogo paginado y revisa la configuración central.');
    return rows.map((row) => ({ ...row, active: Boolean(row.active) }));
  } finally { db.close(); }
}

function listPayrollTypes(databasePath:string,includeInactive=false):PayrollTypeSummary[]{ const db=new DatabaseService(databasePath); try{
  return (db.connection.prepare(`SELECT pt.*,EXISTS(SELECT 1 FROM payroll_batches pb WHERE pb.payroll_type_id=pt.id) used FROM payroll_types pt
    WHERE pt.mapping_status='MAPPED' AND pt.present_in_snapshot=1 ${includeInactive?'':'AND pt.active=1'} ORDER BY pt.sort_order,pt.name`).all() as Array<Record<string,string|number>>).map(r=>({ id:Number(r.id),code:String(r.code),
    name:String(r.name),active:Boolean(r.active),used:Boolean(r.used) })); }finally{db.close();} }
function getOrCreateMonthly(databasePath:string,key:{ year:number;month:number;conceptGroupId:number }):MonthlyReconciliationSummary{ const db=new DatabaseService(databasePath); try{
  let row=db.connection.prepare('SELECT id FROM monthly_reconciliations WHERE year=? AND month=? AND concept_group_id=?')
    .get(key.year,key.month,key.conceptGroupId) as { id:number }|undefined; if(!row){ if(!db.connection.prepare("SELECT 1 FROM concept_groups WHERE id=? AND active=1 AND mapping_status='MAPPED' AND present_in_snapshot=1").get(key.conceptGroupId))throw new Error('Selecciona un grupo central activo.'); const now=new Date().toISOString(); row={ id:Number(db.connection.prepare(`INSERT INTO monthly_reconciliations
      (year,month,concept_group_id,status,started_at,created_at,updated_at) VALUES (?,?,?,'DRAFT',?,?,?)`).run(key.year,key.month,key.conceptGroupId,now,now,now).lastInsertRowid) }; }
  db.connection.prepare(`UPDATE monthly_reconciliations SET concept_group_code_snapshot=(SELECT code FROM concept_groups WHERE id=concept_group_id), concept_group_name_snapshot=(SELECT name FROM concept_groups WHERE id=concept_group_id), catalog_provenance='CENTRAL_AT_CREATION' WHERE id=? AND concept_group_code_snapshot IS NULL`).run(row.id); return mapMonthly(db,row.id); }finally{db.close();} }

function listBatchHistory(databasePath: string, raw: unknown): { items: BatchSummary[]; total: number } {
  const q=historyQuerySchema.parse(raw); const where=['1=1']; const values:unknown[]=[]; if(q.year){where.push('pb.year=?');values.push(q.year);} if(q.month){where.push('pb.month=?');values.push(q.month);}
  if(q.fortnight){where.push('pb.fortnight=?');values.push(q.fortnight);} if(q.payrollTypeId){where.push('pb.payroll_type_id=?');values.push(q.payrollTypeId);}
  if(q.status){where.push('pb.status=?');values.push(q.status);} if(q.search){where.push('pb.original_filename LIKE ?');values.push(`%${q.search.replace(/[%_]/g,'')}%`);}
  const db=new DatabaseService(databasePath); const total=(db.connection.prepare(`SELECT COUNT(*) count FROM payroll_batches pb WHERE ${where.join(' AND ')}`).get(...values) as { count:number }).count;
  const rows=db.connection.prepare(`SELECT pb.*,COALESCE(pb.payroll_type_code_snapshot,pt.code) payroll_type_code,COALESCE(pb.payroll_type_name_snapshot,pt.name) payroll_type_name FROM payroll_batches pb JOIN payroll_types pt ON pt.id=pb.payroll_type_id
    WHERE ${where.join(' AND ')} ORDER BY pb.created_at DESC LIMIT ? OFFSET ?`).all(...values,q.pageSize,(q.page-1)*q.pageSize) as Array<Record<string,string|number|null>>; db.close();
  return { items: rows.map(mapBatch), total };
}
function listMonthlyHistory(databasePath:string,raw:unknown):{ items:MonthlyReconciliationSummary[];total:number }{ const q=historyQuerySchema.parse(raw);
  const where=['mr.file_count > 0'];const values:unknown[]=[];if(q.year){where.push('mr.year=?');values.push(q.year);}if(q.month){where.push('mr.month=?');values.push(q.month);}
  if(q.status){where.push('mr.status=?');values.push(q.status);}const db=new DatabaseService(databasePath);try{ const total=Number((db.connection.prepare(
    `SELECT COUNT(*) count FROM monthly_reconciliations mr WHERE ${where.join(' AND ')}`).get(...values) as { count:number }).count);
    const ids=(db.connection.prepare(`SELECT mr.id FROM monthly_reconciliations mr WHERE ${where.join(' AND ')} ORDER BY mr.year DESC,mr.month DESC LIMIT ? OFFSET ?`)
      .all(...values,q.pageSize,(q.page-1)*q.pageSize) as Array<{ id:number }>).map(r=>r.id); return { items:ids.map(id=>mapMonthly(db,id)),total }; }finally{db.close();} }
function mapMonthly(db:DatabaseService,id:number):MonthlyReconciliationSummary{ const r=db.connection.prepare(`SELECT mr.*,COALESCE(mr.concept_group_code_snapshot,cg.code) group_code,COALESCE(mr.concept_group_name_snapshot,cg.name) group_name,
    ra.file_path report_path FROM monthly_reconciliations mr JOIN concept_groups cg ON cg.id=mr.concept_group_id LEFT JOIN report_artifacts ra
    ON ra.reconciliation_id=mr.id AND ra.report_type='MONTHLY_TOTALS' WHERE mr.id=?`).get(id) as Record<string,string|number|null>|undefined;
  if(!r)throw new Error('No se encontró el expediente mensual.'); const batches=(db.connection.prepare(`SELECT pb.*,COALESCE(pb.payroll_type_code_snapshot,pt.code) payroll_type_code,COALESCE(pb.payroll_type_name_snapshot,pt.name) payroll_type_name
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
    const period=db.connection.prepare(`SELECT mr.year,mr.month,COALESCE(mr.concept_group_code_snapshot,cg.code) group_code FROM monthly_reconciliations mr JOIN concept_groups cg ON cg.id=mr.concept_group_id WHERE mr.id=?`).get(id) as { year:number;month:number;group_code:string }|undefined;
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
  try { await source.connection.backup(snapshot); } finally { source.close(); } try { await new BackupService().create(snapshot, result.filePath, databasePath); } finally { void (await import('node:fs/promises')).unlink(snapshot).catch(() => undefined); } return { path: result.filePath }; }
async function restoreBackup(databasePath: string, provider: () => BrowserWindow | null): Promise<{ restored: boolean; automaticBackupPath: string } | null> { const chosen = await dialog.showOpenDialog(provider()!, { title: 'Restaurar respaldo', properties: ['openFile'], filters: [{ name: 'Respaldo ZIP', extensions: ['zip'] }] });
  const archive = chosen.filePaths[0]; if (chosen.canceled || !archive) return null; const confirmation = await dialog.showMessageBox(provider()!, { type: 'warning', buttons: ['Restaurar','Cancelar'], defaultId: 1, cancelId: 1, message: 'La información actual será reemplazada.', detail: 'Antes se creará automáticamente un respaldo de la base actual.' });
  if (confirmation.response !== 0) return null; const temporary = await mkdtemp(join(app.getPath('temp'), 'sefiplan-restore-')); const automaticBackupPath = join(app.getPath('userData'), 'backups', `Antes_de_restaurar_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);
    if (dirname(temporary) !== app.getPath('temp') || !basename(temporary).startsWith('sefiplan-restore-')) throw new Error('Ruta temporal de restauración no válida.');
  const stage = join(dirname(databasePath), `restore-${randomUUID()}.sqlite`);
  try {
    await mkdir(dirname(automaticBackupPath), { recursive: true });
    const snapshot = join(temporary, 'before.sqlite');
    const source = new DatabaseService(databasePath);
    try { await source.connection.backup(snapshot); } finally { source.close(); }
    await new BackupService().create(snapshot, automaticBackupPath, databasePath);
    const restoredPath = await new BackupService().extractValidated(archive, temporary);
    await new BackupService().restoreReportFiles(restoredPath, databasePath);
    await copyFile(restoredPath, stage);
    const candidate = new DatabaseService(stage, { initialize: true });
    try {
      if (candidate.connection.pragma('integrity_check', { simple: true }) !== 'ok' || (candidate.connection.pragma('foreign_key_check') as unknown[]).length) throw new Error('La base del respaldo no supera la verificación de integridad.');
      const current = new DatabaseService(databasePath);
      try {
        new DeviceService(current.connection, app.getVersion()).preserveInRestoredDatabase(candidate.connection);
        new CatalogRepository(candidate.connection).requireVerification();
        new SyncOutboxService(candidate.connection).recoverInterrupted();
        new SyncOutboxService(candidate.connection).pause(null, true);
        const checkpoint = current.connection.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
        if (checkpoint.some(row => row.busy)) throw new Error('La base está ocupada. Intenta restaurar nuevamente.');
      } finally { current.close(); }
      candidate.connection.pragma('wal_checkpoint(TRUNCATE)');
    } finally { candidate.close(); }
    // No await between the last checkpoint and replacement: no main-process IPC
    // can open a connection here. Processing and sync are held by maintenance.
    rmSync(`${databasePath}-wal`, { force: true }); rmSync(`${databasePath}-shm`, { force: true });
    renameSync(stage, databasePath);
    return { restored: true, automaticBackupPath };
  } finally {
    await rm(stage, { force: true }); await rm(`${stage}-wal`, { force: true }); await rm(`${stage}-shm`, { force: true });
    await rm(temporary, { recursive: true, force: true });
  }
}

function resolveToken(registry: Map<string, string>, token: string, message: string): string { const value = registry.get(token); if (!value) throw new Error(message); return value; }
