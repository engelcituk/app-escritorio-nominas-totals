import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { OutboxOperationType, OutboxStatus, SyncDetail, SyncEntry, SyncQuery } from '../../../shared/types/sync.js';
import { canonicalPayload, SyncError, syncMessage } from './syncContracts.js';

export interface OutboxRow {
  id: number; operation_uuid: string; operation_type: OutboxOperationType; entity_type: string; local_entity_id: number | null;
  central_entity_uuid: string | null; api_origin: string; installation_uuid: string; device_uuid: string;
  payload_hash_sha256: string; payload_json: string; status: OutboxStatus; local_ready: number;
  attempts: number; cycle_attempts: number; next_attempt_at: string | null; last_http_status: number | null;
  last_error_code: string | null; depends_on: string | null; supersedes: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
}
export interface OutboxIdentity { apiOrigin: string; installationUuid: string; deviceUuid: string }
const identitySchema = z.strictObject({ apiOrigin: z.string().url(), installationUuid: z.string().uuid(), deviceUuid: z.string().uuid() });
const retryableCodes = new Set(['NETWORK_ERROR', 'TIMEOUT', 'HTTP_ERROR', 'REMOTE_PENDING', 'INTERRUPTED', 'CANCELLED', 'AUTH_REQUIRED', 'FORBIDDEN', 'TLS_ERROR', 'RETRY_LIMIT', 'REPORT_FILE_MISSING', 'REPORT_FILE_INVALID', 'REPORT_STORAGE_FULL']);
const diagnosticColumns = 'operation_uuid,operation_type,entity_type,local_entity_id,central_entity_uuid,status,local_ready,attempts,next_attempt_at,last_http_status,last_error_code,created_at,updated_at,completed_at,payload_hash_sha256,depends_on,supersedes';

/** Main/worker-local storage API. No enqueue, payload or SQL capability is exposed through IPC. */
export class SyncOutboxService {
  constructor(readonly db: Database.Database) {}
  get(uuid: string): OutboxRow | null { return this.db.prepare('SELECT * FROM sync_outbox WHERE operation_uuid=?').get(uuid) as OutboxRow ?? null; }
  runtime(): { paused_until: string | null; requires_session_verification: number } {
    return this.db.prepare('SELECT paused_until,requires_session_verification FROM sync_runtime WHERE id=1').get() as { paused_until: string | null; requires_session_verification: number };
  }
  pause(until: number | null, requiresVerification = false): void {
    this.db.prepare(`UPDATE sync_runtime SET paused_until=CASE WHEN paused_until IS NULL OR paused_until<? THEN ? ELSE paused_until END,
      requires_session_verification=MAX(requires_session_verification,?) WHERE id=1`)
      .run(until === null ? null : new Date(until).toISOString(), until === null ? null : new Date(until).toISOString(), requiresVerification ? 1 : 0);
  }
  sessionVerified(): void { this.db.prepare('UPDATE sync_runtime SET requires_session_verification=0 WHERE id=1').run(); }
  enqueue(input: { operationType: OutboxOperationType; entityType: string; localEntityId?: number; payload: unknown;
    identity: OutboxIdentity; dependsOn?: string; supersedes?: string; localReady?: boolean }, now = Date.now()): string {
    if (!identitySchema.safeParse(input.identity).success || new URL(input.identity.apiOrigin).origin !== input.identity.apiOrigin) throw new SyncError('IDENTITY_MISMATCH');
    const payload = canonicalPayload(input.payload); const uuid = randomUUID(); const timestamp = new Date(now).toISOString();
    this.db.prepare(`INSERT INTO sync_outbox(operation_uuid,operation_type,entity_type,local_entity_id,api_origin,installation_uuid,device_uuid,
      payload_hash_sha256,payload_json,depends_on,supersedes,local_ready,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uuid, input.operationType, input.entityType, input.localEntityId ?? null, input.identity.apiOrigin, input.identity.installationUuid,
        input.identity.deviceUuid, payload.hash, payload.json, input.dependsOn ?? null, input.supersedes ?? null, input.localReady === false ? 0 : 1, timestamp, timestamp);
    return uuid;
  }
  /** Must participate in the transaction activating this batch. Only a local manifest, never a wire DTO. */
  stageResult(batchId: number): void {
    if (!this.db.inTransaction) throw new SyncError('TRANSACTION_REQUIRED');
    const identity = this.db.prepare('SELECT api_origin apiOrigin,installation_uuid installationUuid,central_device_uuid deviceUuid,last_app_version appVersion FROM app_identity WHERE id=1').get() as OutboxIdentity & { appVersion: string };
    const batch = this.db.prepare(`SELECT id batchId,reconciliation_id reconciliationId,catalog_revision catalogRevision,
      concept_group_uuid conceptGroupUuid,payroll_type_uuid payrollTypeUuid,version,total_amount_cents totalAmountCents,completed_at completedAt
      FROM payroll_batches WHERE id=? AND status='COMPLETED'`).get(batchId) as Record<string, unknown> | undefined;
    if (!batch || !identity) throw new SyncError('LOCAL_RESULT_INVALID');
    const rec = this.db.prepare(`SELECT year,month,revision,file_count fileCount,completed_files completedFiles,
      total_lines totalLines,valid_lines validLines,excluded_lines excludedLines,invalid_lines invalidLines,total_amount_cents totalAmountCents
      FROM monthly_reconciliations WHERE id=?`).get(batch.reconciliationId) as Record<string, unknown>;
    this.enqueue({ operationType: 'local.result.publish', entityType: 'PAYROLL_BATCH', localEntityId: batchId,
      identity: { apiOrigin: identity.apiOrigin, installationUuid: identity.installationUuid, deviceUuid: identity.deviceUuid },
      localReady: false, payload: { manifestVersion: 1, appVersion: identity.appVersion, batch, reconciliation: rec } });
  }
  confirmLocalResult(batchId: number): void {
    this.db.prepare("UPDATE sync_outbox SET local_ready=1,updated_at=? WHERE operation_type='local.result.publish' AND local_entity_id=? AND status IN ('PENDING','FAILED')")
      .run(new Date().toISOString(), batchId);
  }
  failLocalResult(batchId: number): void {
    this.db.prepare("UPDATE sync_outbox SET status='FAILED',last_error_code='LOCAL_RESULT_FAILED',last_error_message=?,updated_at=? WHERE operation_type='local.result.publish' AND local_entity_id=? AND local_ready=0")
      .run(syncMessage('LOCAL_RESULT_FAILED'), new Date().toISOString(), batchId);
  }
  recoverInterrupted(now = Date.now()): void {
    const timestamp = new Date(now).toISOString();
    this.db.transaction(() => {
      this.db.prepare("UPDATE sync_outbox SET status='RETRY',next_attempt_at=?,last_error_code='INTERRUPTED',last_error_message=?,updated_at=? WHERE status='IN_PROGRESS'")
        .run(timestamp, syncMessage('INTERRUPTED'), timestamp);
      this.db.prepare("UPDATE sync_outbox SET status='FAILED',last_error_code='LOCAL_REPORTS_UNCONFIRMED',last_error_message=?,updated_at=? WHERE local_ready=0 AND status='PENDING'")
        .run(syncMessage('LOCAL_REPORTS_UNCONFIRMED'), timestamp);
    }).immediate();
  }
  claim(types: readonly string[], now: number, maximumAttempts = 100): OutboxRow | null {
    if (!types.length) return null;
    return this.db.transaction(() => {
      this.db.prepare(`UPDATE sync_outbox SET status='FAILED',last_error_code='RETRY_LIMIT',last_error_message=?,updated_at=?
        WHERE status IN ('PENDING','RETRY') AND cycle_attempts>=? AND operation_type IN (${types.map(() => '?').join(',')})`)
        .run(syncMessage('RETRY_LIMIT'), new Date(now).toISOString(), maximumAttempts, ...types);
      const row = this.db.prepare(`SELECT o.* FROM sync_outbox o WHERE o.status IN ('PENDING','RETRY') AND o.local_ready=1
        AND (o.next_attempt_at IS NULL OR o.next_attempt_at<=?) AND o.operation_type IN (${types.map(() => '?').join(',')})
        AND (o.depends_on IS NULL OR EXISTS(SELECT 1 FROM sync_outbox p WHERE p.operation_uuid=o.depends_on AND p.status='SYNCED'))
        ORDER BY o.id LIMIT 1`).get(new Date(now).toISOString(), ...types) as OutboxRow | undefined;
      if (!row) return null;
      this.db.prepare("UPDATE sync_outbox SET status='IN_PROGRESS',attempts=attempts+1,cycle_attempts=cycle_attempts+1,updated_at=? WHERE id=?")
        .run(new Date(now).toISOString(), row.id);
      return this.get(row.operation_uuid);
    }).immediate();
  }
  finish(uuid: string, resourceUuid: string, now: number): void {
    if (!z.string().uuid().safeParse(resourceUuid).success) throw new SyncError('ACK_MISMATCH');
    const row = this.get(uuid);
    if (!row || row.status !== 'IN_PROGRESS' || (row.central_entity_uuid && row.central_entity_uuid !== resourceUuid)) throw new SyncError('ACK_MISMATCH');
    this.db.prepare(`UPDATE sync_outbox SET status='SYNCED',central_entity_uuid=?,completed_at=?,updated_at=?,next_attempt_at=NULL,
      last_error_code=NULL,last_error_message=NULL,last_http_status=NULL WHERE operation_uuid=?`).run(resourceUuid, new Date(now).toISOString(), new Date(now).toISOString(), uuid);
  }
  fail(uuid: string, status: 'RETRY' | 'FAILED' | 'CONFLICT', code: string, http: number | null, next: number | null, now: number): void {
    this.db.prepare(`UPDATE sync_outbox SET status=?,last_error_code=?,last_error_message=?,last_http_status=?,next_attempt_at=?,updated_at=?
      WHERE operation_uuid=? AND status='IN_PROGRESS'`).run(status, code, syncMessage(code), http, next === null ? null : new Date(next).toISOString(), new Date(now).toISOString(), uuid);
  }
  canRetry(row: OutboxRow, types: readonly string[], now: number): boolean {
    return types.includes(row.operation_type) && row.local_ready === 1 && ['RETRY', 'FAILED'].includes(row.status)
      && (!row.depends_on || Boolean(this.db.prepare("SELECT 1 FROM sync_outbox WHERE operation_uuid=? AND status='SYNCED'").get(row.depends_on)))
      && retryableCodes.has(row.last_error_code ?? '') && (!row.next_attempt_at || Date.parse(row.next_attempt_at) <= now)
      && (row.last_http_status === null || [401, 403, 408, 429, 500, 502, 503, 504].includes(row.last_http_status));
  }
  retry(uuid: string, types: readonly string[], now: number): boolean {
    const row = this.get(uuid); if (!row || !this.canRetry(row, types, now)) return false;
    this.db.prepare("UPDATE sync_outbox SET status='PENDING',cycle_attempts=0,next_attempt_at=NULL,updated_at=? WHERE operation_uuid=?")
      .run(new Date(now).toISOString(), uuid); return true;
  }
  summary(types: readonly string[]) {
    const counts = this.db.prepare(`SELECT COALESCE(SUM(status IN ('PENDING','RETRY')),0) pending,
      COALESCE(SUM(status='IN_PROGRESS'),0) inProgress,COALESCE(SUM(status='SYNCED'),0) synced,
      COALESCE(SUM(status='FAILED'),0) failed,COALESCE(SUM(status='CONFLICT'),0) conflicts,
      MAX(completed_at) lastCompletedAt,MIN(CASE WHEN status='RETRY' THEN next_attempt_at END) nextAttemptAt FROM sync_outbox`).get() as {
        pending: number; inProgress: number; synced: number; failed: number; conflicts: number; lastCompletedAt: string | null; nextAttemptAt: string | null };
    const waitingAdapter = (this.db.prepare(`SELECT COUNT(*) n FROM sync_outbox WHERE status IN ('PENDING','RETRY')
      ${types.length ? `AND operation_type NOT IN (${types.map(() => '?').join(',')})` : ''}`).get(...types) as { n: number }).n;
    return { ...counts, waitingAdapter };
  }
  page(query: SyncQuery, types: readonly string[], now: number): { items: SyncEntry[]; total: number } {
    const where = `${query.status === 'all' ? '1=1' : 'status=?'} AND (operation_uuid LIKE ? ESCAPE '\\' OR entity_type LIKE ? ESCAPE '\\')`;
    const term = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`; const params = [...(query.status === 'all' ? [] : [query.status]), term, term];
    const total = (this.db.prepare(`SELECT COUNT(*) n FROM sync_outbox WHERE ${where}`).get(...params) as { n: number }).n;
    const rows = this.db.prepare(`SELECT ${diagnosticColumns} FROM sync_outbox WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, query.pageSize, (query.page - 1) * query.pageSize) as OutboxRow[];
    return { total, items: rows.map(row => this.dto(row, types, now)) };
  }
  detail(uuid: string, types: readonly string[], now: number): SyncDetail | null {
    const row = this.db.prepare(`SELECT ${diagnosticColumns} FROM sync_outbox WHERE operation_uuid=?`).get(uuid) as OutboxRow | undefined;
    return row ? { ...this.dto(row, types, now), payloadHashSha256: row.payload_hash_sha256,
      httpStatus: row.last_http_status, dependsOn: row.depends_on, supersedes: row.supersedes } : null;
  }
  private dto(row: OutboxRow, types: readonly string[], now: number): SyncEntry {
    const pendingCode = !row.local_ready ? 'LOCAL_REPORTS_PENDING' : !types.includes(row.operation_type) ? 'WAITING_ADAPTER'
      : row.depends_on && !this.db.prepare("SELECT 1 FROM sync_outbox WHERE operation_uuid=? AND status='SYNCED'").get(row.depends_on) ? 'WAITING_DEPENDENCY' : null;
    return { operationUuid: row.operation_uuid, operationType: row.operation_type, entityType: row.entity_type, localEntityId: row.local_entity_id,
      centralEntityUuid: row.central_entity_uuid, status: row.status, attempts: row.attempts, nextAttemptAt: row.next_attempt_at,
      errorCode: row.last_error_code, message: row.status === 'SYNCED' ? 'Finalización confirmada por Laravel.' : syncMessage(row.last_error_code ?? pendingCode),
      createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at, canRetry: this.canRetry(row, types, now) };
  }
}
