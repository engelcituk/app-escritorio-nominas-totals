import { reactive } from 'vue';
import { describe, expect, it } from 'vitest';
import { PayrollType } from '../../src/shared/enums/payroll.js';
import type { ProcessImportGroupRequest } from '../../src/shared/types/payroll.js';
import { serializeImportRequest } from '../../src/renderer/utils/serializeImportRequest.js';

describe('serialización de expedientes para Electron', () => {
  it('convierte los arreglos reactivos de conceptos en datos clonables', () => {
    const request: ProcessImportGroupRequest = {
      year: 2026,
      files: [{
        fileToken: '11111111-1111-4111-8111-111111111111',
        fortnight: 12,
        payrollType: PayrollType.SUELDOS,
        selectedConceptIds: reactive([3, 7, 9]),
        retainedEmployeeNumbers: reactive([] as string[]),
        missingAcknowledged: false,
      }],
    };

    expect(() => structuredClone(request)).toThrow();
    const serialized = serializeImportRequest(request);
    expect(() => structuredClone(serialized)).not.toThrow();
    expect(serialized.files[0]?.selectedConceptIds).toEqual([3, 7, 9]);
  });
});
