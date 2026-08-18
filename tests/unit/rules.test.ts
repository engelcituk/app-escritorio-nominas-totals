import { describe, expect, it } from 'vitest';
import type { ParsedPayrollRecord } from '../../src/shared/types/payroll.js';
import { ConceptMatcher, type ConceptMatchRule } from '../../src/main/services/ConceptMatcher.js';

const record: ParsedPayrollRecord = { lineNumber: 1, dependencyKey: '21111061-06', employeeNumber: '1', employeeName: 'SINTETICO',
  positionName: 'PUESTO', movementType: 'D', movementClassifier: '2', conceptCode: '101', conceptDescriptionOriginal: 'I S R POR SALARIOS',
  amountRaw: '790.20', accountCode: 'CUENTA', fundingSource: 'CO', paymentCenter: '1' };
const base: ConceptMatchRule = { aliasId: 1, conceptId: 1, conceptCode: 'ISR_POR_SALARIOS', conceptName: 'ISR por salarios',
  groupId: 1, groupCode: 'ISR', groupName: 'ISR', operationFactor: 1, normalizedDescription: 'ISR POR SALARIOS' };

describe('ConceptMatcher', () => {
  it('reconoce el alias exacto tras normalizar espacios de I S R', () => {
    const result = new ConceptMatcher([base]).classify(record);
    expect(result).toMatchObject({ matched: true, conceptId: 1, conceptCode: 'ISR_POR_SALARIOS', normalized: 'ISR POR SALARIOS' });
  });
  it('no clasifica con coincidencias amplias', () => {
    expect(new ConceptMatcher([{ ...base, normalizedDescription: 'ISR' }]).classify(record).matched).toBe(false);
  });
});
