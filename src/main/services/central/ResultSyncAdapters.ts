import type { SyncAdapter, SyncAuth } from './SyncOrchestrator.js';
import type { SyncOutboxService, OutboxRow } from './SyncOutboxService.js';
import { batchPayloadSchema, reconciliationPayloadSchema, reportPayloadSchema, reportResponseSchema, resourceResponseSchema } from './resultContracts.js';
import { reportFilePath, verifyReportFile, type FrozenReport } from './ResultPublicationService.js';
import { SyncError } from './syncContracts.js';
import type { RemoteOperationType, SyncProgress } from '../../../shared/types/sync.js';

export function createResultAdapters(options: { auth: SyncAuth; databasePath: string;
  withOutbox: <T>(action: (queue: SyncOutboxService) => T) => T; progress: (value: SyncProgress | null) => void;
}): Record<RemoteOperationType, SyncAdapter> {
  const body = (row: OutboxRow, payload: Readonly<Record<string, unknown>>) => ({ ...payload, operationUuid: row.operation_uuid, payloadHashSha256: row.payload_hash_sha256 });
  const postResource = async (path: string, row: OutboxRow, payload: Readonly<Record<string, unknown>>, signal: AbortSignal) => {
    const response = await options.auth.requestAuthenticated({ method: 'POST', path, body: body(row, payload), schema: resourceResponseSchema, signal, maximumResponseBytes: 8 * 1024 * 1024 });
    if (response.kind !== 'data') throw new SyncError('ACK_MISMATCH'); return response.data.uuid;
  };
  const reportMetadata = async (row: OutboxRow, payload: Readonly<Record<string, unknown>>, signal: AbortSignal) => {
    const value = reportPayloadSchema.parse(payload);
    const owner = value.reportType === 'SOURCE' ? value.payrollBatchUuid : value.monthlyReconciliationUuid;
    const path = `/api/v1/${value.reportType === 'SOURCE' ? 'batches' : 'reconciliations'}/${owner}/reports`;
    const response = await options.auth.requestAuthenticated({ path, method: 'POST', schema: reportResponseSchema, body: body(row, payload), signal });
    if (response.kind !== 'data') throw new SyncError('ACK_MISMATCH');
    const report = response.data;
    if (report.operationUuid !== row.operation_uuid || report.reportType !== value.reportType || report.sha256 !== value.sha256
      || report.sizeBytes !== value.sizeBytes || report.originalFilename !== value.originalFilename
      || (value.reportType === 'SOURCE' ? report.payrollBatchUuid !== owner || report.monthlyReconciliationUuid !== null
        : report.monthlyReconciliationUuid !== owner || report.payrollBatchUuid !== null)) throw new SyncError('ACK_MISMATCH');
    return report;
  };
  return {
    'reconciliation.upsert': {
      validatePayload(payload) { if (!reconciliationPayloadSchema.safeParse(payload).success) throw new SyncError('RESULT_CONTRACT_INVALID'); },
      execute: (row, payload, signal) => postResource('/api/v1/reconciliations', row, payload, signal),
    },
    'batch.upsert': {
      validatePayload(payload) { if (!batchPayloadSchema.safeParse(payload).success) throw new SyncError('RESULT_CONTRACT_INVALID'); },
      execute(row, payload, signal) {
        const parent = options.withOutbox(queue => row.depends_on ? queue.get(row.depends_on) : null);
        if (!parent || parent.operation_type !== 'reconciliation.upsert' || parent.status !== 'SYNCED' || !parent.central_entity_uuid) throw new SyncError('ACK_MISMATCH');
        return postResource(`/api/v1/reconciliations/${parent.central_entity_uuid}/batches`, row, payload, signal);
      },
    },
    'report.upload': {
      validatePayload(payload) { if (!reportPayloadSchema.safeParse(payload).success) throw new SyncError('RESULT_CONTRACT_INVALID'); },
      async execute(row, payload, signal) {
        const value = reportPayloadSchema.parse(payload);
        const update = (stage: SyncProgress['stage'], bytesSent = 0) => options.progress({ operationUuid: row.operation_uuid, filename: value.originalFilename, stage, bytesSent, totalBytes: value.sizeBytes });
        try {
          update('REGISTERING');
          let report = await reportMetadata(row, payload, signal);
          if (report.uploadStatus === 'PENDING' || report.uploadStatus === 'FAILED') {
            const file = options.withOutbox(queue => queue.db.prepare(`SELECT f.* FROM sync_report_files f JOIN sync_delivery_steps s ON s.parent_uuid=f.parent_uuid
              WHERE s.operation_uuid=? AND f.report_type=?`).get(row.operation_uuid, value.reportType) as FrozenReport | undefined);
            if (!file || file.sha256 !== value.sha256 || file.size_bytes !== value.sizeBytes) throw new SyncError('REPORT_FILE_INVALID');
            const path = reportFilePath(options.databasePath, file.sha256);
            update('VERIFYING'); await verifyReportFile(path, file.sha256, file.size_bytes);
            update('UPLOADING');
            const uploaded = await options.auth.requestAuthenticated({ path: `/api/v1/reports/${report.uuid}/upload`, method: 'POST', schema: reportResponseSchema,
              signal, upload: { path, sizeBytes: file.size_bytes, onProgress: bytes => update('UPLOADING', bytes) } });
            if (uploaded.kind !== 'data' || uploaded.data.uuid !== report.uuid || uploaded.data.sha256 !== value.sha256 || uploaded.data.sizeBytes !== value.sizeBytes) throw new SyncError('ACK_MISMATCH');
            report = uploaded.data;
          }
          update('CONFIRMING', value.sizeBytes);
          const completed = await options.auth.requestAuthenticated({ path: `/api/v1/reports/${report.uuid}/complete`, method: 'POST', schema: reportResponseSchema, signal });
          if (completed.kind !== 'data' || completed.data.uuid !== report.uuid || completed.data.uploadStatus !== 'AVAILABLE'
            || completed.data.sha256 !== value.sha256 || completed.data.sizeBytes !== value.sizeBytes) throw new SyncError('ACK_MISMATCH');
          return report.uuid;
        } finally { options.progress(null); }
      },
      async verifyCompleted(row, payload, resourceUuid, signal) {
        const report = await reportMetadata(row, payload, signal);
        if (report.uuid !== resourceUuid || report.uploadStatus !== 'AVAILABLE' || !report.uploadedAt) throw new SyncError('ACK_MISMATCH');
      },
    },
  };
}
