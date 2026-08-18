import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import type { BrowserWindow } from 'electron';
import { BatchStatus } from '../../shared/enums/payroll.js';
import type { ProcessImportGroupRequest, ProcessingProgress, ProcessResult } from '../../shared/types/payroll.js';
import { DatabaseService } from '../database/DatabaseService.js';
import { ExcelReportBuilder } from './ExcelReportBuilder.js';
import { GroupReportBuilder } from './GroupReportBuilder.js';

interface GroupPaths { files: Array<{ filePath: string; name: string }>; outputDirectory: string }
interface WorkerResult { batchId: number; counters: Record<string, number>; totalAmountCents: number }

export class ProcessingService {
  private readonly workers = new Map<string, Worker>(); private readonly cancelled = new Set<string>();
  private readonly pausedGroups = new Map<number, { request: ProcessImportGroupRequest; paths: GroupPaths; nextIndex: number; batchIds: number[] }>();
  constructor(private readonly databasePath: string, private readonly getWindow: () => BrowserWindow | null) {}

  start(request: ProcessImportGroupRequest, paths: GroupPaths): string {
    const processId = randomUUID(); const groupId = this.createGroup(request); void this.runGroup(processId, groupId, request, paths); return processId;
  }
  cancel(processId: string): boolean { if (!this.workers.has(processId) && !this.cancelled.has(processId)) return false;
    this.cancelled.add(processId); this.workers.get(processId)?.postMessage({ type: 'cancel' }); return true; }
  resume(groupId: number): string {
    const paused = this.pausedGroups.get(groupId); if (!paused) throw new Error('El expediente no puede reanudarse en esta sesión; vuelve a seleccionar los archivos.');
    const service = new DatabaseService(this.databasePath);
    try { service.connection.transaction(() => {
      service.connection.prepare(`UPDATE import_groups SET status='PROCESSING', updated_at=? WHERE id=?`).run(new Date().toISOString(), groupId);
      this.logAudit(service.connection, 'RESUME', groupId, 'Se reanudó el procesamiento del expediente.'); })(); } finally { service.close(); }
    const processId = randomUUID(); void this.runGroup(processId, groupId, paused.request, paused.paths, paused.nextIndex, [...paused.batchIds]); return processId;
  }
  hasActiveProcesses(): boolean { return this.workers.size > 0; }

  private createGroup(request: ProcessImportGroupRequest): number {
    const service = new DatabaseService(this.databasePath);
    try {
      const previousRow = request.replacedGroupId
        ? service.connection.prepare('SELECT id, version FROM import_groups WHERE id=?').get(request.replacedGroupId) : undefined;
      const previous = previousRow as { id: number; version: number } | undefined;
      if (request.replacedGroupId && !previous) throw new Error('No se encontró el expediente que se desea reemplazar.');
      const now = new Date().toISOString(); const version = previous ? previous.version + 1 : 1;
      const id = Number(service.connection.prepare(`INSERT INTO import_groups(year,version,status,file_count,replaced_group_id,started_at,created_at,updated_at)
        VALUES (?,?,'PROCESSING',?,?,?,?,?)`).run(request.year, version, request.files.length, previous?.id ?? null, now, now, now).lastInsertRowid);
      this.logAudit(service.connection, 'CREATE', id, 'Se creó el expediente de importación.', { year: request.year, version, files: request.files.length });
      return id;
    } finally { service.close(); }
  }

  private async runGroup(processId: string, groupId: number, request: ProcessImportGroupRequest, paths: GroupPaths,
    startIndex = 0, batchIds: number[] = []): Promise<void> {
    const totalBytes = paths.files.reduce((sum, file) => sum + statSync(file.filePath).size, 0); let completedBytes = 0;
    const completed = { lines: 0, valid: 0, excluded: 0, invalid: 0, matched: 0 };
    try {
      for (let index = startIndex; index < request.files.length; index += 1) {
        if (this.cancelled.has(processId)) throw new Error('GROUP_CANCELLED');
        const file = request.files[index]!; const path = paths.files[index]!;
        const result = await this.runWorker(processId, { processId, groupId, sourceOrder: index + 1, databasePath: this.databasePath,
          filePath: path.filePath, year: request.year, fortnight: file.fortnight, payrollType: file.payrollType,
          selectedConceptIds: file.selectedConceptIds, retainedEmployeeNumbers: file.retainedEmployeeNumbers,
          missingAcknowledged: file.missingAcknowledged, ...(file.duplicateDecision ? { duplicateDecision: file.duplicateDecision } : {}) }, (progress) => {
          const size = statSync(path.filePath).size;
          const aggregate: ProcessingProgress = { ...progress, groupId, activeFileIndex: index + 1, totalFiles: request.files.length,
            activeFilename: path.name, totalBytes, bytesProcessed: completedBytes + Math.min(progress.bytesProcessed, size),
            percentage: totalBytes ? Math.round(((completedBytes + Math.min(progress.bytesProcessed, size)) / totalBytes) * 10000) / 100 : 0,
            linesProcessed: completed.lines + progress.linesProcessed, validRecords: completed.valid + progress.validRecords,
            excludedRecords: completed.excluded + progress.excludedRecords, invalidRecords: completed.invalid + progress.invalidRecords,
            matchedRecords: completed.matched + progress.matchedRecords };
          this.getWindow()?.webContents.send('payroll:progress', aggregate);
        });
        batchIds.push(result.batchId);
        const service = new DatabaseService(this.databasePath);
        try {
          const batch = service.connection.prepare('SELECT * FROM payroll_batches WHERE id=?').get(result.batchId) as Record<string, number>;
          const reports = await new ExcelReportBuilder(service.connection, paths.outputDirectory).build(result.batchId, path.filePath);
          const status = Number(batch.total_amount_cents) === reports.exportedTotal ? BatchStatus.COMPLETED : BatchStatus.FAILED_RECONCILIATION;
          const now = new Date().toISOString(); service.connection.prepare(`UPDATE payroll_batches SET status=?,completed_at=?,updated_at=? WHERE id=?`)
            .run(status, now, now, result.batchId);
          if (status !== BatchStatus.COMPLETED) throw new Error('La conciliación individual no terminó en cero.');
          const replacedId = Number(batch.replaced_batch_id ?? 0);
          if (replacedId) service.connection.prepare(`UPDATE payroll_batches SET status='SUPERSEDED',updated_at=? WHERE id=?`).run(now, replacedId);
          this.refreshGroup(service, groupId);
        } catch (cause) { service.connection.prepare(`UPDATE payroll_batches SET status='FAILED',updated_at=? WHERE id=?`)
          .run(new Date().toISOString(), result.batchId); batchIds.pop(); throw cause; } finally { service.close(); }
        completed.lines += Number(result.counters.total ?? 0); completed.valid += Number(result.counters.valid ?? 0);
        completed.excluded += Number(result.counters.excluded ?? 0); completed.invalid += Number(result.counters.invalid ?? 0);
        completed.matched += Number(result.counters.matched ?? 0); completedBytes += statSync(path.filePath).size;
      }

      const service = new DatabaseService(this.databasePath); let report = ''; let total: Record<string, number>;
      try {
        this.refreshGroup(service, groupId); total = service.connection.prepare('SELECT * FROM import_groups WHERE id=?').get(groupId) as Record<string, number>;
        report = await new GroupReportBuilder(service.connection, paths.outputDirectory).build(groupId); const now = new Date().toISOString();
        service.connection.prepare(`UPDATE import_groups SET status='COMPLETED',completed_at=?,updated_at=? WHERE id=?`).run(now, now, groupId);
        const replacedGroupId = Number(total.replaced_group_id ?? 0);
        if (replacedGroupId) service.connection.prepare(`UPDATE import_groups SET status='SUPERSEDED',updated_at=? WHERE id=?`).run(now, replacedGroupId);
        this.logAudit(service.connection, 'COMPLETE', groupId, 'El expediente terminó correctamente.', { batches: batchIds.length,
          totalAmountCents: Number(total.total_amount_cents) });
      } finally { service.close(); }
      const result: ProcessResult = { processId, groupId, batchIds, batchId: batchIds.at(-1) ?? 0, status: BatchStatus.COMPLETED,
        totalAmountCents: Number(total!.total_amount_cents), totalLines: Number(total!.total_lines), validLines: Number(total!.valid_lines),
        excludedLines: Number(total!.excluded_lines), invalidLines: Number(total!.invalid_lines), groupReport: report };
      this.getWindow()?.webContents.send('payroll:completed', result); this.pausedGroups.delete(groupId);
    } catch (error) {
      const message = this.friendlyMessage(error instanceof Error ? error.message : 'No se pudo completar el expediente.');
      const service = new DatabaseService(this.databasePath);
      try { this.refreshGroup(service, groupId); const count = (service.connection.prepare(`SELECT COUNT(*) AS count FROM payroll_batches
        WHERE group_id=? AND status='COMPLETED'`).get(groupId) as { count: number }).count;
        const status = this.cancelled.has(processId) ? 'CANCELLED' : count ? 'PARTIAL' : 'FAILED';
        service.connection.prepare(`UPDATE import_groups SET status=?,updated_at=? WHERE id=?`).run(status, new Date().toISOString(), groupId);
        this.logAudit(service.connection, status, groupId, status === 'CANCELLED' ? 'Se canceló el expediente.' : 'El expediente quedó incompleto.',
          { completedBatches: count, error: message }); } finally { service.close(); }
      this.getWindow()?.webContents.send('payroll:failed', { processId, groupId, batchId: batchIds.at(-1) ?? null, message });
      if (!this.cancelled.has(processId)) this.pausedGroups.set(groupId, { request, paths, nextIndex: batchIds.length, batchIds: [...batchIds] });
    } finally { this.workers.delete(processId); this.cancelled.delete(processId); }
  }

  private runWorker(processId: string, data: Record<string, unknown>, onProgress: (value: ProcessingProgress) => void): Promise<WorkerResult> {
    return new Promise((resolve, reject) => { const worker = new Worker(new URL('../workers/PayrollProcessingWorker.js', import.meta.url), { workerData: data });
      this.workers.set(processId, worker); worker.on('message', (message: Record<string, unknown>) => {
        if (message.type === 'progress') onProgress(message.progress as ProcessingProgress);
        else if (message.type === 'processed') resolve(message as unknown as WorkerResult);
        else if (message.type === 'cancelled') reject(new Error('GROUP_CANCELLED'));
        else if (message.type === 'error') reject(new Error(String(message.message))); });
      worker.on('error', reject); worker.on('exit', (code) => { if (code !== 0) reject(new Error(`El procesador terminó con código ${code}.`)); }); });
  }

  private refreshGroup(service: DatabaseService, groupId: number): void {
    const totals = service.connection.prepare(`SELECT SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN total_lines ELSE 0 END),0) AS lines,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN valid_lines ELSE 0 END),0) AS valid,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN excluded_lines ELSE 0 END),0) AS excluded,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN invalid_lines ELSE 0 END),0) AS invalid,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN total_amount_cents ELSE 0 END),0) AS total FROM payroll_batches WHERE group_id=?`)
      .get(groupId) as Record<string, number>;
    service.connection.prepare(`UPDATE import_groups SET completed_files=?,total_lines=?,valid_lines=?,excluded_lines=?,invalid_lines=?,
      total_amount_cents=?,updated_at=? WHERE id=?`).run(totals.completed, totals.lines, totals.valid, totals.excluded, totals.invalid,
      totals.total, new Date().toISOString(), groupId);
  }
  private logAudit(database: DatabaseService['connection'], action: string, groupId: number, description: string, metadata?: Record<string, unknown>): void {
    database.prepare(`INSERT INTO audit_logs(action,entity_type,entity_id,description,metadata_json,created_at) VALUES (?,'IMPORT_GROUP',?,?,?,?)`)
      .run(action, String(groupId), description, metadata ? JSON.stringify(metadata) : null, new Date().toISOString());
  }
  private friendlyMessage(message: string): string {
    if (message.startsWith('DUPLICATE_FILE:')) return `Este archivo ya fue procesado en el lote ${message.split(':')[1]}. Retíralo o autoriza su reproceso.`;
    if (message === 'DUPLICATE_IN_GROUP') return 'El mismo contenido aparece dos veces dentro del expediente.';
    if (message === 'GROUP_CANCELLED') return 'El procesamiento del expediente fue cancelado.';
    if (/EBUSY|EPERM|locked/i.test(message)) return 'No se pudo generar el reporte porque el archivo de destino está abierto en Excel.';
    return message.replace(/^Error:\s*/i, '') || 'No se pudo completar el procesamiento.';
  }
}
