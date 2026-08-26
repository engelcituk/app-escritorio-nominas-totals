import type { HistoryQuery } from '../schemas/ipc.js';
import type { AuthStatus, LoginInput } from './auth.js';
import type { BatchSummary, ConceptAliasDraft, ConceptGroup, ConceptGroupDraft, MonthlyReconciliationResult,
  MonthlyReconciliationSummary, PayrollConcept, PayrollConceptDraft, PayrollTypeDraft, PayrollTypeSummary,
  PreflightResult, ProcessMonthlyImportRequest, ProcessingProgress,
  RetainedValidationResult, SelectedFile } from './payroll.js';

export interface SefiplanApi {
  auth: {
    login(input: LoginInput): Promise<AuthStatus>;
    logout(): Promise<AuthStatus>;
    status(): Promise<AuthStatus>;
    check(): Promise<AuthStatus>;
    onChanged(callback: (status: AuthStatus) => void): () => void;
  };
  openBackoffice(): Promise<void>;
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
  savePayrollType(payload: PayrollTypeDraft): Promise<number>;
  getConceptCatalog(): Promise<{ groups: ConceptGroup[]; concepts: PayrollConcept[] }>;
  saveConceptGroup(payload: ConceptGroupDraft): Promise<number>;
  savePayrollConcept(payload: PayrollConceptDraft): Promise<number>;
  addConceptAlias(payload: ConceptAliasDraft): Promise<number>;
  removeConceptAlias(aliasId: number): Promise<void>;
  createBackup(): Promise<{ path: string } | null>;
  restoreBackup(): Promise<{ restored: boolean; automaticBackupPath: string } | null>;
  getSettings(): Promise<Record<string, string>>;
  updateSettings(payload: Record<string, string>): Promise<void>;
}
