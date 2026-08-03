import type { PayrollType } from '../../shared/enums/payroll.js';
import type { ParsedPayrollRecord } from '../../shared/types/payroll.js';
import type { ExclusionOptions } from '../../shared/types/payroll.js';

export interface ExclusionRule {
  id: number;
  name: string;
  payroll_type: string | null;
  semantic_field: keyof ParsedPayrollRecord;
  operator: string;
  comparison_value: string | null;
  case_sensitive: number;
  priority: number;
  valid_from: string | null;
  valid_to: string | null;
  exclusion_category: 'RETAINED' | 'CANCELLED' | 'INVALIDATED' | 'OTHER';
  exclusion_reason: string;
}

export interface ExclusionResult {
  excluded: boolean;
  ruleId?: number;
  category?: string;
  reason?: string;
}

export class ExclusionRuleEngine {
  constructor(private readonly rules: readonly ExclusionRule[]) {}

  evaluate(record: ParsedPayrollRecord, payrollType: PayrollType, options: ExclusionOptions, date = new Date()): ExclusionResult {
    const today = date.toISOString().slice(0, 10);
    const sorted = [...this.rules].sort((a, b) => a.priority - b.priority);
    for (const rule of sorted) {
      if (rule.payroll_type && rule.payroll_type !== payrollType) continue;
      if (rule.valid_from && rule.valid_from > today) continue;
      if (rule.valid_to && rule.valid_to < today) continue;
      if (rule.exclusion_category === 'RETAINED' && !options.retained) continue;
      if (rule.exclusion_category === 'CANCELLED' && !options.cancelled) continue;
      if (!['RETAINED', 'CANCELLED'].includes(rule.exclusion_category) && !options.other) continue;
      const rawValue = String(record[rule.semantic_field] ?? '');
      const expected = rule.comparison_value ?? '';
      const value = rule.case_sensitive ? rawValue : rawValue.toUpperCase();
      const comparison = rule.case_sensitive ? expected : expected.toUpperCase();
      if (!this.matches(value, comparison, rule.operator)) continue;
      return { excluded: true, ruleId: rule.id, category: rule.exclusion_category, reason: rule.exclusion_reason };
    }
    return { excluded: false };
  }

  private matches(value: string, expected: string, operator: string): boolean {
    switch (operator) {
      case 'equals': return value === expected;
      case 'not_equals': return value !== expected;
      case 'contains': return value.includes(expected);
      case 'starts_with': return value.startsWith(expected);
      case 'ends_with': return value.endsWith(expected);
      case 'in': return expected.split(',').map((item) => item.trim()).includes(value);
      case 'is_empty': return value.trim() === '';
      case 'is_not_empty': return value.trim() !== '';
      case 'regex':
        try { return new RegExp(expected).test(value); } catch { return false; }
      default: return false;
    }
  }
}
