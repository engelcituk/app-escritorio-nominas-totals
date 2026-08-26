import { describe, expect, it } from 'vitest';
import { INITIAL_PAYROLL_TYPES } from '../fixtures/legacy-catalog.mjs';

describe('catálogo inicial de tipos de nómina', () => {
  it('siembra los 30 productos en el orden institucional', () => {
    expect(INITIAL_PAYROLL_TYPES).toHaveLength(30);
    expect(INITIAL_PAYROLL_TYPES[0]).toEqual(['SUELDOS', 'Nómina ordinaria']);
    expect(INITIAL_PAYROLL_TYPES[1]).toEqual(['COMPENSACION', 'Compensación']);
    expect(INITIAL_PAYROLL_TYPES[29]).toEqual(['ESTIMULOS_EXTRAORDINARIOS_COMPLEMENTARIA', 'Estímulos extraordinarios complementaria']);
    expect(new Set(INITIAL_PAYROLL_TYPES.map(([code])=>code)).size).toBe(30);
  });
});
