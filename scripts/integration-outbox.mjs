import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { DatabaseService } from '../dist/main/database/DatabaseService.js';
import { MIGRATIONS } from '../dist/main/database/migrations.js';
import { initializeDatabase } from '../dist/main/database/initializeDatabase.js';
import { SyncOutboxService } from '../dist/main/services/central/SyncOutboxService.js';
import { SyncOrchestrator } from '../dist/main/services/central/SyncOrchestrator.js';
import { canonicalPayload, operationResponseSchema } from '../dist/main/services/central/syncContracts.js';
import { ApiError } from '../dist/main/services/central/ApiClient.js';
import { parseCentralConfig } from '../dist/main/config/central.js';
import { DeviceService } from '../dist/main/services/central/DeviceService.js';

const identity = { apiOrigin: 'https://outbox.example', installationUuid: '11111111-1111-4111-8111-111111111111', deviceUuid: '22222222-2222-4222-8222-222222222222' };
const type = 'reconciliation.upsert';

function harness(root, options = {}) {
  const service = new DatabaseService(join(root, `${randomUUID()}.sqlite`), { initialize: true });
  const queue = new SyncOutboxService(service.connection);
  const configuration = parseCentralConfig({ apiBaseUrl: identity.apiOrigin, backofficeUrl: identity.apiOrigin,
    syncRetryPolicy: { baseDelayMs: 1000, maxDelayMs: 4000, maximumAttempts: 3 } }, false);
  let now = Date.parse('2026-08-26T12:00:00Z'); let generation = 1; let executions = 0;
  const status = { state: 'AUTHENTICATED', busy: false, ...identity, appVersion: 'test', deviceName: 'test', lastSeenAt: null, message: null, errorCode: null, retryAt: null };
  const remote = new Map(); const requests = []; let blocked = false;
  const auth = { getStatus: () => ({ ...status }), getSessionGeneration: () => generation,
    check: async () => ({ ...status }),
    requestAuthenticated: async request => {
      requests.push({ path: request.path, body: request.body });
      if (options.request) await options.request(request);
      let value;
      if (request.method === 'POST') {
        const old = remote.get(request.body.operationUuid);
        if (old && (old.payloadHashSha256 !== request.body.payloadHashSha256 || old.operationType !== request.body.operationType)) throw new ApiError('CONFLICT', 409);
        value = old ?? { ...request.body, status: 'PENDING', attempts: 1, lastError: null, result: null, completedAt: null, createdAt: new Date(now).toISOString() };
        remote.set(value.operationUuid, value);
      } else { value = remote.get(request.path.split('/').at(-1)); if (!value) throw new ApiError('HTTP_ERROR', 404); }
      return { kind: 'data', data: operationResponseSchema.parse(value), etag: null };
    } };
  const adapter = { validatePayload: payload => { assert.equal(typeof payload.totalAmountCents, 'number'); }, execute: async (row, payload, signal) => {
    executions++; if (options.execute) return options.execute({ row, payload, signal, remote, now, status, logout: () => { generation++; status.state = 'AUTH_REQUIRED'; } });
    remote.set(row.operation_uuid, { ...remote.get(row.operation_uuid), status: 'COMPLETED', result: { resourceType: 'monthlyReconciliation', resourceUuid: randomUUID() }, completedAt: new Date(now).toISOString() });
  } };
  const sync = new SyncOrchestrator({ configuration, auth, withOutbox: action => action(queue),
    adapters: options.noAdapter ? {} : { [type]: adapter }, isBlocked: () => blocked, now: () => now, random: () => 1 });
  return { service, queue, sync, status, remote, requests, auth, adapter, configuration,
    enqueue: (extra = {}) => queue.enqueue({ operationType: type, entityType: 'TEST', identity, payload: { totalAmountCents: 12345 }, ...extra }, now),
    advance: (ms = 5000) => { now += ms; }, setBlocked: value => { blocked = value; }, get now() { return now; }, get executions() { return executions; },
    close: () => { sync.dispose(); service.close(); } };
}

export async function verifyOutbox(root) {
  const v3Path = join(root, 'outbox-v3.sqlite'); const old = new Database(v3Path);
  for (const migration of MIGRATIONS.slice(0, 3)) { old.exec(migration.sql); old.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(migration.version, migration.name, new Date().toISOString()); }
  old.close(); const migrated = await initializeDatabase(v3Path);
  assert.equal(migrated.connection.prepare('SELECT MAX(version) v FROM schema_migrations').get().v, 5);
  assert.equal(migrated.connection.prepare('SELECT COUNT(*) n FROM sync_outbox').get().n, 0);
  migrated.close(); assert.ok((await readdir(join(root, 'catalog-backups'))).some(name => name.startsWith('before-v4-')));

  // Catalog integration already produced isolated completed batches. Verify that
  // intent creation shares the local transaction and staged reports never send.
  {
    const service = new DatabaseService(join(root, 'catalog-legacy.sqlite'));
    try {
      const device = new DeviceService(service.connection, '0.1.0'); device.ensureIdentity();
      const registration = device.prepareRegistration(identity.apiOrigin);
      device.acceptRegistration({ installationUuid: registration.installationUuid, deviceUuid: registration.deviceUuid, deviceName: 'Outbox fixture', apiOrigin: identity.apiOrigin });
      const queue = new SyncOutboxService(service.connection);
      assert.throws(() => queue.stageResult(2), error => error.code === 'TRANSACTION_REQUIRED');
      assert.throws(() => service.connection.transaction(() => { queue.stageResult(2); throw new Error('rollback'); })(), /rollback/);
      assert.equal(queue.summary([]).pending, 0);
      service.connection.transaction(() => queue.stageResult(2))();
      const staged = service.connection.prepare('SELECT * FROM sync_outbox').get();
      assert.equal(staged.local_ready, 0); assert.equal(queue.claim(['local.result.publish'], Date.now()), null);
      queue.confirmLocalResult(2); assert.equal(queue.get(staged.operation_uuid).local_ready, 1);
      assert.throws(() => service.connection.transaction(() => queue.stageResult(2))(), /UNIQUE/);
      const interrupted = queue.enqueue({ operationType: 'local.result.publish', entityType: 'TEST', localEntityId: 999,
        identity, payload: { manifestVersion: 1 }, localReady: false });
      queue.recoverInterrupted(); assert.equal(queue.get(interrupted).last_error_code, 'LOCAL_REPORTS_UNCONFIRMED');
      assert.equal(queue.get(staged.operation_uuid).status, 'PENDING');
      const failed = queue.enqueue({ operationType: 'local.result.publish', entityType: 'TEST', localEntityId: 998,
        identity, payload: { manifestVersion: 1 }, localReady: false });
      queue.failLocalResult(998); assert.equal(queue.get(failed).last_error_code, 'LOCAL_RESULT_FAILED');
      assert.equal(queue.canRetry(queue.get(failed), ['local.result.publish'], Date.now()), false);
    } finally { service.close(); }
  }

  // Success, immutable identities/payloads, dependencies, rollback and bounded DTOs.
  {
    const h = harness(root);
    try {
      assert.throws(() => h.service.connection.transaction(() => { h.enqueue(); throw new Error('rollback'); })(), /rollback/);
      assert.equal(h.queue.summary([type]).pending, 0);
      const first = h.enqueue(); const dependent = h.enqueue({ dependsOn: first, supersedes: first, payload: { totalAmountCents: 20000 } });
      const before = h.queue.get(first);
      assert.throws(() => h.service.connection.prepare('UPDATE sync_outbox SET payload_json=? WHERE operation_uuid=?').run('{}', first), /IMMUTABLE/);
      assert.throws(() => h.service.connection.prepare('UPDATE sync_outbox SET operation_uuid=? WHERE operation_uuid=?').run(randomUUID(), first), /IMMUTABLE/);
      const one = h.sync.run(); assert.equal(h.sync.run(), one); await one;
      assert.equal(h.queue.get(first).status, 'SYNCED'); assert.equal(h.queue.get(dependent).status, 'SYNCED'); assert.equal(h.executions, 2);
      assert.equal(h.queue.get(first).payload_json, before.payload_json); assert.equal(h.queue.get(first).payload_hash_sha256, before.payload_hash_sha256);
      assert.throws(() => h.service.connection.prepare('UPDATE sync_outbox SET central_entity_uuid=? WHERE operation_uuid=?').run(randomUUID(), first), /IMMUTABLE/);
      const dto = h.sync.detail(first); assert.equal('payload_json' in dto, false); assert.equal('api_origin' in dto, false);
      assert.equal(h.sync.list({ page: 1, pageSize: 25, status: 'SYNCED', search: first }).total, 1);
      assert.equal(h.sync.list({ page: 1, pageSize: 25, status: 'all', search: '%' }).total, 0);
      for (let n = 0; n < 30; n++) h.enqueue();
      assert.equal(h.sync.list({ page: 1, pageSize: 25, status: 'all', search: '' }).items.length, 25);
      assert.deepEqual(h.service.connection.pragma('foreign_key_check'), []);
    } finally { h.close(); }
  }
  // Timeout after remote commit: retry discovers the ACK, no second mutation.
  {
    const h = harness(root, { execute: async ({ row, remote, now }) => {
      remote.set(row.operation_uuid, { ...remote.get(row.operation_uuid), status: 'COMPLETED', result: { resourceType: 'monthlyReconciliation', resourceUuid: randomUUID() }, completedAt: new Date(now).toISOString() });
      throw new ApiError('TIMEOUT');
    } });
    try { const uuid = h.enqueue(); await h.sync.run(); assert.equal(h.queue.get(uuid).status, 'RETRY');
      const hash = h.queue.get(uuid).payload_hash_sha256;
      await h.sync.run(); assert.equal(h.executions, 1); h.advance(); await h.sync.run();
      assert.equal(h.queue.get(uuid).status, 'SYNCED'); assert.equal(h.executions, 1); assert.equal(h.queue.get(uuid).payload_hash_sha256, hash);
    } finally { h.close(); }
  }
  for (const http of [400, 401, 403, 404, 409, 422, 408, 429, 500, 502, 503, 504]) {
    const code = http === 401 ? 'AUTH_REQUIRED' : http === 403 ? 'FORBIDDEN' : http === 409 ? 'CONFLICT' : 'HTTP_ERROR';
    const h = harness(root, { execute: async () => { throw new ApiError(code, http, http === 429 ? 90000 : null); } });
    try { const uuid = h.enqueue(); await h.sync.run(); const row = h.queue.get(uuid);
      assert.equal(row.status, http === 409 ? 'CONFLICT' : [408, 429, 500, 502, 503, 504].includes(http) ? 'RETRY' : 'FAILED');
      if (http === 429) {
        const other = h.enqueue(); h.advance(5000); await h.sync.retry(uuid); await h.sync.run();
        assert.equal(h.queue.get(other).attempts, 0); assert.equal(h.queue.get(uuid).attempts, 1);
        assert.ok(Date.parse(row.next_attempt_at) >= h.now + 85000);
      }
      if ([400, 404, 409, 422].includes(http)) { h.advance(); assert.equal(h.sync.detail(uuid).canRetry, false); await h.sync.run(); assert.equal(h.queue.get(uuid).attempts, 1); }
    } finally { h.close(); }
  }
  // Exhaustion does not loop; explicit retry keeps total attempts/UUID/payload.
  {
    const h = harness(root, { execute: async () => { throw new ApiError('NETWORK_ERROR'); } });
    try { const uuid = h.enqueue(); for (let n = 0; n < 3; n++) { await h.sync.run(); h.advance(); }
      assert.equal(h.queue.get(uuid).status, 'FAILED'); assert.equal(h.queue.get(uuid).attempts, 3);
      await h.sync.run(); assert.equal(h.queue.get(uuid).attempts, 3); await h.sync.retry(uuid);
      assert.equal(h.queue.get(uuid).attempts, 4); assert.equal(h.queue.get(uuid).cycle_attempts, 1);
    } finally { h.close(); }
  }
  // Unknown response/ACK, wrong identity and a reservation that never completes.
  for (const mode of ['hash', 'resource', 'identity', 'pending']) {
    const h = harness(root, { execute: async ({ row, remote, now }) => {
      if (mode === 'pending') return;
      remote.set(row.operation_uuid, { ...remote.get(row.operation_uuid), payloadHashSha256: mode === 'hash' ? 'b'.repeat(64) : row.payload_hash_sha256,
        status: 'COMPLETED', result: { resourceType: mode === 'resource' ? 'payrollBatch' : 'monthlyReconciliation', resourceUuid: randomUUID() }, completedAt: new Date(now).toISOString() });
    } });
    try { const uuid = h.enqueue(mode === 'identity' ? { identity: { ...identity, deviceUuid: randomUUID() } } : {}); await h.sync.run();
      assert.equal(h.queue.get(uuid).status, mode === 'pending' ? 'RETRY' : 'CONFLICT');
      if (mode === 'identity') assert.equal(h.requests.length, 0);
    } finally { h.close(); }
  }
  // Offline/processing/no adapter must not issue requests or increase attempts.
  for (const mode of ['offline', 'processing', 'adapter']) {
    const h = harness(root, { noAdapter: mode === 'adapter' });
    try { const uuid = h.enqueue(); if (mode === 'offline') h.status.state = 'OFFLINE'; if (mode === 'processing') h.setBlocked(true);
      await h.sync.run(); assert.equal(h.requests.length, 0); assert.equal(h.queue.get(uuid).attempts, 0);
      if (mode !== 'adapter') { h.status.state = 'AUTHENTICATED'; h.setBlocked(false); await h.sync.run(); assert.equal(h.queue.get(uuid).status, 'SYNCED'); }
    } finally { h.close(); }
  }
  // Logout/late completion cannot ACK locally; next authenticated cycle queries the same UUID.
  {
    const h = harness(root, { execute: async ({ row, remote, now, logout }) => {
      remote.set(row.operation_uuid, { ...remote.get(row.operation_uuid), status: 'COMPLETED', result: { resourceType: 'monthlyReconciliation', resourceUuid: randomUUID() }, completedAt: new Date(now).toISOString() }); logout();
    } });
    try { const uuid = h.enqueue(); await h.sync.run(); assert.equal(h.queue.get(uuid).status, 'RETRY');
      h.status.state = 'AUTHENTICATED'; h.advance(); await h.sync.run(); assert.equal(h.queue.get(uuid).status, 'SYNCED'); assert.equal(h.executions, 1);
    } finally { h.close(); }
  }
  // A database reopen/backup restore recovers IN_PROGRESS without new identities.
  {
    const h = harness(root);
    try { const uuid = h.enqueue(); const original = h.queue.get(uuid); h.queue.claim([type], h.now);
      const backup = join(root, 'outbox-restore.sqlite'); await h.service.connection.backup(backup);
      const restored = new DatabaseService(backup);
      try { const queue = new SyncOutboxService(restored.connection); queue.recoverInterrupted(h.now);
        assert.equal(queue.get(uuid).status, 'RETRY'); assert.equal(queue.get(uuid).operation_uuid, original.operation_uuid); assert.equal(queue.get(uuid).payload_json, original.payload_json);
        assert.equal(canonicalPayload(JSON.parse(queue.get(uuid).payload_json)).hash, original.payload_hash_sha256);
        queue.pause(h.now + 90000); queue.pause(null, true); queue.sessionVerified();
        assert.equal(Date.parse(queue.runtime().paused_until), h.now + 90000);
        restored.connection.prepare('UPDATE sync_outbox SET cycle_attempts=3 WHERE operation_uuid=?').run(uuid);
        assert.equal(queue.claim([type], h.now, 3), null); assert.equal(queue.get(uuid).last_error_code, 'RETRY_LIMIT');
        assert.equal(queue.get(uuid).attempts, 1);
      } finally { restored.close(); }
    } finally { h.close(); }
  }
  console.log(JSON.stringify({ outbox: 'SQLite + isolated adapters', migration: 'v3-to-v4-with-backup', immutablePayload: true,
    remoteAckRequired: true, timeoutReplayWithoutDuplicate: true, retryAfterGlobal: true, errorMatrix: true,
    singleFlight: true, dependencies: true, offlineOnline: true, logoutRace: true, restoredUuidPreserved: true }));
}
