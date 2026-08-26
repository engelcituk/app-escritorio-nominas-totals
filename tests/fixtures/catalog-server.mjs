import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { catalogChecksum } from '../../dist/main/services/central/catalogContracts.js';
import { canonicalPayload } from '../../dist/main/services/central/syncContracts.js';

/** Deterministic HTTP contract fixture, not a production API or a Laravel test. */
export async function startCatalogServer() {
  const group = randomUUID(); const concept = randomUUID(); const token = `synthetic-${randomUUID()}`;
  const state = { offline: false, snapshotFailure: false, device: null, authenticated: false,
    snapshot: { revision: 1, publishedAt: new Date().toISOString(), checksumSha256: '',
      conceptGroups: [{ uuid: group, code: 'ISR', name: 'Impuesto sobre la Renta', active: true }],
      payrollConcepts: [{ uuid: concept, code: 'ISR_POR_SALARIOS', name: 'ISR POR SALARIOS', conceptGroupUuid: group, operationFactor: 1, active: true }],
      conceptAliases: [{ uuid: randomUUID(), payrollConceptUuid: concept, sourceDescription: 'I S R  POR SALARIOS', normalizedDescription: 'ISR POR SALARIOS', active: true }],
      payrollTypes: [{ uuid: randomUUID(), code: 'SUELDOS', name: 'Nómina ordinaria', sortOrder: 1, active: true }],
    } };
  state.snapshot.checksumSha256 = catalogChecksum(state.snapshot);
  const operations = new Map(); const reconciliations = new Map(); const batches = new Map(); const reports = new Map();
  const complete = (uuid, resourceType, resourceUuid) => Object.assign(operations.get(uuid), { status: 'COMPLETED', result: { resourceType, resourceUuid }, completedAt: new Date().toISOString() });
  const server = createServer(async (req, res) => {
    if (state.offline) { req.socket.destroy(); return; }
    const respond = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(status === 304 ? undefined : JSON.stringify(body)); };
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks); const body = bytes.toString();
    if (req.url === '/api/v1/desktop/tokens' && req.method === 'POST') {
      const input = JSON.parse(body);
      if (input.email !== 'fixture@example.test' || input.password !== 'fixture-only') { respond(422, {}); return; }
      state.device = { uuid: input.deviceUuid, installationUuid: input.installationUuid, name: input.name,
        appVersion: input.appVersion, platform: input.platform, lastSeenAt: new Date().toISOString(), revokedAt: null, createdAt: new Date().toISOString() };
      state.authenticated = true; respond(201, { token, tokenType: 'Bearer', abilities: ['catalogs:read'], device: state.device }); return;
    }
    if (!state.authenticated || req.headers.authorization !== `Bearer ${token}`) { respond(401, {}); return; }
    if (req.url === '/api/v1/desktop/me') { respond(200, state.device); return; }
    if (req.url === '/api/v1/desktop/heartbeat') { respond(200, { receivedAt: new Date().toISOString() }); return; }
    if (req.url === '/api/v1/desktop/logout') { state.authenticated = false; respond(200, { message: 'Cerrado' }); return; }
    if (req.url?.startsWith('/api/v1/catalogs/')) {
      const hash = state.snapshot.checksumSha256; const headers = { ETag: `W/"${hash}"` };
      if (req.url.endsWith('/manifest')) {
        if (req.headers['if-none-match']?.replace(/^W\//, '') === `"${hash}"`) { respond(304, null, headers); return; }
        respond(200, { revision: state.snapshot.revision, checksumSha256: hash, publishedAt: state.snapshot.publishedAt }, headers); return;
      }
      if (state.snapshotFailure) { respond(500, {}); return; }
      respond(200, state.snapshot, headers); return;
    }
    const parts = req.url.split('/'); const last = parts.at(-1); const previous = parts.at(-2);
    if (req.url.startsWith('/api/v1/sync/operations')) {
      if (req.method === 'GET') { const operation = operations.get(last); respond(operation ? 200 : 404, operation ?? {}); return; }
      const input = JSON.parse(body); const old = operations.get(input.operationUuid);
      if (old && (old.payloadHashSha256 !== input.payloadHashSha256 || old.operationType !== input.operationType)) { respond(409, {}); return; }
      const operation = old ?? { ...input, status: 'PENDING', attempts: 1, lastError: null, result: null, completedAt: null, createdAt: new Date().toISOString() };
      operations.set(input.operationUuid, operation); respond(old ? 200 : 201, operation); return;
    }
    if (req.url.startsWith('/api/v1/reconciliations/') && req.method === 'GET') {
      const rec = reconciliations.get(last); respond(rec ? 200 : 404, rec ? { ...rec, batches: [...batches.values()].filter(batch => batch.reconciliationUuid === last) } : {}); return;
    }
    if (req.url.startsWith('/api/v1/reports/')) {
      const report = reports.get(previous); if (!report) { respond(404, {}); return; }
      if (last === 'upload') {
        const start = bytes.indexOf('\r\n\r\n') + 4; const end = bytes.lastIndexOf('\r\n--'); const file = bytes.subarray(start, end);
        if (file.length !== report.sizeBytes || createHash('sha256').update(file).digest('hex') !== report.sha256) { respond(422, {}); return; }
        report.uploadStatus = 'UPLOADING';
      } else if (last === 'complete') {
        if (!['UPLOADING', 'AVAILABLE'].includes(report.uploadStatus)) { respond(409, {}); return; }
        report.uploadStatus = 'AVAILABLE'; report.uploadedAt = new Date().toISOString(); complete(report.operationUuid, 'reportArtifact', report.uuid);
      }
      respond(200, report); return;
    }
    if (req.method === 'POST' && ['reconciliations', 'batches', 'reports'].includes(last)) {
      const input = JSON.parse(body); const operation = operations.get(input.operationUuid);
      if (!operation || canonicalPayload(input).hash !== operation.payloadHashSha256) { respond(409, {}); return; }
      if (operation.status === 'COMPLETED' && last !== 'reports') {
        respond(200, (last === 'reconciliations' ? reconciliations : batches).get(operation.result.resourceUuid)); return;
      }
      if (last === 'reconciliations') {
        const rec = { ...input, uuid: randomUUID(), revision: 1 }; reconciliations.set(rec.uuid, rec);
        complete(input.operationUuid, 'monthlyReconciliation', rec.uuid); respond(201, rec); return;
      }
      if (last === 'batches') {
        const batch = { ...input, uuid: randomUUID(), reconciliationUuid: previous, version: 1, active: true }; batches.set(batch.uuid, batch);
        complete(input.operationUuid, 'payrollBatch', batch.uuid); respond(201, batch); return;
      }
      const report = [...reports.values()].find(item => item.operationUuid === input.operationUuid) ?? { ...input, uuid: randomUUID(),
        payrollBatchUuid: input.payrollBatchUuid ?? null, monthlyReconciliationUuid: input.monthlyReconciliationUuid ?? null,
        uploadStatus: 'PENDING', uploadedAt: null };
      reports.set(report.uuid, report); respond(201, report); return;
    }
    respond(404, {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { state, url: `http://127.0.0.1:${server.address().port}`, republish: () => {
    ++state.snapshot.revision; state.snapshot.payrollConcepts[0].name = `ISR POR SALARIOS · R${state.snapshot.revision}`;
    state.snapshot.checksumSha256 = catalogChecksum(state.snapshot);
  }, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
