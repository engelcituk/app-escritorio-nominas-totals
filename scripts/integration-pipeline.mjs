import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import ExcelJS from 'exceljs';
import Database from 'better-sqlite3';
import { app, safeStorage } from 'electron';
import { DatabaseService } from '../dist/main/database/DatabaseService.js';
import { MIGRATIONS } from '../dist/main/database/migrations.js';
import { MigrationService } from '../dist/main/database/MigrationService.js';
import { ExcelReportBuilder } from '../dist/main/services/ExcelReportBuilder.js';
import { MonthlyReportBuilder } from '../dist/main/services/MonthlyReportBuilder.js';
import { DeviceService } from '../dist/main/services/central/DeviceService.js';
import { SecureTokenStore } from '../dist/main/services/central/SecureTokenStore.js';

app.disableHardwareAcceleration();

// Do not await app.whenReady at ESM top level: Electron waits for module evaluation.
void runIntegration().then(() => app.quit(), (error) => { console.error(error); app.exit(1); });

async function runIntegration() {
const root = await mkdtemp(join(tmpdir(), 'sefiplan-monthly-integration-'));
try {
  app.setPath('userData', root);
  await app.whenReady();
  await verifyIdentityAndSecureStorage(root);
  const databasePath = join(root, 'integration.sqlite');
  const outputDirectory = join(root, 'reportes');
  const fixture = await readFile(resolve('tests/fixtures/uniform-isr.txt'), 'utf8');
  const q13Path = join(root, 'QNA_13_2026_SUELDOS.txt');
  const q14Path = join(root, 'QNA_14_2026_SUELDOS.txt');
  const q13ReplacementPath = join(root, 'QNA_13_2026_SUELDOS_CORREGIDO.txt');
  const q13FailedPath = join(root, 'QNA_13_2026_SUELDOS_FALLIDO.txt');
  await writeFile(q13Path, fixture, 'utf8');
  await writeFile(q14Path, fixture.replaceAll('PERSONA ', 'PERSONA Q14 '), 'utf8');
  await writeFile(q13ReplacementPath, fixture.replace('790,20', '800,20'), 'utf8');
  await writeFile(q13FailedPath, fixture.replace('790,20', '810,20'), 'utf8');

  const setup = new DatabaseService(databasePath);
  const now = new Date().toISOString();
  const concept = setup.connection.prepare(`SELECT c.id,c.name,c.operation_factor operationFactor,g.id groupId,g.code groupCode
    FROM payroll_concepts c JOIN concept_groups g ON g.id=c.group_id WHERE c.code='ISR_POR_SALARIOS'`).get();
  const refund = setup.connection.prepare(`SELECT operation_factor operationFactor FROM payroll_concepts
    WHERE code='REINTEGRO_DE_ISR_PAGADO_EN_EXCESO'`).get();
  const payrollTypes = setup.connection.prepare('SELECT id,code,name,sort_order FROM payroll_types ORDER BY sort_order').all();
  if (!concept || concept.name !== 'ISR POR SALARIOS' || concept.groupCode !== 'ISR' || concept.operationFactor !== 1 || refund?.operationFactor !== -1) {
    throw new Error('El catálogo inicial no contiene el grupo ISR y sus operaciones firmadas.');
  }
  const expectedTypes = ['SUELDOS','COMPENSACION','PAGOS_DIVERSOS','REEXPEDICION_NOMINA','FONDO_AHORRO','ESTIMULO_DIA_MADRES',
    'PRIMA_VACACIONAL_1','NOMINA_ESTIMULOS_ANOS_SERVICIO','ESTIMULO_DIA_EMPLEADO_ESTATAL','ESTIMULO_DIA_PADRE',
    'PAGOS_DIVERSOS_COMPLEMENTARIA','VALES_ESCOLARES','VALES_UTILES_ESCOLARES_MOCHILA','CANASTA_NAVIDENA','APOYO_DESPENSA_FIN_ANO',
    'VALES_PAVO_NAVIDENO','MOCHILAS_ESCOLARES','AGUINALDO_1','AGUINALDO_2','AGUINALDO_COMPENSACION','PRIMA_VACACIONAL_2',
    'AGUINALDO_ASIMILADOS_SALARIOS','BONO_NAVIDENO','ESTIMULO_DIA_POLICIA','LAUDOS','ESTIMULOS_EXTRAORDINARIOS',
    'NOMINA_EXTRAORDINARIA_SUELDOS','NOMINA_EXTRAORDINARIA_COMPENSACIONES','REEXPEDICION_NOMINA_COMPLEMENTARIA',
    'ESTIMULOS_EXTRAORDINARIOS_COMPLEMENTARIA'];
  if (payrollTypes.length !== expectedTypes.length || expectedTypes.some((code,index) => payrollTypes[index]?.code !== code)) {
    throw new Error('El catálogo inicial de tipos de nómina está incompleto.');
  }
  if (payrollTypes[0].name !== 'Nómina ordinaria' || payrollTypes[0].sort_order !== 1 || payrollTypes[29].sort_order !== 30) {
    throw new Error('El catálogo inicial de tipos de nómina no conserva nombres y orden institucionales.');
  }
  const typeId = (code) => payrollTypes.find((type) => type.code === code).id;
  const reconciliationId = Number(setup.connection.prepare(`INSERT INTO monthly_reconciliations
    (year,month,concept_group_id,status,started_at,created_at,updated_at) VALUES (2026,7,?,'DRAFT',?,?,?)`)
    .run(concept.groupId, now, now, now).lastInsertRowid);
  setup.close();

  const first = await processBatch({ databasePath, outputDirectory, reconciliationId, filePath: q13Path, fortnight: 13,
    payrollTypeId: typeId('SUELDOS'), selectedConceptIds: [concept.id], retainedEmployeeNumbers: ['1001'], replaceActiveBatch: false });
  const second = await processBatch({ databasePath, outputDirectory, reconciliationId, filePath: q14Path, fortnight: 14,
    payrollTypeId: typeId('SUELDOS'), selectedConceptIds: [concept.id], retainedEmployeeNumbers: ['1001'], replaceActiveBatch: false });
  if (first.monthlyReport !== second.monthlyReport) throw new Error('La segunda quincena no actualizó la misma ruta mensual.');
  const replacement = await processBatch({ databasePath, outputDirectory, reconciliationId, filePath: q13ReplacementPath, fortnight: 13,
    payrollTypeId: typeId('SUELDOS'), selectedConceptIds: [concept.id], retainedEmployeeNumbers: [], replaceActiveBatch: true });
  if (replacement.monthlyReport !== first.monthlyReport) throw new Error('El reemplazo creó otra versión del reporte mensual.');
  const beforeFailure = new DatabaseService(databasePath);
  const stableArtifactHash = beforeFailure.connection.prepare(`SELECT file_hash_sha256 FROM report_artifacts
    WHERE reconciliation_id=? AND report_type='MONTHLY_TOTALS'`).get(reconciliationId).file_hash_sha256;
  beforeFailure.close();
  const blockedOutput = join(root, 'salida-bloqueada');
  await writeFile(blockedOutput, 'No es una carpeta.', 'utf8');
  let replacementFailed = false;
  try {
    await processBatch({ databasePath, outputDirectory: blockedOutput, reconciliationId, filePath: q13FailedPath, fortnight: 13,
      payrollTypeId: typeId('SUELDOS'), selectedConceptIds: [concept.id], retainedEmployeeNumbers: [], replaceActiveBatch: true });
  } catch {
    replacementFailed = true;
  }
  if (!replacementFailed) throw new Error('La prueba no consiguió provocar el fallo controlado de reemplazo.');

  const db = new DatabaseService(databasePath);
  const active = db.connection.prepare(`SELECT pb.*,pt.code payroll_type_code FROM payroll_batches pb JOIN payroll_types pt ON pt.id=pb.payroll_type_id
    WHERE pb.reconciliation_id=? AND pb.is_active=1 ORDER BY pb.fortnight`).all(reconciliationId);
  const old = db.connection.prepare('SELECT status,is_active FROM payroll_batches WHERE id=?').get(first.batchId);
  const rec = db.connection.prepare('SELECT * FROM monthly_reconciliations WHERE id=?').get(reconciliationId);
  const totalFromActive = db.connection.prepare(`SELECT COALESCE(SUM(bt.total_amount_cents),0) total FROM batch_totals bt
    JOIN payroll_batches pb ON pb.id=bt.batch_id WHERE pb.reconciliation_id=? AND pb.is_active=1 AND pb.status='COMPLETED'`).get(reconciliationId).total;
  if (active.length !== 2 || active[0].fortnight !== 13 || active[0].version !== 2 || active[1].fortnight !== 14) {
    throw new Error(`La matriz activa no conserva una versión por quincena y tipo: ${JSON.stringify(active)}`);
  }
  if (old.status !== 'SUPERSEDED' || old.is_active !== 0) throw new Error('La versión anterior no quedó sustituida.');
  if (rec.total_amount_cents !== totalFromActive || rec.total_amount_cents !== 330090) {
    throw new Error(`El total mensual no concilia contra lotes activos: ${JSON.stringify({ rec: rec.total_amount_cents, totalFromActive })}`);
  }
  const retainedByBatch = db.connection.prepare(`SELECT batch_id,employee_number,found_records,excluded_records
    FROM batch_retained_employees ORDER BY batch_id`).all();
  if (retainedByBatch.length !== 2 || retainedByBatch.some((item) => item.found_records !== 2 || item.excluded_records !== 2)) {
    throw new Error('Los retenidos no se conservaron de forma independiente por TXT.');
  }
  const activeRetained = db.connection.prepare(`SELECT SUM(rt.record_count) records,SUM(rt.amount_cents) amount
    FROM batch_retained_totals rt JOIN payroll_batches pb ON pb.id=rt.batch_id
    WHERE pb.reconciliation_id=? AND pb.is_active=1 AND pb.status='COMPLETED'`).get(reconciliationId);
  if (activeRetained.records !== 2 || activeRetained.amount !== 379020) {
    throw new Error(`El resumen de retenidos volvió a filtrar conceptos: ${JSON.stringify(activeRetained)}`);
  }
  const monthlyArtifacts = db.connection.prepare(`SELECT * FROM report_artifacts WHERE reconciliation_id=? AND report_type='MONTHLY_TOTALS'`).all(reconciliationId);
  if (monthlyArtifacts.length !== 1 || monthlyArtifacts[0].file_path !== replacement.monthlyReport
    || monthlyArtifacts[0].file_hash_sha256 !== stableArtifactHash) {
    throw new Error('El artefacto mensual vigente no se actualizó mediante upsert.');
  }
  const failedCandidate = db.connection.prepare(`SELECT status,is_active FROM payroll_batches WHERE reconciliation_id=? AND version=3
    AND fortnight=13 AND payroll_type_id=?`).get(reconciliationId, typeId('SUELDOS'));
  if (failedCandidate?.status !== 'FAILED' || failedCandidate.is_active !== 0 || active[0].id !== replacement.batchId) {
    throw new Error('El fallo de reemplazo no conservó intactos el lote y reporte anteriores.');
  }
  await stat(replacement.monthlyReport);
  await stat(first.sourcePath);
  await stat(second.sourcePath);
  await stat(replacement.sourcePath);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(replacement.monthlyReport);
  const expectedSheets = ['Resumen mensual','Por nómina','Desglose agrupado','Resumen retenidos','Retenidos'];
  if (workbook.worksheets.map((sheet) => sheet.name).join('|') !== expectedSheets.join('|')) {
    throw new Error(`El workbook mensual no contiene las hojas requeridas: ${workbook.worksheets.map((sheet) => sheet.name).join(', ')}`);
  }
  const summary = workbook.getWorksheet('Resumen mensual');
  const exportedMonthlyTotal = Number(summary?.lastRow?.getCell(summary.lastRow.cellCount).value);
  if (exportedMonthlyTotal !== rec.total_amount_cents / 100) {
    throw new Error(`El total mensual exportado no concilia: ${exportedMonthlyTotal}.`);
  }
  const retainedSummary = workbook.getWorksheet('Resumen retenidos');
  const exportedRetainedTotal = Number(retainedSummary?.lastRow?.getCell(retainedSummary.lastRow.cellCount).value);
  if (exportedRetainedTotal !== activeRetained.amount / 100) {
    throw new Error(`El total retenido exportado no concilia: ${exportedRetainedTotal}.`);
  }
  const retainedDetail = workbook.getWorksheet('Retenidos');
  if (retainedDetail?.getCell('F4').value !== 'Movimientos retenidos' || retainedDetail.getCell('F5').value !== 2
    || retainedDetail.getCell('G4').value || retainedDetail.getCell('H4').value) {
    throw new Error('La hoja Retenidos no presenta el detalle simplificado solicitado.');
  }
  const sourceWorkbook = new ExcelJS.Workbook();
  await sourceWorkbook.xlsx.readFile(replacement.sourcePath);
  const source = sourceWorkbook.getWorksheet('Contenido TXT');
  if (source?.getCell('I1').value !== 'Fuente' || source.getCell('I2').value !== '1508-26-001'
    || source.getCell('J1').value !== 'Número de empleado' || source.getCell('J2').value !== '1001'
    || source.getCell('K1').value !== 'Número de plaza'
    || source.getCell('U1').value !== 'Fuente de financiamiento' || source.getCell('V1').value !== 'Centro de pago') {
    throw new Error('TXT Completo no presenta Fuente separada del campo técnico de financiamiento.');
  }
  if (![first.sourcePath, second.sourcePath, replacement.sourcePath].every((path) => /_L1\.xlsx$/.test(path))) {
    throw new Error('El nombre del TXT Completo no identifica correctamente la versión del layout.');
  }
  const files = await listFiles(outputDirectory);
  const expectedDirectory = join(outputDirectory,'2026','M07','ISR');
  const xlsxFiles = files.filter((file) => file.endsWith('.xlsx'));
  if ([first.sourcePath,second.sourcePath,replacement.sourcePath,replacement.monthlyReport].some((file) => dirname(file) !== expectedDirectory)) {
    throw new Error('Los reportes no quedaron reunidos en la carpeta mensual del grupo.');
  }
  if (xlsxFiles.some((file) => !/^(TXT_Completo_|Totales_ISR_)/.test(basename(file)))) {
    throw new Error(`Se generó un tipo de reporte no solicitado: ${xlsxFiles.map((file) => basename(file)).join(', ')}.`);
  }
  db.close();
  console.log(JSON.stringify({ reconciliationId, activeBatches: active.map((item) => item.id), monthlyTotalCents: rec.total_amount_cents,
    monthlyReport: replacement.monthlyReport, sourceReports: [first.sourcePath, second.sourcePath, replacement.sourcePath],
    workbookSheets: expectedSheets, exportedMonthlyTotal, failedReplacementPreserved: true, reportTypes: ['TXT_COMPLETO','TOTALES_MENSUALES'] }));
} finally {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sefiplan-monthly-integration-'));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
}

async function verifyIdentityAndSecureStorage(directory) {
  const path = join(directory, 'identity-v1.sqlite');
  const database = new Database(path);
  let installationUuid;
  try {
    database.pragma('foreign_keys=ON');
    database.exec(MIGRATIONS[0].sql);
    database.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(1,?,?)').run(MIGRATIONS[0].name, '2026-08-26T00:00:00Z');
    database.prepare('INSERT INTO concept_groups(id,code,name,created_at,updated_at) VALUES(42,?,?,?,?)')
      .run('CUSTOM', 'Grupo personalizado', 't', 't');
    new MigrationService(database).run();
    const devices = new DeviceService(database, '0.1.0');
    const initial = devices.ensureIdentity();
    installationUuid = initial.installationUuid;
    assert.equal(initial.deviceUuid, null);
    assert.equal(devices.ensureIdentity().installationUuid, installationUuid);
    const prepared = devices.prepareRegistration('https://nomina.example');
    assert.notEqual(prepared.deviceUuid, installationUuid);
    assert.equal(prepared.registeredAt, null);
    assert.equal(new DeviceService(database, '0.1.0').prepareRegistration('https://nomina.example').deviceUuid, prepared.deviceUuid);
    assert.throws(() => devices.prepareRegistration('https://other.example'));
    const registration = { installationUuid, deviceUuid: prepared.deviceUuid, deviceName: 'Equipo de prueba', apiOrigin: 'https://nomina.example' };
    assert.equal(devices.acceptRegistration(registration).deviceUuid, registration.deviceUuid);
    assert.throws(() => devices.acceptRegistration({ ...registration, installationUuid: randomUUID() }));
    assert.throws(() => devices.acceptRegistration({ ...registration, deviceUuid: randomUUID() }));
    assert.throws(() => devices.acceptRegistration({ ...registration, apiOrigin: 'https://other.example' }));
    devices.recordHeartbeat(registration.deviceUuid);
    assert.ok(devices.getIdentity().lastSeenAt);
    assert.throws(() => devices.recordHeartbeat(randomUUID()));
    assert.throws(() => database.prepare('UPDATE app_identity SET installation_uuid=?').run(randomUUID()));
    assert.deepEqual(database.prepare('SELECT id,name FROM concept_groups WHERE id=42').get(), { id: 42, name: 'Grupo personalizado' });
    assert.deepEqual(database.pragma('foreign_key_check'), []);
  } finally { database.close(); }

  const reopened = new Database(path);
  try {
    new MigrationService(reopened).run();
    const identity = new DeviceService(reopened, '0.1.1').ensureIdentity();
    assert.equal(identity.installationUuid, installationUuid);
    assert.equal(identity.appVersion, '0.1.1');
    assert.equal(reopened.prepare('SELECT COUNT(*) count FROM app_identity').get().count, 1);
    assert.equal(reopened.prepare('SELECT COUNT(*) count FROM schema_migrations').get().count, 2);
    const restored = new Database(':memory:');
    try {
      new MigrationService(restored).run();
      const otherInstallation = new DeviceService(restored, '0.1.0').ensureIdentity();
      assert.notEqual(otherInstallation.installationUuid, installationUuid);
      new DeviceService(reopened, '0.1.1').preserveInRestoredDatabase(restored);
      assert.equal(new DeviceService(restored, '0.1.1').getIdentity().installationUuid, installationUuid);
    } finally { restored.close(); }
  } finally { reopened.close(); }

  assert.ok(safeStorage.isEncryptionAvailable(), 'La prueba requiere cifrado real del sistema operativo.');
  const cipher = {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (value) => safeStorage.decryptString(value),
    ...(process.platform === 'linux' ? { getSelectedStorageBackend: () => safeStorage.getSelectedStorageBackend() } : {}),
  };
  const context = { apiOrigin: 'https://nomina.example', installationUuid };
  const store = new SecureTokenStore(directory, cipher);
  const canary = `synthetic-session-${randomUUID()}`;
  await store.save(canary, context);
  assert.equal((await readFile(join(directory, 'secure', 'session.bin'))).includes(Buffer.from(canary)), false);
  assert.equal(await new SecureTokenStore(directory, cipher).read(context), canary);
  assert.equal((await readFile(path)).includes(Buffer.from(canary)), false);
  await store.clear();
  assert.equal(await store.read(context), null);
  console.log(JSON.stringify({ identityMigration: 'v1-to-v2', legacyPreserved: true, identityStable: true,
    secureStorage: 'real-electron-roundtrip', tokenStoredInSQLite: false }));
}

async function processBatch({ databasePath, outputDirectory, reconciliationId, filePath, fortnight, payrollTypeId,
  selectedConceptIds, retainedEmployeeNumbers, replaceActiveBatch }) {
  const worker = new Worker(new URL('../dist/main/workers/PayrollProcessingWorker.js', import.meta.url), { workerData: {
    processId: randomUUID(), reconciliationId, sourceOrder: Date.now(), databasePath, filePath, year: 2026, month: 7,
    fortnight, payrollTypeId, selectedConceptIds, retainedEmployeeNumbers, missingAcknowledged: false, replaceActiveBatch,
  } });
  const processed = await new Promise((resolveMessage, reject) => {
    worker.on('message', (message) => {
      if (message.type === 'processed') resolveMessage(message);
      if (message.type === 'error') reject(new Error(message.message));
    });
    worker.on('error', reject);
  });
  const db = new DatabaseService(databasePath);
  try {
    try {
      const batch = db.connection.prepare('SELECT replaced_batch_id FROM payroll_batches WHERE id=?').get(processed.batchId);
      const source = await new ExcelReportBuilder(db.connection, outputDirectory).build(processed.batchId, filePath);
      const now = new Date().toISOString();
      db.connection.transaction(() => {
        if (batch.replaced_batch_id) db.connection.prepare(`UPDATE payroll_batches SET is_active=0,status='SUPERSEDED',updated_at=? WHERE id=?`)
          .run(now, batch.replaced_batch_id);
        db.connection.prepare(`UPDATE payroll_batches SET is_active=1,status='COMPLETED',completed_at=?,updated_at=? WHERE id=?`)
          .run(now, now, processed.batchId);
        refreshReconciliation(db, reconciliationId);
      })();
      const monthlyReport = await new MonthlyReportBuilder(db.connection, outputDirectory).build(reconciliationId);
      return { batchId: processed.batchId, sourcePath: source.sourcePath, monthlyReport };
    } catch (error) {
      db.connection.prepare(`UPDATE payroll_batches SET status='FAILED',updated_at=? WHERE id=? AND is_active=0`)
        .run(new Date().toISOString(), processed.batchId);
      throw error;
    }
  } finally {
    db.close();
  }
}

function refreshReconciliation(db, reconciliationId) {
  const totals = db.connection.prepare(`SELECT COUNT(*) files,COALESCE(SUM(total_lines),0) lines,COALESCE(SUM(valid_lines),0) valid,
    COALESCE(SUM(excluded_lines),0) excluded,COALESCE(SUM(invalid_lines),0) invalid,COALESCE(SUM(total_amount_cents),0) total
    FROM payroll_batches WHERE reconciliation_id=? AND is_active=1 AND status='COMPLETED'`).get(reconciliationId);
  const now = new Date().toISOString();
  db.connection.prepare(`UPDATE monthly_reconciliations SET status='COMPLETED',revision=revision+1,file_count=?,completed_files=?,
    total_lines=?,valid_lines=?,excluded_lines=?,invalid_lines=?,total_amount_cents=?,completed_at=?,updated_at=? WHERE id=?`)
    .run(totals.files, totals.files, totals.lines, totals.valid, totals.excluded, totals.invalid, totals.total, now, now, reconciliationId);
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? listFiles(join(directory, entry.name)) : [join(directory, entry.name)]));
  return nested.flat();
}
