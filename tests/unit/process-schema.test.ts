import { describe, expect, it } from 'vitest';
import { processMonthlyImportRequestSchema } from '../../src/shared/schemas/ipc.js';

const token1 = '11111111-1111-4111-8111-111111111111';
const token2 = '22222222-2222-4222-8222-222222222222';
const base = { year: 2026, month: 7, conceptGroupId: 1,
  files: [{ fileToken: token1, fortnight: 13, payrollTypeId: 1, selectedConceptIds: [1],
    retainedEmployeeNumbers: ['0007', '0007'], missingAcknowledged: false, replaceActiveBatch: false },
  { fileToken: token2, fortnight: 14, payrollTypeId: 2, selectedConceptIds: [1, 3],
    retainedEmployeeNumbers: [], missingAcknowledged: false, replaceActiveBatch: false }] };

describe('contrato de expedientes', () => {
  it('acepta la pareja mensual y normaliza retenidos por archivo', () => {
    const parsed = processMonthlyImportRequestSchema.parse(base);
    expect(parsed.files[0]?.retainedEmployeeNumbers).toEqual(['0007']);
  });
  it('rechaza una quincena que no pertenece al mes', () => {
    expect(() => processMonthlyImportRequestSchema.parse({ ...base, files: [{ ...base.files[0], fortnight: 12 }] })).toThrow();
  });
  it('rechaza el mismo token dos veces', () => {
    expect(() => processMonthlyImportRequestSchema.parse({ ...base, files: [base.files[0], base.files[0]] })).toThrow();
  });
  it('rechaza dos archivos para la misma quincena y tipo en una actualización', () => {
    expect(() => processMonthlyImportRequestSchema.parse({ ...base, files: [base.files[0], { ...base.files[1], fortnight: 13, payrollTypeId: 1 }] })).toThrow();
  });
});
