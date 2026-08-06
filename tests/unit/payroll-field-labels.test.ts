import { describe, expect, it } from 'vitest';
import { PAYROLL_FIELD_LABELS } from '../../src/shared/payroll-layouts/payrollFieldLabels.js';

describe('etiquetas visibles del layout de nómina', () => {
  it('usa la nomenclatura contable confirmada', () => {
    expect(PAYROLL_FIELD_LABELS.fundingSource).toBe('Fuente de financiamiento');
    expect(PAYROLL_FIELD_LABELS.paymentCenter).toBe('Centro de pago');
    expect(PAYROLL_FIELD_LABELS.dependencyKey).toBe('Clave dependencia');
  });
});
