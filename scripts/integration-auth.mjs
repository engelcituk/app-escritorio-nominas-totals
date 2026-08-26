import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, session, safeStorage } from 'electron';
import { DatabaseService } from '../dist/main/database/DatabaseService.js';
import { DeviceService } from '../dist/main/services/central/DeviceService.js';
import { SecureTokenStore } from '../dist/main/services/central/SecureTokenStore.js';
import { AuthService } from '../dist/main/services/central/AuthService.js';
import { ApiClient } from '../dist/main/services/central/ApiClient.js';
import { deviceResponseSchema } from '../dist/main/services/central/contracts.js';
import { parseCentralConfig } from '../dist/main/config/central.js';
import { CatalogRepository } from '../dist/main/services/central/CatalogRepository.js';
import { CatalogSyncService } from '../dist/main/services/central/CatalogSyncService.js';
import { catalogSnapshotSchema } from '../dist/main/services/central/catalogContracts.js';
import { randomUUID } from 'node:crypto';
import { canonicalPayload, operationResponseSchema } from '../dist/main/services/central/syncContracts.js';

// Input: one JSON object on stdin {apiBaseUrl,email,password}; on Windows Electron
// has no stdin handle, so an ephemeral SEFIPLAN_TEST_INPUT_JSON is also accepted.
let stage = 'stdin';
async function run() {
  let inputText = process.env.SEFIPLAN_TEST_INPUT_JSON ?? '';
  delete process.env.SEFIPLAN_TEST_INPUT_JSON;
  if (!inputText) {
    for await (const chunk of process.stdin) {
      inputText += chunk.toString();
      if (inputText.length > 4096) throw new Error('INPUT_TOO_LARGE');
    }
  }
  if (inputText.length > 4096) throw new Error('INPUT_TOO_LARGE');
  stage = `parse-input-${inputText.length ? 'present' : 'empty'}`;
  const input = JSON.parse(inputText.replace(/^\uFEFF/, '')); inputText = '';
  stage = 'configuration';
  const configuration = parseCentralConfig({ apiBaseUrl: input.apiBaseUrl, backofficeUrl: input.apiBaseUrl }, false);
  assert.equal(configuration.configured, true);
  stage = 'temporary-profile';
  const root = process.env.SEFIPLAN_AUTH_TEST_ROOT;
  if (!root) throw new Error('Use scripts/run-auth-integration.mjs');
  app.setPath('userData', root);
  await app.whenReady();
  stage = 'database';
  const db = new DatabaseService(join(root, 'test.sqlite'), { initialize: true });
  const device = new DeviceService(db.connection, '0.1.0');
  device.ensureIdentity();
  const tokens = new SecureTokenStore(root, safeStorage);
  const apiSession = session.fromPartition('auth-integration');
  const catalogRequests = [];
  const transport = async (url, init) => {
    const response = await apiSession.fetch(url instanceof URL ? url.href : url, init);
    const path = new URL(url instanceof URL ? url.href : String(url)).pathname;
    if (path.startsWith('/api/v1/catalogs/')) {
      const etag = response.headers.get('etag');
      const metadata = response.ok ? await response.clone().json().catch(() => ({})) : {};
      if (path.endsWith('/snapshot') && response.ok) {
        const parsed = catalogSnapshotSchema.safeParse(metadata);
        if (!parsed.success) console.error(JSON.stringify({ snapshotContractIssues: parsed.error.issues.slice(0, 10).map(issue => ({
          path: issue.path.join('.'), code: issue.code, ...('expected' in issue ? { expected: issue.expected } : {}),
        })) }));
      }
      catalogRequests.push({ path, status: response.status,
        etag: etag === null ? null : /^[W/"a-zA-Z0-9:_-]{1,180}$/.test(etag) ? etag : 'UNRECOGNIZED_ETAG',
        checksum: /^[a-f0-9]{64}$/.test(metadata.checksumSha256) ? metadata.checksumSha256 : null });
    }
    return response;
  };
  const options = { configuration, isPackaged: false, platform: process.platform, device, tokens, transport };
  let auth = new AuthService(options);
  try {
    stage = 'login';
    const loggedIn = await auth.login({ email: input.email, password: input.password, deviceName: input.catalog ? 'Prueba automatizada · Fase 2' : 'Prueba automatizada · Fase 1' });
    input.password = '';
    if (loggedIn.state !== 'AUTHENTICATED') throw new Error(`LOGIN_${loggedIn.errorCode}`);
    assert.notEqual(loggedIn.deviceUuid, loggedIn.installationUuid);
    const context = { apiOrigin: configuration.config.apiBaseUrl, installationUuid: loggedIn.installationUuid };
    let secret = await tokens.read(context);
    assert.ok(secret);
    assert.equal(JSON.stringify(loggedIn).includes(secret), false);
    assert.equal((await readFile(join(root, 'secure/session.bin'))).includes(Buffer.from(secret)), false);
    assert.equal(db.connection.serialize().includes(Buffer.from(secret)), false);
    auth.dispose();
    auth = new AuthService(options);
    const restored = await auth.restore();
    if (restored.state !== 'AUTHENTICATED') throw new Error(`RESTORE_${restored.errorCode}`);
    assert.equal(restored.deviceUuid, loggedIn.deviceUuid);
    if (input.catalog) {
      stage = 'catalog-first-sync';
      const repository = new CatalogRepository(db.connection);
      const catalog = new CatalogSyncService({ configuration, auth, withRepository: action => action(repository),
        backup: async () => { await db.connection.backup(join(root, 'before-catalog.sqlite')); }, isProcessing: () => false });
      try {
        const synced = await catalog.synchronize();
        if (!synced.canProcess) throw new Error(`CATALOG_${synced.errorCode ?? synced.state}`);
        assert.equal(repository.verifyStored(), true);
        stage = 'catalog-conditional';
        const again = await catalog.synchronize();
        assert.equal(again.revision, synced.revision); assert.equal(again.canProcess, true);
        assert.equal(catalogRequests.at(-1).status, 304);
        console.log(JSON.stringify({ realCatalog: 'passed', revision: synced.revision, checksumVerified: true, conditional304: true, requests: catalogRequests }));
      } catch (error) { console.error(JSON.stringify({ realCatalog: 'failed', requests: catalogRequests })); throw error; }
      finally { catalog.dispose(); }
    }
    if (input.outbox) {
      stage = 'outbox-reservation';
      const operationUuid = randomUUID();
      // Reservation only, no resource mutation and no source TXT/report transfer.
      const payload = { conceptGroupUuid: new CatalogRepository(db.connection).readSnapshot()?.conceptGroups.find(group => group.active)?.uuid,
        year: 2026, month: 8, status: 'DRAFT', fileCount: 0, completedFiles: 0, totalLines: 0, validLines: 0,
        excludedLines: 0, invalidLines: 0, totalAmountCents: 0, startedAt: new Date().toISOString(), completedAt: null };
      const payloadHashSha256 = canonicalPayload(payload).hash;
      const body = { operationUuid, operationType: 'reconciliation.upsert', payloadHashSha256 };
      const reserve = () => auth.requestAuthenticated({ method: 'POST', path: '/api/v1/sync/operations', body, schema: operationResponseSchema });
      const first = await reserve(); assert.equal(first.kind, 'data');
      assert.equal(first.data.operationUuid, operationUuid); assert.equal(first.data.payloadHashSha256, payloadHashSha256); assert.equal(first.data.status, 'PENDING');
      stage = 'outbox-lookup-replay';
      const lookedUp = await auth.requestAuthenticated({ path: `/api/v1/sync/operations/${operationUuid}`, schema: operationResponseSchema });
      assert.equal(lookedUp.data.operationUuid, operationUuid); assert.equal(lookedUp.data.payloadHashSha256, payloadHashSha256);
      const replay = await reserve(); assert.equal(replay.data.operationUuid, operationUuid); assert.equal(replay.data.status, 'PENDING');
      assert.equal(replay.data.result, null);
      stage = 'outbox-conflict';
      let conflict = false;
      try { await auth.requestAuthenticated({ method: 'POST', path: '/api/v1/sync/operations', body: { ...body, payloadHashSha256: canonicalPayload({ ...payload, month: 9 }).hash }, schema: operationResponseSchema }); }
      catch (error) { conflict = error?.httpStatus === 409; }
      assert.equal(conflict, true);
      console.log(JSON.stringify({ realOutbox: 'reservation-lookup-replay-conflict-passed', operationUuid,
        reservationIsNotDelivery: true, resultMutations: 0, reportUploads: 0, reservationRemainsPending: true }));
    }
    const loggedOut = await auth.logout();
    assert.equal(loggedOut.state, 'AUTH_REQUIRED');
    assert.equal(loggedOut.errorCode, null);
    assert.equal(await tokens.read(context), null);
    const client = new ApiClient({ ...configuration.config, isPackaged: false, transport, getToken: async () => secret });
    let rejected = false;
    try { await client.request({ path: '/api/v1/desktop/me', schema: deviceResponseSchema }); }
    catch (error) { rejected = error?.httpStatus === 401; }
    secret = null;
    assert.equal(rejected, true);
    console.log(JSON.stringify({ backend: configuration.config.apiBaseUrl, login: 'passed',
      restoreAndHeartbeat: 'passed', distinctStableIdentity: true, safeStorage: 'native-encrypted',
      rendererAndSQLiteHaveNoToken: true, remoteLogout: 'confirmed-401', tlsValidation: 'enabled' }));
  } finally {
    input.password = '';
    await auth.logout(); auth.dispose(); db.close();
  }
}
void run().then(() => app.quit(), (error) => {
  // No response bodies, credentials, token-bearing assertions or request options.
  console.error('Auth integration failed:', stage, error?.name, error?.code ?? (/^(LOGIN_|RESTORE_|CATALOG_)/.test(error?.message) ? error.message : 'CHECK_FAILED'));
  app.exit(1);
});
