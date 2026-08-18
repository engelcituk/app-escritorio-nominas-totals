import { RecordStatus } from '../../shared/enums/payroll.js';
import type { ParsedPayrollRecord } from '../../shared/types/payroll.js';
import { parseAmountToCents } from '../../shared/utils/money.js';
import { ConceptMatcher, type ConceptClassification } from './ConceptMatcher.js';

export interface PayrollRecordEvaluation {
  amountCents: number | null; classification: ConceptClassification; status: RecordStatus;
  exclusionCategory: 'RETAINED' | 'CONCEPT_NOT_SELECTED' | null; exclusionReason: string | null;
  validationError: string | null; appliedAmountCents: number | null;
}

export class PayrollRecordEvaluator {
  constructor(private readonly matcher: ConceptMatcher, private readonly selectedConceptIds = new Set<number>(),
    private readonly retainedEmployeeNumbers = new Set<string>()) {}

  evaluate(record: ParsedPayrollRecord): PayrollRecordEvaluation {
    const amountCents = parseAmountToCents(record.amountRaw);
    const classification = this.matcher.classify(record);
    let status: RecordStatus;
    let validationError: string | null = null;
    let exclusionCategory: PayrollRecordEvaluation['exclusionCategory'] = null;
    let exclusionReason: string | null = null;

    if (amountCents === null || !record.conceptCode || !record.movementType) {
      status = RecordStatus.INVALID;
      validationError = amountCents === null ? 'El importe no es válido.' : 'Falta el código de concepto o el tipo de movimiento.';
    } else if (!classification.matched) status = RecordStatus.UNCLASSIFIED;
    else if (!classification.conceptId || !this.selectedConceptIds.has(classification.conceptId)) {
      status = RecordStatus.EXCLUDED; exclusionCategory = 'CONCEPT_NOT_SELECTED';
      exclusionReason = `El concepto ${classification.conceptName ?? classification.normalized} no fue seleccionado.`;
    } else if (this.retainedEmployeeNumbers.has(record.employeeNumber)) {
      status = RecordStatus.EXCLUDED; exclusionCategory = 'RETAINED';
      exclusionReason = `Empleado ${record.employeeNumber} retenido para este archivo.`;
    } else if (!record.accountCode) {
      status = RecordStatus.INVALID; validationError = 'Falta la cuenta contable en un movimiento seleccionado.';
    } else status = RecordStatus.VALID;

    const appliedAmountCents = amountCents === null || !classification.matched ? null : amountCents * (classification.operationFactor ?? 1);
    return { amountCents, classification, status, exclusionCategory, exclusionReason, validationError, appliedAmountCents };
  }
}
