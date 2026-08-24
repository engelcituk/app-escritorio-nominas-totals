import { describe, expect, it } from 'vitest';
import { RecordStatus } from '../../src/shared/enums/payroll.js';
import type { ParsedPayrollRecord } from '../../src/shared/types/payroll.js';
import { ConceptMatcher, type ConceptMatchRule } from '../../src/main/services/ConceptMatcher.js';
import { PayrollRecordEvaluator } from '../../src/main/services/PayrollRecordEvaluator.js';

const record: ParsedPayrollRecord = { lineNumber: 1, dependencyKey: '1-1', employeeNumber: '0007', employeeName: 'PERSONA',
  positionName: 'PUESTO', movementType: 'P', movementClassifier: '1', conceptCode: '900',
  conceptDescriptionOriginal: 'REINTEGRO DE ISR PAGADO EN EXCESO', amountRaw: '125.50', accountCode: 'CUENTA',
  sourceKey: '1508-26-001', fundingSource: 'CO', paymentCenter: '1' };
const rule: ConceptMatchRule = { aliasId: 9, conceptId: 6, conceptCode: 'ISR_REINTEGRO_EXCESO', conceptName: 'Reintegro ISR',
  groupId: 1, groupCode: 'ISR', groupName: 'ISR', operationFactor: -1,
  normalizedDescription: 'REINTEGRO DE ISR PAGADO EN EXCESO' };

describe('evaluación firmada de ISR', () => {
  it('resta el reintegro seleccionado', () => {
    const result = new PayrollRecordEvaluator(new ConceptMatcher([rule]), new Set([6]), new Set()).evaluate(record);
    expect(result.status).toBe(RecordStatus.VALID);
    expect(result.amountCents).toBe(12550);
    expect(result.appliedAmountCents).toBe(-12550);
  });

  it('audita una variante no seleccionada', () => {
    const result = new PayrollRecordEvaluator(new ConceptMatcher([rule]), new Set(), new Set()).evaluate(record);
    expect(result.status).toBe(RecordStatus.EXCLUDED);
    expect(result.exclusionCategory).toBe('CONCEPT_NOT_SELECTED');
  });

  it('excluye todo el ISR de un empleado retenido conservando ceros', () => {
    const result = new PayrollRecordEvaluator(new ConceptMatcher([rule]), new Set([6]), new Set(['0007'])).evaluate(record);
    expect(result.status).toBe(RecordStatus.EXCLUDED);
    expect(result.exclusionCategory).toBe('RETAINED');
  });

  it('retiene al empleado aunque el concepto no esté seleccionado', () => {
    const result = new PayrollRecordEvaluator(new ConceptMatcher([rule]), new Set(), new Set(['0007'])).evaluate(record);
    expect(result.status).toBe(RecordStatus.EXCLUDED);
    expect(result.exclusionCategory).toBe('RETAINED');
  });

  it('retiene al empleado aunque el concepto no esté clasificado', () => {
    const result = new PayrollRecordEvaluator(new ConceptMatcher([]), new Set(), new Set(['0007'])).evaluate(record);
    expect(result.status).toBe(RecordStatus.EXCLUDED);
    expect(result.exclusionCategory).toBe('RETAINED');
  });

  it('no reconoce descripciones por coincidencias parciales', () => {
    expect(new ConceptMatcher([{ ...rule, normalizedDescription: 'ISR' }]).classify(record).matched).toBe(false);
  });
});
