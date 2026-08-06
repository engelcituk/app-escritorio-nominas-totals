import type { ParsedPayrollRecord } from '../types/payroll.js';

export const UNIFORM_PAYROLL_LAYOUT = {
  code: 'UNIFORM_PAYROLL_V1',
  version: 1,
  delimiter: '|',
  minimumColumns: 22,
  expectedColumns: 22,
  fields: {
    dependencyKeyParts: [0, 1, 2, 3],
    employeeNumber: 4,
    employeeName: 11,
    positionName: 12,
    movementType: 14,
    movementClassifier: 15,
    conceptCode: 16,
    conceptDescription: 17,
    amount: 18,
    accountCode: 19,
    fundingSource: 20,
    paymentCenter: 21,
  },
} as const;

export type UniformField = keyof typeof UNIFORM_PAYROLL_LAYOUT.fields;

export function mapUniformColumns(columns: readonly string[]): Omit<ParsedPayrollRecord, 'lineNumber'> {
  const f = UNIFORM_PAYROLL_LAYOUT.fields;
  const dependencyParts = f.dependencyKeyParts.map((index) => columns[index]?.trim() ?? '');
  const dependencyKey = `${dependencyParts[0]}${dependencyParts[1]}${dependencyParts[2]}-${dependencyParts[3]}`;
  return {
    dependencyKey,
    employeeNumber: columns[f.employeeNumber]?.trim() ?? '',
    employeeName: columns[f.employeeName]?.trim() ?? '',
    positionName: columns[f.positionName]?.trim() ?? '',
    movementType: columns[f.movementType]?.trim() ?? '',
    movementClassifier: columns[f.movementClassifier]?.trim() ?? '',
    conceptCode: columns[f.conceptCode]?.trim() ?? '',
    conceptDescriptionOriginal: columns[f.conceptDescription]?.trim() ?? '',
    amountRaw: columns[f.amount]?.trim() ?? '',
    accountCode: columns[f.accountCode]?.trim() ?? '',
    fundingSource: columns[f.fundingSource]?.trim() ?? '',
    paymentCenter: columns[f.paymentCenter]?.trim() ?? '',
  };
}
