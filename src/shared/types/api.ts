import type { HistoryQuery } from '../schemas/ipc.js';
import type { BatchSummary, PreflightResult, ProcessPayrollRequest, ProcessingProgress, ProcessResult, SelectedFile } from './payroll.js';

export interface SefiplanApi {
  selectTxtFile(): Promise<SelectedFile | null>;
  inspectTxtFile(payload: { fileToken: string }): Promise<PreflightResult>;
  selectExportDirectory(): Promise<{ token: string; name: string } | null>;
  processPayrollFile(payload: ProcessPayrollRequest): Promise<{ processId: string }>;
  cancelProcessing(processId: string): Promise<boolean>;
  subscribeToProgress(callback: (progress: ProcessingProgress) => void): () => void;
  subscribeToCompletion(callback: (result: ProcessResult) => void): () => void;
  getBatchHistory(filters: HistoryQuery): Promise<{ items: BatchSummary[]; total: number }>;
  openReportFolder(batchId: number): Promise<boolean>;
  createBackup(): Promise<{ path: string } | null>;
  restoreBackup(): Promise<{ restored: boolean; automaticBackupPath: string } | null>;
  getSettings(): Promise<Record<string, string>>;
  updateSettings(payload: Record<string, string>): Promise<void>;
}
