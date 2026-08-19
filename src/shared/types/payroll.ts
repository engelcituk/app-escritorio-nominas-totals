import type { BatchStatus, ProcessingStage } from '../enums/payroll.js';

export interface SelectedFile { token: string; name: string; size: number; modifiedAt: string }
export interface ParsedPayrollRecord {
  lineNumber: number; dependencyKey: string; employeeNumber: string; employeeName: string; positionName: string;
  sourceKey: string; movementType: string; movementClassifier: string; conceptCode: string; conceptDescriptionOriginal: string;
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
export interface PayrollTypeSummary { id: number; code: string; name: string; active: boolean; used: boolean }
export interface PayrollTypeDraft { id?: number | undefined; code: string; name: string; active: boolean }
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
  suggestedYear: number | null; suggestedFortnight: number | null; suggestedPayrollTypeCode: string | null;
}

export interface ImportFileRequest {
  fileToken: string; fortnight: number; payrollTypeId: number; selectedConceptIds: number[];
  retainedEmployeeNumbers: string[]; missingAcknowledged: boolean; replaceActiveBatch: boolean;
}
export interface ProcessMonthlyImportRequest {
  reconciliationId?: number | undefined; year: number; month: number; conceptGroupId: number; files: ImportFileRequest[];
  exportDirectoryToken?: string | undefined;
}
export interface RetainedEmployeeMatch { fileToken: string; employeeNumber: string; employeeName: string | null; found: boolean; matchingRecords: number }
export interface RetainedValidationResult { matches: RetainedEmployeeMatch[]; missingCount: number }

export interface ProcessingProgress {
  processId: string; stage: ProcessingStage; bytesProcessed: number; totalBytes: number; percentage: number;
  linesProcessed: number; validRecords: number; excludedRecords: number; invalidRecords: number; matchedRecords: number;
  elapsedMilliseconds: number; reconciliationId?: number; activeFileIndex?: number; totalFiles?: number; activeFilename?: string;
}
export interface MonthlyReconciliationResult {
  processId: string; batchId: number; status: BatchStatus; totalAmountCents: number; totalLines: number;
  validLines: number; excludedLines: number; invalidLines: number; errorMessage?: string;
  reconciliationId?: number; batchIds?: number[]; monthlyReport?: string;
}
export interface BatchSummary {
  id: number; year: number; month: number; fortnight: number; payrollTypeId: number; payrollTypeCode: string; payrollTypeName: string;
  version: number; originalFilename: string; active: boolean;
  status: BatchStatus; totalLines: number; excludedLines: number; invalidLines: number; totalAmountCents: number; completedAt: string | null;
}
export interface MonthlyReconciliationSummary {
  id: number; year: number; month: number; conceptGroupId: number; conceptGroupCode: string; conceptGroupName: string;
  revision: number; status: BatchStatus; fortnights: number[]; fileCount: number;
  completedFiles: number; totalLines: number; excludedLines: number; invalidLines: number; totalAmountCents: number;
  completedAt: string | null; reportPath: string | null; batches: BatchSummary[];
}
