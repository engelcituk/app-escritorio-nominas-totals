import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseService } from '../dist/main/database/DatabaseService.js';
import { DeviceService } from '../dist/main/services/central/DeviceService.js';
import { SyncOutboxService } from '../dist/main/services/central/SyncOutboxService.js';
import { SyncOrchestrator } from '../dist/main/services/central/SyncOrchestrator.js';
import { ResultPublicationService, reportFilePath, verifyReportFile } from '../dist/main/services/central/ResultPublicationService.js';
import { createResultAdapters } from '../dist/main/services/central/ResultSyncAdapters.js';
import { canonicalPayload } from '../dist/main/services/central/syncContracts.js';
import { ApiError } from '../dist/main/services/central/ApiClient.js';
import { parseCentralConfig } from '../dist/main/config/central.js';
import { BackupService } from '../dist/main/services/BackupService.js';
import { createServer } from 'node:http';
import { session } from 'electron';
import { createUploadTransport } from '../dist/main/services/central/uploadTransport.js';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../dist/main/database/migrations.js';
import { initializeDatabase } from '../dist/main/database/initializeDatabase.js';

/** Exercises real SQLite + captured Excel + production adapters; only Laravel is simulated. */
export async function verifyResults(root, databasePath) {
  await verifyStreamingUpload(root);
  const oldPath = join(root, 'results-v4.sqlite'); const old = new Database(oldPath);
  for (const migration of MIGRATIONS.slice(0, 4)) { old.exec(migration.sql); old.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(migration.version, migration.name, new Date().toISOString()); }
  old.close(); const migrated = await initializeDatabase(oldPath);
  try { assert.equal(migrated.connection.prepare('SELECT MAX(version) v FROM schema_migrations').get().v, 5); }
  finally { migrated.close(); }
  assert.ok((await readdir(join(root, 'catalog-backups'))).some(name => name.startsWith('before-v5-')));
  const service = new DatabaseService(databasePath); const db = service.connection;
  try {
  const queue = new SyncOutboxService(db); const publications = new ResultPublicationService(db, databasePath);
  const device = new DeviceService(db, '0.1.0'); device.ensureIdentity();
  const registration = device.prepareRegistration('https://results.example');
  device.acceptRegistration({ installationUuid: registration.installationUuid, deviceUuid: registration.deviceUuid, apiOrigin: 'https://results.example', deviceName: 'Result fixture' });
  const active = db.prepare("SELECT * FROM payroll_batches WHERE status='COMPLETED' AND is_active=1 ORDER BY id DESC").all();
  const stage = async batch => {
    db.transaction(() => queue.stageResult(batch.id))(); await publications.capture(batch.id); queue.confirmLocalResult(batch.id);
    const row = db.prepare("SELECT * FROM sync_outbox WHERE operation_type='local.result.publish' AND local_entity_id=?").get(batch.id);
    assert.equal(row.status, 'PENDING', row.last_error_code); return row;
  };
  const first = await stage(active[0]);
  const original = db.prepare("SELECT * FROM sync_report_files WHERE parent_uuid=? AND report_type='MONTHLY_TOTALS'").get(first.operation_uuid);
  const artifact = db.prepare("SELECT * FROM report_artifacts WHERE reconciliation_id=? AND report_type='MONTHLY_TOTALS'").get(active[0].reconciliation_id);
  const oldBytes = await readFile(artifact.file_path);
  const newBytes = Buffer.concat([oldBytes, Buffer.from('synthetic next revision')]);
  await writeFile(artifact.file_path, newBytes);
  db.prepare('UPDATE report_artifacts SET file_hash_sha256=? WHERE id=?').run(createHash('sha256').update(newBytes).digest('hex'), artifact.id);
  db.prepare('UPDATE monthly_reconciliations SET revision=revision+1 WHERE id=?').run(active[0].reconciliation_id);
  const second = await stage(active[1]);
  const newer = db.prepare("SELECT * FROM sync_report_files WHERE parent_uuid=? AND report_type='MONTHLY_TOTALS'").get(second.operation_uuid);
  assert.notEqual(original.sha256, newer.sha256);
  assert.deepEqual(await readFile(reportFilePath(databasePath, original.sha256)), oldBytes);
  await writeFile(reportFilePath(databasePath, original.sha256), Buffer.alloc(oldBytes.length, 0));
  await assert.rejects(verifyReportFile(reportFilePath(databasePath, original.sha256), original.sha256, original.size_bytes), error => error.code === 'REPORT_FILE_INVALID');
  await writeFile(reportFilePath(databasePath, original.sha256), oldBytes);
  assert.throws(() => db.prepare('UPDATE sync_report_files SET size_bytes=1').run(), /IMMUTABLE/);
  const snapshot = join(root, 'result-snapshot.sqlite'); await db.backup(snapshot);
  const backup = new BackupService(); const archive = join(root, 'results.zip'); await backup.create(snapshot, archive, databasePath);

  let now = Date.now(); const operations = new Map(); const reports = new Map(); const resources = new Map();
  const mutations = []; let uploads = 0; let loseUploadAck = true; let loseCompleteAck = true;
  const status = { state: 'AUTHENTICATED', busy: false, apiOrigin: 'https://results.example', ...device.getIdentity() };
  const auth = { getStatus: () => status, getSessionGeneration: () => 1, check: async () => status,
    requestAuthenticated: async request => {
      const segments = request.path.split('/'); const id = segments.at(-1); const body = request.body;
      let value;
      const completeOperation = (operationUuid, resourceType, resourceUuid) => Object.assign(operations.get(operationUuid), {
        status: 'COMPLETED', result: { resourceType, resourceUuid }, completedAt: new Date(now).toISOString() });
      if (request.path.includes('/sync/operations')) {
        if (request.method === 'POST') {
          value = operations.get(body.operationUuid) ?? { ...body, status: 'PENDING', attempts: 1, lastError: null, result: null, completedAt: null, createdAt: new Date(now).toISOString() };
          operations.set(body.operationUuid, value);
        } else { value = operations.get(id); if (!value) throw new ApiError('HTTP_ERROR', 404); }
      } else if (id === 'upload') {
        value = reports.get(segments.at(-2));
        await verifyReportFile(request.upload.path, value.sha256, value.sizeBytes); ++uploads;
        request.upload.onProgress?.(value.sizeBytes); value.uploadStatus = 'UPLOADING';
        if (loseUploadAck) { loseUploadAck = false; throw new ApiError('TIMEOUT'); }
      } else if (id === 'complete') {
        value = reports.get(segments.at(-2)); value.uploadStatus = 'AVAILABLE'; value.uploadedAt = new Date(now).toISOString();
        completeOperation(value.operationUuid, 'reportArtifact', value.uuid);
        if (loseCompleteAck) { loseCompleteAck = false; throw new ApiError('TIMEOUT'); }
      } else {
        assert.equal(canonicalPayload(body).hash, body.payloadHashSha256);
        assert.equal(operations.get(body.operationUuid).payloadHashSha256, body.payloadHashSha256);
        if (id === 'reports') {
          value = [...reports.values()].find(report => report.operationUuid === body.operationUuid);
          if (!value) {
            value = { ...body, uuid: randomUUID(), uploadStatus: 'PENDING', uploadedAt: null,
              payrollBatchUuid: body.payrollBatchUuid ?? null, monthlyReconciliationUuid: body.monthlyReconciliationUuid ?? null };
            reports.set(value.uuid, value);
          }
        } else {
          value = resources.get(body.operationUuid);
          if (!value) { value = { uuid: randomUUID() }; resources.set(body.operationUuid, value); mutations.push({ endpoint: id, body }); }
          completeOperation(body.operationUuid, id === 'batches' ? 'payrollBatch' : 'monthlyReconciliation', value.uuid);
        }
      }
      return { kind: 'data', data: request.schema.parse(value), etag: null };
    } };
  const configuration = parseCentralConfig({ apiBaseUrl: status.apiOrigin, backofficeUrl: status.apiOrigin,
    syncRetryPolicy: { baseDelayMs: 1000, maxDelayMs: 4000, maximumAttempts: 5 } }, false);
  const progress = [];
  const adapters = createResultAdapters({ auth, databasePath, withOutbox: action => action(queue), progress: value => { if (value) progress.push(value); } });
  const sync = new SyncOrchestrator({ configuration, auth, withOutbox: action => action(queue), adapters, isBlocked: () => false,
    prepareLocal: () => publications.prepare(), now: () => now, random: () => 1 });
  try {
    await sync.run(); assert.equal(uploads, 1); assert.equal(queue.get(first.operation_uuid).status, 'PENDING');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sync_delivery_steps WHERE parent_uuid=?').get(second.operation_uuid).n, 0);
    now += 5000; await sync.run(); assert.equal(uploads, 1); // UPLOADING resumes at complete, not upload.
    await unlink(reportFilePath(databasePath, newer.sha256));
    now += 5000; await sync.run(); // Completed SOURCE ACK is recovered before continuing.
    assert.equal(queue.get(first.operation_uuid).status, 'SYNCED');
    await sync.run(); // The next publication becomes eligible after the first parent is finalized.
    const failed = db.prepare("SELECT * FROM sync_outbox WHERE status='FAILED'").get();
    assert.equal(failed.last_error_code, 'REPORT_FILE_MISSING'); assert.equal(queue.get(second.operation_uuid).status, 'PENDING');
    const extraction = join(root, 'result-restore'); await mkdir(extraction);
    const restoredPath = await backup.extractValidated(archive, extraction); await backup.restoreReportFiles(restoredPath, databasePath);
    const restored = new DatabaseService(restoredPath);
    try {
      assert.equal(new SyncOutboxService(restored.connection).get(first.operation_uuid).payload_hash_sha256, first.payload_hash_sha256);
      assert.equal(restored.connection.prepare('SELECT COUNT(*) n FROM sync_report_files').get().n, 4);
    } finally { restored.close(); }
    await sync.retry(failed.operation_uuid);
    assert.equal(queue.get(second.operation_uuid).status, 'SYNCED');
    assert.equal(uploads, 4); assert.equal(mutations.length, 4); assert.equal(reports.size, 4);
    assert.ok([...reports.values()].every(report => report.uploadStatus === 'AVAILABLE'));
    const batch = mutations.find(item => item.endpoint === 'batches').body;
    assert.equal(batch.fortnight, 1); assert.equal(batch.layoutVersion, '1');
    assert.equal(batch.totalLines, batch.validLines + batch.excludedLines + batch.invalidLines);
    assert.equal(batch.totalAmountCents, batch.totals.reduce((sum, row) => sum + row.amountCents, 0));
    assert.ok(!JSON.stringify(batch).includes('source_concept_id'));
    assert.ok(progress.some(item => item.stage === 'UPLOADING' && item.bytesSent === item.totalBytes));
    await sync.run(); assert.equal(uploads, 4); assert.equal(mutations.length, 4);
    const legacy = queue.enqueue({ operationType: 'local.result.publish', entityType: 'PAYROLL_BATCH', localEntityId: 1,
      identity: { apiOrigin: status.apiOrigin, installationUuid: status.installationUuid, deviceUuid: status.deviceUuid },
      payload: { reconciliation: { revision: 0 } } });
    await publications.prepare(); assert.equal(queue.get(legacy).last_error_code, 'HISTORICAL_REPORT_MISSING');
    console.log(JSON.stringify({ results: 'production adapters + SQLite + Excel; simulated Laravel', frozenMonthlyRevisions: true,
      orderedPublications: true, lostUploadAck: 'no duplicate upload', lostCompleteAck: 'reconciled', missingFileRecovery: true,
      migration: 'v4-to-v5-with-backup', backupIncludesReports: true, corruptFileRejected: true, oldMonthlyNotSubstituted: true, reportAvailabilityConfirmed: 4, wireTotalsBalanced: true }));
  } finally { sync.dispose(); }
  } finally { service.close(); }
}

async function verifyStreamingUpload(root) {
  const bytes = Buffer.alloc(3 * 1024 * 1024, 65); const path = join(root, 'large-upload.xlsx'); await writeFile(path, bytes);
  let redirected = false; let received = 0;
  const server = createServer(async (request, response) => {
    try {
    if (request.url === '/redirect') { response.writeHead(307, { Location: '/leak' }); response.end(); return; }
    if (request.url === '/leak') redirected = true;
    assert.equal(request.headers.cookie, undefined);
    const chunks = []; for await (const chunk of request) { chunks.push(chunk); received += chunk.length; }
    const body = Buffer.concat(chunks); const start = body.indexOf('\r\n\r\n') + 4;
    assert.deepEqual(body.subarray(start, start + bytes.length), bytes);
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"ok":true}');
    } catch { response.destroy(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const isolated = session.fromPartition(`upload-test-${randomUUID()}`);
  await isolated.cookies.set({ url: origin, name: 'ambient', value: 'must-not-send' });
  const transport = createUploadTransport(isolated); const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000); const progress = [];
  try {
    const result = await transport(new URL(`${origin}/upload`), { Authorization: 'Bearer synthetic' }, { path, sizeBytes: bytes.length, onProgress: n => progress.push(n) }, controller.signal);
    assert.equal(result.status, 200); assert.ok(received > bytes.length); assert.ok(progress.every(n => n >= 0 && n <= bytes.length));
    await assert.rejects(transport(new URL(`${origin}/redirect`), {}, { path, sizeBytes: bytes.length }, controller.signal), error => error.code === 'REDIRECT_REJECTED');
    assert.equal(redirected, false);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(transport(new URL(`${origin}/upload`), {}, { path, sizeBytes: bytes.length }, aborted.signal), error => error.code === 'CANCELLED');
    console.log(JSON.stringify({ streamingUpload: '3 MiB multipart through Electron net.request', exactBytes: true, ambientCookiesOmitted: true, redirectsRejected: true, cancellation: true }));
  } finally { clearTimeout(timeout); server.closeAllConnections(); await new Promise(done => server.close(done)); }
}
