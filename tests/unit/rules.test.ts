import { describe, expect, it } from 'vitest';
import { PayrollType } from '../../src/shared/enums/payroll.js';
import type { ParsedPayrollRecord } from '../../src/shared/types/payroll.js';
import { ConceptRuleEngine, type ConceptRule } from '../../src/main/services/ConceptRuleEngine.js';

const record: ParsedPayrollRecord = { lineNumber: 1, dependencyKey: '21111061-06', employeeNumber: '1', employeeName: 'SINTETICO',
  positionName: 'PUESTO', movementType: 'D', movementClassifier: '2', conceptCode: '101', conceptDescriptionOriginal: 'I S R POR SALARIOS',
  amountRaw: '790.20', accountCode: 'CUENTA', fundingSource: 'CO', paymentCenter: '1' };
const base: ConceptRule = { id: 1, payroll_type: null, concept_code_equals: null, description_equals: null,
  description_contains: 'ISR', description_regex: null, account_equals: null, account_starts_with: null,
  movement_type_equals: null, variant_code: 'GENERAL', variant_name: 'General', priority: 100, valid_from: null, valid_to: null };

describe('ConceptRuleEngine', () => {
  it('aplica la regla de mayor prioridad que cumple código, descripción y movimiento', () => {
    const specific: ConceptRule = { ...base, id: 2, payroll_type: PayrollType.SUELDOS, concept_code_equals: '101',
      description_contains: 'ISR POR SALARIOS', movement_type_equals: 'D', variant_code: 'ISR_POR_SALARIOS', priority: 10 };
    const result = new ConceptRuleEngine([base, specific]).classify(record, PayrollType.SUELDOS);
    expect(result).toMatchObject({ matched: true, ruleId: 2, variant: 'ISR_POR_SALARIOS', canonical: 'ISR POR SALARIOS' });
  });
  it('no clasifica por una regla cuyos criterios no cumplen', () => {
    expect(new ConceptRuleEngine([{ ...base, description_contains: 'ISSSTE' }]).classify(record, PayrollType.SUELDOS).matched).toBe(false);
  });
});
