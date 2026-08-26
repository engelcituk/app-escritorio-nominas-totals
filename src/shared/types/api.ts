import type { HistoryQuery } from '../schemas/ipc.js';
import type { AuthStatus, LoginInput } from './auth.js';
import type { CatalogAliasEntry, CatalogConflict, CatalogEntry, CatalogPage, CatalogQuery, CatalogStatus } from './catalog.js';
import type { SyncDetail, SyncEntry, SyncQuery, SyncStatus, SyncRemoteHistory } from './sync.js';
import type { BatchSummary, ConceptGroup, MonthlyReconciliationResult,
  MonthlyReconciliationSummary, PayrollTypeSummary,
  PreflightResult, ProcessMonthlyImportRequest, ProcessingProgress,
  RetainedValidationResult, SelectedFile } from './payroll.js';

export interface SefiplanApi {
  sync: {
    remoteHistory(query: { operationUuid: string }): Promise<SyncRemoteHistory>;
    status(): Promise<SyncStatus>; run(): Promise<SyncStatus>; checkConnection(): Promise<SyncStatus>;
    list(query: SyncQuery): Promise<{ items: SyncEntry[]; total: number }>;
    detail(query: { operationUuid: string }): Promise<SyncDetail | null>;
    retry(query: { operationUuid: string }): Promise<SyncStatus>;
    onChanged(callback: (status: SyncStatus) => void): () => void;
  };
  auth: {
    login(input: LoginInput): Promise<AuthStatus>;
    logout(): Promise<AuthStatus>;
    status(): Promise<AuthStatus>;
    check(): Promise<AuthStatus>;
    onChanged(callback: (status: AuthStatus) => void): () => void;
  };
  openBackoffice(): Promise<void>;
  catalog: {
    status(): Promise<CatalogStatus>;
    synchronize(): Promise<CatalogStatus>;
    onChanged(callback: (status: CatalogStatus) => void): () => void;
    list(query: CatalogQuery): Promise<CatalogPage<CatalogEntry>>;
    aliases(query: { id: number; page: number }): Promise<CatalogPage<CatalogAliasEntry>>;
    conflicts(query: { page: number }): Promise<CatalogPage<CatalogConflict>>;
    exportConflicts(): Promise<{ path: string } | null>;
  };
  selectTxtFiles(): Promise<SelectedFile[]>;
  inspectTxtFile(payload: { fileToken: string; includePreview: boolean }): Promise<PreflightResult>;
  selectExportDirectory(): Promise<{ token: string; name: string } | null>;
  processMonthlyImport(payload: ProcessMonthlyImportRequest): Promise<{ processId: string }>;
  validateRetainedEmployees(payload: { files: Array<Pick<ProcessMonthlyImportRequest['files'][number],
    'fileToken' | 'payrollTypeId' | 'selectedConceptIds' | 'retainedEmployeeNumbers'>> }): Promise<RetainedValidationResult>;
  cancelProcessing(processId: string): Promise<boolean>;
  subscribeToProgress(callback: (progress: ProcessingProgress) => void): () => void;
  subscribeToCompletion(callback: (result: MonthlyReconciliationResult) => void): () => void;
  getBatchHistory(filters: HistoryQuery): Promise<{ items: BatchSummary[]; total: number }>;
  getMonthlyHistory(filters: HistoryQuery): Promise<{ items: MonthlyReconciliationSummary[]; total: number }>;
  getOrCreateMonthlyReconciliation(payload: { year: number; month: number; conceptGroupId: number }): Promise<MonthlyReconciliationSummary>;
  openReportFolder(batchId: number): Promise<boolean>;
  openMonthlyReportFolder(reconciliationId: number): Promise<boolean>;
  getPayrollTypes(includeInactive?: boolean): Promise<PayrollTypeSummary[]>;
  getConceptGroups(): Promise<ConceptGroup[]>;
  createBackup(): Promise<{ path: string } | null>;
  restoreBackup(): Promise<{ restored: boolean; automaticBackupPath: string } | null>;
  getSettings(): Promise<Record<string, string>>;
  updateSettings(payload: Record<string, string>): Promise<void>;
}
