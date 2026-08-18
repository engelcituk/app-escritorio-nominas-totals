import type { HistoryQuery } from '../schemas/ipc.js';
import type { BatchSummary, ConceptAliasDraft, ConceptGroup, ConceptGroupDraft, ImportGroupSummary, PayrollConcept,
  PayrollConceptDraft, PreflightResult, ProcessImportGroupRequest, ProcessingProgress, ProcessResult,
  RetainedValidationResult, SelectedFile } from './payroll.js';

export interface SefiplanApi {
  selectTxtFiles(): Promise<SelectedFile[]>;
  inspectTxtFile(payload: { fileToken: string; includePreview: boolean }): Promise<PreflightResult>;
  selectExportDirectory(): Promise<{ token: string; name: string } | null>;
  processImportGroup(payload: ProcessImportGroupRequest): Promise<{ processId: string }>;
  resumeImportGroup(groupId: number): Promise<{ processId: string }>;
  validateRetainedEmployees(payload: { files: Array<Pick<ProcessImportGroupRequest['files'][number],
    'fileToken' | 'payrollType' | 'selectedConceptIds' | 'retainedEmployeeNumbers'>> }): Promise<RetainedValidationResult>;
  cancelProcessing(processId: string): Promise<boolean>;
  subscribeToProgress(callback: (progress: ProcessingProgress) => void): () => void;
  subscribeToCompletion(callback: (result: ProcessResult) => void): () => void;
  getBatchHistory(filters: HistoryQuery): Promise<{ items: BatchSummary[]; total: number }>;
  getImportGroupHistory(filters: HistoryQuery): Promise<{ items: ImportGroupSummary[]; total: number }>;
  openReportFolder(batchId: number): Promise<boolean>;
  openGroupReportFolder(groupId: number): Promise<boolean>;
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
