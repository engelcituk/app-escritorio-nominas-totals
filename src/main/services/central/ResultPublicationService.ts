import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rename, stat, statfs, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';
import { batchPayloadSchema, reconciliationPayloadSchema, sha256Schema } from './resultContracts.js';
import { SyncOutboxService, type OutboxRow } from './SyncOutboxService.js';
import { canonicalPayload, SyncError, syncMessage } from './syncContracts.js';

export interface FrozenReport { parent_uuid: string; report_type: 'SOURCE' | 'MONTHLY_TOTALS'; original_filename: string; size_bytes: number; sha256: string; generated_at: string }
interface Publication { parent_uuid: string; reconciliation_id: number; revision: number; reconciliation_json: string; batch_json: string }
export function reportFilePath(databasePath: string, sha256: string): string {
  if (!sha256Schema.safeParse(sha256).success) throw new SyncError('REPORT_FILE_INVALID');
  return join(dirname(databasePath), 'sync-files', `${sha256}.xlsx`);
}
export async function verifyReportFile(path: string, hash: string, size?: number): Promise<number> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size < 1 || info.size > 100 * 1024 * 1024 || (size !== undefined && size !== info.size)) throw new SyncError('REPORT_FILE_INVALID');
    const digest = createHash('sha256'); for await (const chunk of createReadStream(path)) digest.update(chunk);
    if (digest.digest('hex') !== hash) throw new SyncError('REPORT_FILE_INVALID'); return info.size;
  } catch (error) { if (error instanceof SyncError) throw error; throw new SyncError('REPORT_FILE_MISSING'); }
}

/** Captures a local revision once. Paths remain in main; only immutable metadata is queued. */
export class ResultPublicationService {
  constructor(private readonly db: Database.Database, private readonly databasePath: string) {}
  async capture(batchId: number): Promise<void> {
    const parent = this.db.prepare("SELECT * FROM sync_outbox WHERE operation_type='local.result.publish' AND local_entity_id=?").get(batchId) as OutboxRow | undefined;
    if (!parent || this.db.prepare('SELECT 1 FROM sync_publications WHERE parent_uuid=?').get(parent.operation_uuid)) return;
    try {
      const manifest = JSON.parse(parent.payload_json) as { reconciliation: { revision: number } };
      const batch = this.db.prepare('SELECT * FROM payroll_batches WHERE id=?').get(batchId) as Record<string, string | number>;
      const rec = this.db.prepare('SELECT * FROM monthly_reconciliations WHERE id=?').get(batch.reconciliation_id) as Record<string, string | number>;
      if (rec.revision !== manifest.reconciliation.revision || !['COMPLETED', 'SUPERSEDED'].includes(String(batch.status))) throw new SyncError('HISTORICAL_REPORT_MISSING');
      const reconciliation = reconciliationPayloadSchema.parse({ year: rec.year, month: rec.month, conceptGroupUuid: batch.concept_group_uuid,
        status: 'COMPLETED', fileCount: rec.file_count, completedFiles: rec.completed_files, totalLines: rec.total_lines,
        validLines: Number(rec.total_lines) - Number(rec.excluded_lines) - Number(rec.invalid_lines), excludedLines: rec.excluded_lines,
        invalidLines: rec.invalid_lines, totalAmountCents: rec.total_amount_cents, startedAt: rec.started_at, completedAt: rec.completed_at });
      const wireBatch = batchPayloadSchema.parse({ payrollTypeUuid: batch.payroll_type_uuid, sourceOrder: batch.source_order, year: batch.year, month: batch.month,
        fortnight: (Number(batch.fortnight) - 1) % 2 + 1, layoutCode: batch.layout_code, layoutVersion: String(batch.layout_version),
        originalFilename: batch.original_filename, fileSize: batch.file_size, fileHashSha256: batch.file_hash_sha256,
        catalogRevision: batch.catalog_revision, status: 'COMPLETED', totalLines: batch.total_lines,
        validLines: Number(batch.valid_lines) + Number(batch.unclassified_lines), excludedLines: batch.excluded_lines, invalidLines: batch.invalid_lines,
        unclassifiedLines: batch.unclassified_lines, matchingLines: batch.valid_lines, totalAmountCents: batch.total_amount_cents,
        startedAt: batch.started_at, completedAt: batch.completed_at,
        conceptSnapshots: this.db.prepare('SELECT central_uuid conceptUuid,concept_code code,concept_name name,operation_factor operationFactor FROM batch_concept_snapshots WHERE batch_id=? ORDER BY central_uuid').all(batchId),
        aliasSnapshots: this.db.prepare('SELECT central_uuid aliasUuid,concept_uuid payrollConceptUuid,source_description sourceDescription,normalized_description normalizedDescription FROM batch_alias_snapshots WHERE batch_id=? ORDER BY central_uuid').all(batchId),
        totals: this.db.prepare(`SELECT s.central_uuid conceptUuid,COALESCE(SUM(t.record_count),0) lineCount,COALESCE(SUM(t.total_amount_cents),0) amountCents
          FROM batch_concept_snapshots s LEFT JOIN batch_totals t ON t.batch_id=s.batch_id AND t.source_concept_id=s.source_concept_id
          WHERE s.batch_id=? AND s.selected=1 GROUP BY s.central_uuid ORDER BY s.central_uuid`).all(batchId),
      });
      const reports: FrozenReport[] = [];
      for (const type of ['SOURCE', 'MONTHLY_TOTALS'] as const) {
        const artifact = this.db.prepare(type === 'SOURCE'
          ? "SELECT * FROM report_artifacts WHERE batch_id=? AND report_type='SOURCE'"
          : "SELECT * FROM report_artifacts WHERE reconciliation_id=? AND report_type='MONTHLY_TOTALS'")
          .get(type === 'SOURCE' ? batchId : batch.reconciliation_id) as { filename: string; file_path: string; file_hash_sha256: string; updated_at: string } | undefined;
        if (!artifact) throw new SyncError('REPORT_FILE_MISSING');
        const size = await verifyReportFile(artifact.file_path, artifact.file_hash_sha256);
        const target = reportFilePath(this.databasePath, artifact.file_hash_sha256);
        await mkdir(dirname(target), { recursive: true });
        const space = await statfs(dirname(target));
        if (space.bavail * space.bsize < size + 10 * 1024 * 1024) throw new SyncError('REPORT_STORAGE_FULL');
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
          await copyFile(artifact.file_path, temporary); await verifyReportFile(temporary, artifact.file_hash_sha256, size);
          // Existing content-addressed copies must also be verified; never silently overwrite corruption.
          try { await stat(target); await verifyReportFile(target, artifact.file_hash_sha256, size); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await rename(temporary, target); }
        } finally { await unlink(temporary).catch(() => undefined); }
        reports.push({ parent_uuid: parent.operation_uuid, report_type: type, original_filename: artifact.filename,
          size_bytes: size, sha256: artifact.file_hash_sha256, generated_at: artifact.updated_at });
      }
      this.db.transaction(() => {
        this.db.prepare('INSERT INTO sync_publications VALUES(?,?,?,?,?)').run(parent.operation_uuid, batch.reconciliation_id, rec.revision,
          canonicalPayload(reconciliation).json, canonicalPayload(wireBatch).json);
        for (const report of reports) this.db.prepare('INSERT INTO sync_report_files VALUES(@parent_uuid,@report_type,@original_filename,@size_bytes,@sha256,@generated_at)').run(report);
      })();
    } catch (error) {
      const code = error instanceof SyncError ? error.code : 'RESULT_CONTRACT_INVALID';
      this.db.prepare("UPDATE sync_outbox SET status='FAILED',last_error_code=?,last_error_message=?,updated_at=? WHERE operation_uuid=? AND status='PENDING'")
        .run(code, syncMessage(code), new Date().toISOString(), parent.operation_uuid);
    }
  }

  /** Called only while processing/restoration is idle. Recover phase-3 intents conservatively. */
  async prepare(): Promise<void> {
    const rows = this.db.prepare(`SELECT o.* FROM sync_outbox o JOIN payroll_batches b ON b.id=o.local_entity_id
      WHERE o.operation_type='local.result.publish' AND o.status='PENDING' AND o.local_ready=1
      AND NOT EXISTS (SELECT 1 FROM sync_outbox older JOIN payroll_batches ob ON ob.id=older.local_entity_id
        WHERE older.operation_type='local.result.publish' AND older.id<o.id AND older.status!='SYNCED' AND ob.reconciliation_id=b.reconciliation_id)
      AND NOT EXISTS (SELECT 1 FROM sync_delivery_steps s JOIN sync_outbox child ON child.operation_uuid=s.operation_uuid
        WHERE s.parent_uuid=o.operation_uuid AND child.status!='SYNCED') ORDER BY o.id LIMIT 100`).all() as OutboxRow[];
    for (const row of rows) {
      await this.capture(row.local_entity_id!);
      this.db.transaction(() => this.advance(row))();
    }
  }
  private advance(parent: OutboxRow): void {
    const publication = this.db.prepare('SELECT * FROM sync_publications WHERE parent_uuid=?').get(parent.operation_uuid) as Publication | undefined;
    if (!publication || new SyncOutboxService(this.db).get(parent.operation_uuid)?.status !== 'PENDING') return;
    // Include failed/unprepared older intents, not merely publications that already expanded.
    const older = this.db.prepare(`SELECT 1 FROM sync_outbox o JOIN payroll_batches b ON b.id=o.local_entity_id
      WHERE o.operation_type='local.result.publish' AND b.reconciliation_id=? AND o.id<? AND o.status!='SYNCED' LIMIT 1`).get(publication.reconciliation_id, parent.id);
    if (older) return;
    const steps = this.db.prepare(`SELECT o.*,s.step FROM sync_delivery_steps s JOIN sync_outbox o ON o.operation_uuid=s.operation_uuid WHERE s.parent_uuid=? ORDER BY s.step`).all(parent.operation_uuid) as Array<OutboxRow & { step: number }>;
    if (steps.some(step => step.status !== 'SYNCED')) return;
    const queue = new SyncOutboxService(this.db);
    if (steps.length === 4) {
      this.db.prepare("UPDATE sync_outbox SET status='IN_PROGRESS' WHERE operation_uuid=? AND status='PENDING'").run(parent.operation_uuid);
      queue.finish(parent.operation_uuid, steps[1]!.central_entity_uuid!, Date.now()); return;
    }
    const step = steps.length + 1;
    let payload: unknown;
    if (step === 1) payload = JSON.parse(publication.reconciliation_json);
    else if (step === 2) payload = JSON.parse(publication.batch_json);
    else {
      const report = this.db.prepare('SELECT * FROM sync_report_files WHERE parent_uuid=? AND report_type=?').get(parent.operation_uuid, step === 3 ? 'SOURCE' : 'MONTHLY_TOTALS') as FrozenReport;
      payload = { reportType: report.report_type, originalFilename: report.original_filename, sizeBytes: report.size_bytes, sha256: report.sha256,
        generatedAt: report.generated_at, ...(step === 3 ? { payrollBatchUuid: steps[1]!.central_entity_uuid } : { monthlyReconciliationUuid: steps[0]!.central_entity_uuid }) };
    }
    const uuid = queue.enqueue({ operationType: step === 1 ? 'reconciliation.upsert' : step === 2 ? 'batch.upsert' : 'report.upload',
      entityType: step === 1 ? 'MONTHLY_RECONCILIATION' : step === 2 ? 'PAYROLL_BATCH' : step === 3 ? 'SOURCE' : 'MONTHLY_TOTALS',
      localEntityId: step === 1 ? publication.reconciliation_id : parent.local_entity_id!, payload,
      identity: { apiOrigin: parent.api_origin, deviceUuid: parent.device_uuid, installationUuid: parent.installation_uuid },
      ...(steps.length ? { dependsOn: steps.at(-1)!.operation_uuid } : {}) });
    this.db.prepare('INSERT INTO sync_delivery_steps VALUES(?,?,?)').run(parent.operation_uuid, step, uuid);
  }
}
