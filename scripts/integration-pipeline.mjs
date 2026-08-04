import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { DatabaseService } from '../dist/main/database/DatabaseService.js';
import { ExcelReportBuilder } from '../dist/main/services/ExcelReportBuilder.js';
import { BackupService } from '../dist/main/services/BackupService.js';

const root = await mkdtemp(join(tmpdir(), 'sefiplan-integration-'));
try {
  const databasePath = join(root, 'integration.sqlite');
  const outputDirectory = join(root, 'reportes');
  const processId = randomUUID();
  const worker = new Worker(new URL('../dist/main/workers/PayrollProcessingWorker.js', import.meta.url), {
    workerData: {
      processId,
      databasePath,
      filePath: resolve('tests/fixtures/uniform-isr.txt'),
      year: 2026,
      fortnight: 11,
      payrollType: 'SUELDOS',
      exclusions: { retained: true, cancelled: true, other: true, includeAudit: true },
    },
  });
  const processed = await new Promise((resolveMessage, reject) => {
    worker.on('message', (message) => {
      if (message.type === 'processed') resolveMessage(message);
      if (message.type === 'error') reject(new Error(message.message));
    });
    worker.on('error', reject);
  });
  const db = new DatabaseService(databasePath);
  const batch = db.connection.prepare('SELECT * FROM payroll_batches WHERE id = ?').get(processed.batchId);
  if (batch.valid_lines !== 2 || batch.unclassified_lines !== 1 || batch.invalid_lines !== 0 || batch.total_amount_cents !== 204055) {
    throw new Error(`Totales inesperados: ${JSON.stringify(batch)}`);
  }
  const reports = await new ExcelReportBuilder(db.connection, outputDirectory).build(processed.batchId);
  if (reports.exportedTotal !== batch.total_amount_cents) throw new Error('La suma exportada no concilia.');
  await stat(reports.detailPath);
  await stat(reports.totalsPath);
  const snapshot = join(root, 'snapshot.sqlite');
  await db.connection.backup(snapshot);
  const backupPath = join(root, 'respaldo.zip');
  const backupService = new BackupService();
  await backupService.create(snapshot, backupPath);
  const restoreDirectory = await mkdtemp(join(root, 'restore-'));
  const restoredPath = await backupService.extractValidated(backupPath, restoreDirectory);
  const restoredDatabase = new DatabaseService(restoredPath);
  const restoredCount = restoredDatabase.connection.prepare('SELECT COUNT(*) AS count FROM payroll_batches').get().count;
  restoredDatabase.close();
  if (restoredCount !== 1) throw new Error('El respaldo restaurado no conserva el lote.');
  db.close();
  console.log(JSON.stringify({ batchId: processed.batchId, validLines: batch.valid_lines, totalAmountCents: batch.total_amount_cents,
    detailReport: reports.detailPath, totalsReport: reports.totalsPath, backupValidated: true }));
} finally {
  await rm(root, { recursive: true, force: true });
  process.exitCode = 0;
}
