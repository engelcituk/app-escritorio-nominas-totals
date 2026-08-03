import type { PayrollType } from '../../shared/enums/payroll.js';
import type { ParsedPayrollRecord } from '../../shared/types/payroll.js';
import { canonicalizeConceptDescription, comparisonText, normalizeConceptDescription } from '../../shared/utils/normalization.js';

export interface ConceptRule {
  id: number;
  payroll_type: string | null;
  concept_code_equals: string | null;
  description_equals: string | null;
  description_contains: string | null;
  description_regex: string | null;
  account_equals: string | null;
  account_starts_with: string | null;
  movement_type_equals: string | null;
  variant_code: string;
  variant_name: string;
  priority: number;
  valid_from: string | null;
  valid_to: string | null;
}

export interface ClassificationResult {
  normalized: string;
  canonical: string;
  matched: boolean;
  conceptFamily?: 'ISR';
  variant?: string;
  ruleId?: number;
  ruleName?: string;
  classificationReason?: string;
}

export class ConceptRuleEngine {
  private readonly rules: readonly ConceptRule[];

  constructor(rules: readonly ConceptRule[]) {
    this.rules = [...rules].sort((a, b) => a.priority - b.priority);
  }

  classify(record: ParsedPayrollRecord, payrollType: PayrollType, date = new Date()): ClassificationResult {
    const normalized = normalizeConceptDescription(record.conceptDescriptionOriginal);
    const canonical = canonicalizeConceptDescription(record.conceptDescriptionOriginal);
    const today = date.toISOString().slice(0, 10);

    for (const rule of this.rules) {
      if (rule.valid_from && rule.valid_from > today) continue;
      if (rule.valid_to && rule.valid_to < today) continue;
      if (rule.payroll_type && rule.payroll_type !== payrollType) continue;
      if (rule.concept_code_equals && rule.concept_code_equals !== record.conceptCode) continue;
      if (rule.movement_type_equals && rule.movement_type_equals !== record.movementType) continue;
      if (rule.account_equals && rule.account_equals !== record.accountCode) continue;
      if (rule.account_starts_with && !record.accountCode.startsWith(rule.account_starts_with)) continue;
      if (rule.description_equals && canonical !== comparisonText(rule.description_equals)) continue;
      if (rule.description_contains && !canonical.includes(comparisonText(rule.description_contains))) continue;
      if (rule.description_regex) {
        try {
          if (!new RegExp(rule.description_regex, 'i').test(canonical)) continue;
        } catch {
          continue;
        }
      }
      const reasons = [
        rule.concept_code_equals ? `código ${rule.concept_code_equals}` : '',
        rule.movement_type_equals ? `movimiento ${rule.movement_type_equals}` : '',
        rule.description_contains ? `descripción ${canonical}` : '',
      ].filter(Boolean);
      return {
        normalized,
        canonical,
        matched: true,
        conceptFamily: 'ISR',
        variant: rule.variant_code,
        ruleId: rule.id,
        ruleName: rule.variant_name,
        classificationReason: reasons.join(', '),
      };
    }
    return { normalized, canonical, matched: false };
  }
}
