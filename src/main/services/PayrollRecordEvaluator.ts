import type { PayrollType } from '../../shared/enums/payroll.js';
import { RecordStatus } from '../../shared/enums/payroll.js';
import type { ExclusionOptions, ParsedPayrollRecord } from '../../shared/types/payroll.js';
import { parseAmountToCents } from '../../shared/utils/money.js';
import { ConceptRuleEngine, type ClassificationResult } from './ConceptRuleEngine.js';
import { ExclusionRuleEngine, type ExclusionResult } from './ExclusionRuleEngine.js';

export interface PayrollRecordEvaluation {
  amountCents: number | null;
  classification: ClassificationResult;
  exclusion: ExclusionResult;
  status: RecordStatus;
  validationError: string | null;
}

export class PayrollRecordEvaluator {
  constructor(
    private readonly conceptEngine: ConceptRuleEngine,
    private readonly exclusionEngine: ExclusionRuleEngine,
    private readonly payrollType: PayrollType,
    private readonly exclusions: ExclusionOptions,
  ) {}

  evaluate(record: ParsedPayrollRecord): PayrollRecordEvaluation {
    const amountCents = parseAmountToCents(record.amountRaw);
    const classification = this.conceptEngine.classify(record, this.payrollType);
    const exclusion = this.exclusionEngine.evaluate(record, this.payrollType, this.exclusions);
    let status: RecordStatus;
    let validationError: string | null = null;

    if (amountCents === null || !record.conceptCode || !record.movementType) {
      status = RecordStatus.INVALID;
      validationError = amountCents === null ? 'El importe no es válido.' : 'Falta el código de concepto o el tipo de movimiento.';
    } else if (!classification.matched) {
      status = RecordStatus.UNCLASSIFIED;
    } else if (!record.accountCode) {
      status = RecordStatus.INVALID;
      validationError = 'Falta la cuenta contable en un movimiento clasificado como ISR.';
    } else if (exclusion.excluded) {
      status = RecordStatus.EXCLUDED;
    } else {
      status = RecordStatus.VALID;
    }

    return { amountCents, classification, exclusion, status, validationError };
  }
}
