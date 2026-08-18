import type { BatchStatus, PayrollType, ProcessingStage } from '../enums/payroll.js';

export interface SelectedFile { token: string; name: string; size: number; modifiedAt: string }
export interface ParsedPayrollRecord {
  lineNumber: number; dependencyKey: string; employeeNumber: string; employeeName: string; positionName: string;
  movementType: string; movementClassifier: string; conceptCode: string; conceptDescriptionOriginal: string;
  amountRaw: string; accountCode: string; fundingSource: string; paymentCenter: string;
}
export interface PreviewRecord extends ParsedPayrollRecord { amountCents: number | null; valid: boolean; errors: string[] }

export interface ConceptGroup { id: number; code: string; name: string; active: boolean }
export interface ConceptAlias { id: number; conceptId: number; sourceDescription: string; normalizedDescription: string; active: boolean }
export interface PayrollConcept {
  id: number; code: string; name: string; groupId: number | null; groupName: string | null;
  operationFactor: 1 | -1; active: boolean; aliases: ConceptAlias[];
}
export interface ConceptGroupDraft { id?: number; code: string; name: string; active: boolean }
export interface PayrollConceptDraft {
  id?: number; code: string; name: string; groupId: number | null; operationFactor: 1 | -1; active: boolean;
  sourceDescription?: string;
}
export interface ConceptAliasDraft { conceptId: number; sourceDescription: string }
export interface DetectedConcept {
  key: string; sourceDescription: string; normalizedDescription: string; conceptCodes: string[]; movementTypes: string[];
  recordCount: number; originalAmountCents: number; catalogConcept: Omit<PayrollConcept, 'aliases'> | null;
}
export interface PreflightResult {
  file: SelectedFile; fileHashSha256: string; historicalDuplicateBatchId: number | null; delimiter: '|'; columnCount: number;
  layoutCode: string; layoutVersion: number; encoding: 'UTF-8'; totalLines: number; sampleSize: number;
  validPercentage: number; canProcess: boolean; preview: PreviewRecord[]; detectedConcepts: DetectedConcept[];
  errors: string[]; warnings: string[];
}

export interface ImportFileRequest {
  fileToken: string; fortnight: number; payrollType: PayrollType; selectedConceptIds: number[];
  retainedEmployeeNumbers: string[]; missingAcknowledged: boolean; duplicateDecision?: 'REPROCESS' | undefined;
}
export interface ProcessImportGroupRequest { year: number; files: ImportFileRequest[]; exportDirectoryToken?: string | undefined; replacedGroupId?: number | undefined }
export interface RetainedEmployeeMatch { fileToken: string; employeeNumber: string; employeeName: string | null; found: boolean; matchingRecords: number }
export interface RetainedValidationResult { matches: RetainedEmployeeMatch[]; missingCount: number }

export interface ProcessingProgress {
  processId: string; stage: ProcessingStage; bytesProcessed: number; totalBytes: number; percentage: number;
  linesProcessed: number; validRecords: number; excludedRecords: number; invalidRecords: number; matchedRecords: number;
  elapsedMilliseconds: number; groupId?: number; activeFileIndex?: number; totalFiles?: number; activeFilename?: string;
}
export interface ProcessResult {
  processId: string; batchId: number; status: BatchStatus; totalAmountCents: number; totalLines: number;
  validLines: number; excludedLines: number; invalidLines: number; detailReport?: string; totalsReport?: string;
  errorMessage?: string; groupId?: number; batchIds?: number[]; groupReport?: string;
}
export interface BatchSummary {
  id: number; year: number; fortnight: number; payrollType: PayrollType; version: number; attempt: number; originalFilename: string;
  status: BatchStatus; totalLines: number; excludedLines: number; invalidLines: number; totalAmountCents: number; completedAt: string | null;
}
export interface ImportGroupSummary {
  id: number; year: number; version: number; status: BatchStatus; fortnights: number[]; fileCount: number;
  completedFiles: number; totalLines: number; excludedLines: number; invalidLines: number; totalAmountCents: number;
  completedAt: string | null; batches: BatchSummary[];
}
