import type { ParsedPayrollRecord } from '../types/payroll.js';

export const UNIFORM_PAYROLL_LAYOUT = {
  code: 'UNIFORM_PAYROLL_V1',
  version: 1,
  delimiter: '|',
  minimumColumns: 22,
  expectedColumns: 22,
  fields: {
    // Provisional: pending confirmation from the source-system data dictionary.
    component: 0,
    fundingSource: 1,
    employeeNumber: 4,
    employeeName: 11,
    positionName: 12,
    movementType: 14,
    movementClassifier: 15,
    conceptCode: 16,
    conceptDescription: 17,
    amount: 18,
    accountCode: 19,
    controlCode: 20,
    finalIndicator: 21,
  },
} as const;

export type UniformField = keyof typeof UNIFORM_PAYROLL_LAYOUT.fields;

export function mapUniformColumns(columns: readonly string[]): Omit<ParsedPayrollRecord, 'lineNumber'> {
  const f = UNIFORM_PAYROLL_LAYOUT.fields;
  return {
    component: columns[f.component]?.trim() ?? '',
    fundingSource: columns[f.fundingSource]?.trim() ?? '',
    employeeNumber: columns[f.employeeNumber]?.trim() ?? '',
    employeeName: columns[f.employeeName]?.trim() ?? '',
    positionName: columns[f.positionName]?.trim() ?? '',
    movementType: columns[f.movementType]?.trim() ?? '',
    movementClassifier: columns[f.movementClassifier]?.trim() ?? '',
    conceptCode: columns[f.conceptCode]?.trim() ?? '',
    conceptDescriptionOriginal: columns[f.conceptDescription]?.trim() ?? '',
    amountRaw: columns[f.amount]?.trim() ?? '',
    accountCode: columns[f.accountCode]?.trim() ?? '',
    controlCode: columns[f.controlCode]?.trim() ?? '',
    finalIndicator: columns[f.finalIndicator]?.trim() ?? '',
  };
}
