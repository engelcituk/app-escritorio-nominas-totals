import type { BatchStatus, PayrollType, ProcessingStage } from '../enums/payroll.js';

export interface SelectedFile {
  token: string;
  name: string;
  size: number;
  modifiedAt: string;
}

export interface ParsedPayrollRecord {
  lineNumber: number;
  dependencyKey: string;
  employeeNumber: string;
  employeeName: string;
  positionName: string;
  movementType: string;
  movementClassifier: string;
  conceptCode: string;
  conceptDescriptionOriginal: string;
  amountRaw: string;
  accountCode: string;
  fundingSource: string;
  paymentCenter: string;
}

export interface PreviewRecord extends ParsedPayrollRecord {
  amountCents: number | null;
  valid: boolean;
  errors: string[];
}

export interface PreflightResult {
  file: SelectedFile;
  delimiter: '|';
  columnCount: number;
  layoutCode: string;
  layoutVersion: number;
  encoding: 'UTF-8';
  sampleSize: number;
  validPercentage: number;
  canProcess: boolean;
  preview: PreviewRecord[];
  errors: string[];
  warnings: string[];
}

export interface ExclusionOptions {
  retained: boolean;
  cancelled: boolean;
  other: boolean;
  includeAudit: boolean;
}

export interface ProcessPayrollRequest {
  fileToken: string;
  year: number;
  fortnight: number;
  payrollType: PayrollType;
  conceptFamily: 'ISR';
  exportDirectoryToken?: string;
  exclusions: ExclusionOptions;
  duplicateAction?: 'CANCEL' | 'REPLACE' | 'NEW_VERSION';
}

export interface ProcessingProgress {
  processId: string;
  stage: ProcessingStage;
  bytesProcessed: number;
  totalBytes: number;
  percentage: number;
  linesProcessed: number;
  validRecords: number;
  excludedRecords: number;
  invalidRecords: number;
  matchedRecords: number;
  elapsedMilliseconds: number;
}

export interface ProcessResult {
  processId: string;
  batchId: number;
  status: BatchStatus;
  totalAmountCents: number;
  totalLines: number;
  validLines: number;
  excludedLines: number;
  invalidLines: number;
  detailReport?: string;
  totalsReport?: string;
  errorMessage?: string;
}

export interface BatchSummary {
  id: number;
  year: number;
  fortnight: number;
  payrollType: PayrollType;
  version: number;
  originalFilename: string;
  status: BatchStatus;
  totalLines: number;
  excludedLines: number;
  invalidLines: number;
  totalAmountCents: number;
  completedAt: string | null;
}
