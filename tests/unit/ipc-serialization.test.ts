import { reactive } from 'vue';
import { describe, expect, it } from 'vitest';
import type { ProcessMonthlyImportRequest } from '../../src/shared/types/payroll.js';
import { serializeImportRequest } from '../../src/renderer/utils/serializeImportRequest.js';

describe('serialización de expedientes para Electron', () => {
  it('convierte los arreglos reactivos de conceptos en datos clonables', () => {
    const request: ProcessMonthlyImportRequest = {
      reconciliationId: 4, catalogRevision: 1, year: 2026, month: 6, conceptGroupId: 1,
      files: [{
        fileToken: '11111111-1111-4111-8111-111111111111',
        fortnight: 12,
        payrollTypeId: 1,
        selectedConceptIds: reactive([3, 7, 9]),
        retainedEmployeeNumbers: reactive([] as string[]),
        missingAcknowledged: false,
        replaceActiveBatch: false,
      }],
    };

    expect(() => structuredClone(request)).toThrow();
    const serialized = serializeImportRequest(request);
    expect(() => structuredClone(serialized)).not.toThrow();
    expect(serialized.files[0]?.selectedConceptIds).toEqual([3, 7, 9]);
    expect(serialized.reconciliationId).toBe(4);
  });
});
