import { describe, expect, it } from 'vitest';
import { fortnightsForMonth, monthForFortnight, parsePayrollFilename } from '../../src/shared/utils/payrollPeriod.js';

describe('periodos mensuales de nómina', () => {
  it('relaciona cada mes únicamente con sus dos quincenas', () => {
    expect(fortnightsForMonth(1)).toEqual([1, 2]);
    expect(fortnightsForMonth(7)).toEqual([13, 14]);
    expect(fortnightsForMonth(12)).toEqual([23, 24]);
    expect(monthForFortnight(14)).toBe(7);
  });

  it('extrae año, quincena y tipo del nombre uniforme', () => {
    expect(parsePayrollFilename('QNA_13_2026_HONORARIOS FASP.txt')).toEqual({
      year: 2026, fortnight: 13, payrollTypeCode: 'HONORARIOS_FASP',
    });
    expect(parsePayrollFilename('QNA_11_2026_SUELDOS.txt')?.payrollTypeCode).toBe('SUELDOS');
  });

  it('no infiere metadatos de nombres ambiguos', () => {
    expect(parsePayrollFilename('nomina-julio.txt')).toBeNull();
    expect(() => monthForFortnight(25)).toThrow('La quincena no es válida.');
  });
});
