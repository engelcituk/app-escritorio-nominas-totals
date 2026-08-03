import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { BrowserWindow } from 'electron';
import { BatchStatus, ProcessingStage } from '../../shared/enums/payroll.js';
import type { ProcessPayrollRequest, ProcessingProgress, ProcessResult } from '../../shared/types/payroll.js';
import { DatabaseService } from '../database/DatabaseService.js';
import { ExcelReportBuilder } from './ExcelReportBuilder.js';

interface ProcessPaths { filePath: string; outputDirectory: string }

export class ProcessingService {
  private readonly workers = new Map<string, Worker>();

  constructor(private readonly databasePath: string, private readonly getWindow: () => BrowserWindow | null) {}

  start(request: ProcessPayrollRequest, paths: ProcessPaths): string {
    const processId = randomUUID();
    const workerData = {
      processId,
      databasePath: this.databasePath,
      filePath: paths.filePath,
      year: request.year,
      fortnight: request.fortnight,
      payrollType: request.payrollType,
      exclusions: request.exclusions,
      ...(request.duplicateAction ? { duplicateAction: request.duplicateAction } : {}),
    };
    const worker = new Worker(new URL('../workers/PayrollProcessingWorker.js', import.meta.url), { workerData });
    this.workers.set(processId, worker);
    worker.on('message', (message: Record<string, unknown>) => void this.handleMessage(processId, paths.outputDirectory, message));
    worker.on('error', (error) => this.sendFailure(processId, null, this.friendlyMessage(error.message)));
    worker.on('exit', () => this.workers.delete(processId));
    return processId;
  }

  cancel(processId: string): boolean {
    const worker = this.workers.get(processId);
    if (!worker) return false;
    worker.postMessage({ type: 'cancel' });
    return true;
  }

  hasActiveProcesses(): boolean {
    return this.workers.size > 0;
  }

  private async handleMessage(processId: string, outputDirectory: string, message: Record<string, unknown>): Promise<void> {
    if (message.type === 'progress') {
      this.getWindow()?.webContents.send('payroll:progress', message.progress as ProcessingProgress);
      return;
    }
    if (message.type === 'cancelled') {
      const result: ProcessResult = {
        processId,
        batchId: Number(message.batchId),
        status: BatchStatus.CANCELLED,
        totalAmountCents: 0,
        totalLines: 0,
        validLines: 0,
        excludedLines: 0,
        invalidLines: 0,
      };
      this.getWindow()?.webContents.send('payroll:completed', result);
      return;
    }
    if (message.type === 'error') {
      this.sendFailure(processId, message.batchId === null ? null : Number(message.batchId), this.friendlyMessage(String(message.message)));
      return;
    }
    if (message.type !== 'processed') return;

    const batchId = Number(message.batchId);
    const dbService = new DatabaseService(this.databasePath);
    try {
      const batch = dbService.connection.prepare('SELECT * FROM payroll_batches WHERE id = ?').get(batchId) as Record<string, number>;
      this.sendSyntheticProgress(processId, ProcessingStage.BUILDING_DETAIL_REPORT, batch);
      const reports = await new ExcelReportBuilder(dbService.connection, outputDirectory).build(batchId);
      this.sendSyntheticProgress(processId, ProcessingStage.BUILDING_TOTALS_REPORT, batch);
      const persistedTotal = Number(batch.total_amount_cents);
      const difference = persistedTotal - reports.exportedTotal;
      const status = difference === 0 ? BatchStatus.COMPLETED : BatchStatus.FAILED_RECONCILIATION;
      dbService.connection.prepare(`UPDATE payroll_batches SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?`)
        .run(status, new Date().toISOString(), new Date().toISOString(), batchId);
      this.sendSyntheticProgress(processId, ProcessingStage.COMPLETED, batch);
      const result: ProcessResult = {
        processId,
        batchId,
        status,
        totalAmountCents: persistedTotal,
        totalLines: Number(batch.total_lines),
        validLines: Number(batch.valid_lines),
        excludedLines: Number(batch.excluded_lines),
        invalidLines: Number(batch.invalid_lines),
        detailReport: reports.detailPath,
        totalsReport: reports.totalsPath,
      };
      this.getWindow()?.webContents.send('payroll:completed', result);
    } catch (error) {
      dbService.connection.prepare(`UPDATE payroll_batches SET status = 'FAILED', updated_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), batchId);
      this.sendFailure(processId, batchId, this.friendlyMessage(error instanceof Error ? error.message : 'No se pudieron generar los reportes.'));
    } finally {
      dbService.close();
    }
  }

  private sendSyntheticProgress(processId: string, stage: ProcessingStage, batch: Record<string, number>): void {
    this.getWindow()?.webContents.send('payroll:progress', {
      processId, stage, bytesProcessed: 1, totalBytes: 1, percentage: stage === ProcessingStage.COMPLETED ? 100 : 99,
      linesProcessed: Number(batch.total_lines), validRecords: Number(batch.valid_lines), excludedRecords: Number(batch.excluded_lines),
      invalidRecords: Number(batch.invalid_lines), matchedRecords: Number(batch.matching_lines), elapsedMilliseconds: 0,
    } satisfies ProcessingProgress);
  }

  private sendFailure(processId: string, batchId: number | null, message: string): void {
    this.getWindow()?.webContents.send('payroll:failed', { processId, batchId, message });
  }

  private friendlyMessage(message: string): string {
    if (message.startsWith('DUPLICATE_FILE:')) return `Este archivo ya fue procesado (lote ${message.split(':')[1]}).`;
    if (message.startsWith('DUPLICATE_PERIOD:')) return `El periodo seleccionado ya tiene un procesamiento registrado (lote ${message.split(':')[1]}).`;
    if (/EBUSY|EPERM|locked/i.test(message)) return 'No se pudo generar el reporte porque el archivo de destino está abierto en Excel.';
    return message.replace(/^Error:\s*/i, '') || 'No se pudo completar el procesamiento.';
  }
}
