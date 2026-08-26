export type OutboxStatus = 'PENDING' | 'IN_PROGRESS' | 'RETRY' | 'SYNCED' | 'FAILED' | 'CONFLICT';
export type RemoteOperationType = 'reconciliation.upsert' | 'batch.upsert' | 'report.upload';
export type OutboxOperationType = RemoteOperationType | 'local.result.publish';
export interface SyncQuery { page: number; pageSize: number; status: OutboxStatus | 'all'; search: string }
export interface SyncEntry {
  operationUuid: string; operationType: OutboxOperationType; entityType: string; localEntityId: number | null;
  centralEntityUuid: string | null; status: OutboxStatus; attempts: number; nextAttemptAt: string | null;
  errorCode: string | null; message: string; createdAt: string; updatedAt: string; completedAt: string | null;
  canRetry: boolean;
}
export interface SyncDetail extends SyncEntry { payloadHashSha256: string; httpStatus: number | null; dependsOn: string | null; supersedes: string | null }
export interface SyncStatus {
  progress?: SyncProgress | null;
  state: 'UNCONFIGURED' | 'AUTH_REQUIRED' | 'OFFLINE' | 'PAUSED' | 'RUNNING' | 'WAITING_ADAPTER' | 'IDLE' | 'ERROR';
  busy: boolean; message: string; canRun: boolean; canCheckConnection: boolean;
  pending: number; inProgress: number; synced: number; failed: number; conflicts: number; waitingAdapter: number;
  lastCompletedAt: string | null; nextAttemptAt: string | null;
}
export interface SyncProgress { operationUuid: string; filename: string; stage: 'REGISTERING' | 'VERIFYING' | 'UPLOADING' | 'CONFIRMING'; bytesSent: number; totalBytes: number }
export interface SyncRemoteHistory {
  uuid: string; year: number; month: number; status: string; revision: number; totalLines: number; validLines: number;
  excludedLines: number; invalidLines: number; totalAmountCents: number; checkedAt: string;
  batches: Array<{ uuid: string; payrollTypeUuid: string; fortnight: number; version: number; status: string; active: boolean; originalFilename: string; totalAmountCents: number }>;
}
