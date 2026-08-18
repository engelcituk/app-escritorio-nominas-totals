import { describe, expect, it } from 'vitest';
import { PayrollType } from '../../src/shared/enums/payroll.js';
import { processImportGroupRequestSchema } from '../../src/shared/schemas/ipc.js';

const token1 = '11111111-1111-4111-8111-111111111111';
const token2 = '22222222-2222-4222-8222-222222222222';
const base = { year: 2026,
  files: [{ fileToken: token1, fortnight: 2, payrollType: PayrollType.SUELDOS, selectedConceptIds: [1],
    retainedEmployeeNumbers: ['0007', '0007'], missingAcknowledged: false },
  { fileToken: token2, fortnight: 21, payrollType: PayrollType.ASIMILADOS, selectedConceptIds: [1, 3],
    retainedEmployeeNumbers: [], missingAcknowledged: false }] };

describe('contrato de expedientes', () => {
  it('acepta quincenas arbitrarias y normaliza retenidos por archivo', () => {
    const parsed = processImportGroupRequestSchema.parse(base);
    expect(parsed.files[0]?.retainedEmployeeNumbers).toEqual(['0007']);
  });
  it('rechaza una quincena fuera del año operativo', () => {
    expect(() => processImportGroupRequestSchema.parse({ ...base, files: [{ ...base.files[0], fortnight: 25 }] })).toThrow();
  });
  it('rechaza el mismo token dos veces', () => {
    expect(() => processImportGroupRequestSchema.parse({ ...base, files: [base.files[0], base.files[0]] })).toThrow();
  });
});
