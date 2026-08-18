import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import ExcelJS from 'exceljs';
import { app } from 'electron';
import { DatabaseService } from '../dist/main/database/DatabaseService.js';
import { ExcelReportBuilder } from '../dist/main/services/ExcelReportBuilder.js';
import { BackupService } from '../dist/main/services/BackupService.js';
import { GroupReportBuilder } from '../dist/main/services/GroupReportBuilder.js';

app.disableHardwareAcceleration();

const root = await mkdtemp(join(tmpdir(), 'sefiplan-integration-'));
try {
  const databasePath = join(root, 'integration.sqlite');
  const outputDirectory = join(root, 'reportes');
  const processId = randomUUID();
  const setup = new DatabaseService(databasePath);
  const now = new Date().toISOString();
  const seeded = setup.connection.prepare(`SELECT c.id, c.name, c.operation_factor AS operationFactor, g.code AS groupCode
    FROM payroll_concepts c LEFT JOIN concept_groups g ON g.id=c.group_id
    WHERE c.code='ISR_POR_SALARIOS'`).get();
  const refund = setup.connection.prepare(`SELECT operation_factor AS operationFactor FROM payroll_concepts
    WHERE code='REINTEGRO_DE_ISR_PAGADO_EN_EXCESO'`).get();
  if (!seeded || seeded.name !== 'ISR POR SALARIOS' || seeded.groupCode !== 'ISR' || seeded.operationFactor !== 1 || refund?.operationFactor !== -1) {
    throw new Error('El catálogo inicial no contiene las operaciones y el grupo ISR esperados.');
  }
  const malformedUtf8 = setup.connection.prepare(`SELECT COUNT(*) AS count FROM payroll_concepts WHERE instr(name, char(195)) > 0`).get().count;
  if (malformedUtf8 !== 0) throw new Error('El catálogo contiene texto con codificación UTF-8 dañada.');
  const groupId = Number(setup.connection.prepare(`INSERT INTO import_groups(year, version, status,
    file_count, started_at, created_at, updated_at) VALUES (2026, 1, 'PROCESSING', 1, ?, ?, ?)`)
    .run(now, now, now).lastInsertRowid);
  setup.connection.prepare(`UPDATE payroll_concepts SET name='I S R POR SALARIOS' WHERE id=?`).run(seeded.id);
  setup.close();
  const repaired = new DatabaseService(databasePath);
  const repairedName = repaired.connection.prepare('SELECT name FROM payroll_concepts WHERE id=?').get(seeded.id).name;
  repaired.close();
  if (repairedName !== 'ISR POR SALARIOS') throw new Error('La base existente no corrigió el nombre canónico del concepto ISR.');
  const worker = new Worker(new URL('../dist/main/workers/PayrollProcessingWorker.js', import.meta.url), {
    workerData: {
      processId,
      groupId,
      sourceOrder: 1,
      databasePath,
      filePath: resolve('tests/fixtures/uniform-isr.txt'),
      year: 2026,
      fortnight: 11,
      payrollType: 'SUELDOS',
      selectedConceptIds: [seeded.id],
      retainedEmployeeNumbers: [],
      missingAcknowledged: false,
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
  const recordsTable = db.connection.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payroll_records'`).get();
  if (recordsTable) throw new Error('El esquema no debe contener payroll_records.');
  const batch = db.connection.prepare('SELECT * FROM payroll_batches WHERE id = ?').get(processed.batchId);
  if (batch.valid_lines !== 2 || batch.excluded_lines !== 1 || batch.unclassified_lines !== 0
    || batch.invalid_lines !== 0 || batch.total_amount_cents !== 204055) {
    throw new Error(`Totales inesperados: ${JSON.stringify(batch)}`);
  }
  const reports = await new ExcelReportBuilder(db.connection, outputDirectory).build(processed.batchId,
    resolve('tests/fixtures/uniform-isr.txt'));
  if (reports.exportedTotal !== batch.total_amount_cents) throw new Error('La suma exportada no concilia.');
  db.connection.prepare(`UPDATE payroll_batches SET status='COMPLETED', completed_at=?, updated_at=? WHERE id=?`).run(now, now, processed.batchId);
  db.connection.prepare(`UPDATE import_groups SET status='COMPLETED', completed_files=1, total_lines=?, valid_lines=?,
    excluded_lines=?, invalid_lines=?, total_amount_cents=?, completed_at=?, updated_at=? WHERE id=?`)
    .run(batch.total_lines, batch.valid_lines, batch.excluded_lines, batch.invalid_lines, batch.total_amount_cents, now, now, groupId);
  const groupReport = await new GroupReportBuilder(db.connection, outputDirectory).build(groupId);
  await stat(groupReport);
  await stat(reports.detailPath);
  await stat(reports.totalsPath);
  const detailWorkbook = new ExcelJS.Workbook();
  await detailWorkbook.xlsx.readFile(reports.detailPath);
  const detail = detailWorkbook.getWorksheet('Detalle');
  if (detail?.getCell('E1').value !== 'Número de empleado' || detail.getCell('E2').value !== '1001'
    || detail.getCell('L1').value !== 'Nombre del empleado' || detail.getCell('L2').value !== 'PERSONA UNO'
    || detail.getCell('U1').value !== 'Fuente de financiamiento' || detail.getCell('V1').value !== 'Centro de pago'
    || detail.rowCount !== 3) {
    throw new Error('El detalle no conserva las columnas operativas ni únicamente los movimientos totalizados.');
  }
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
    detailReport: reports.detailPath, totalsReport: reports.totalsPath, groupReport, backupValidated: true, recordsPersisted: false }));
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  app.quit();
}
