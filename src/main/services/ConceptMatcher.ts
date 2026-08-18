import type { ParsedPayrollRecord } from '../../shared/types/payroll.js';
import { canonicalizeConceptDescription } from '../../shared/utils/normalization.js';

export interface ConceptMatchRule {
  aliasId: number; conceptId: number; conceptCode: string; conceptName: string; groupId: number | null; groupCode: string | null; groupName: string | null;
  operationFactor: number; normalizedDescription: string;
}
export interface ConceptClassification {
  normalized: string; matched: boolean; aliasId?: number; conceptId?: number; conceptCode?: string; conceptName?: string;
  groupId?: number | null; groupCode?: string | null; groupName?: string | null; operationFactor?: 1 | -1;
}

export class ConceptMatcher {
  private readonly aliases: Map<string, ConceptMatchRule>;
  constructor(rules: readonly ConceptMatchRule[]) { this.aliases = new Map(rules.map((rule) => [rule.normalizedDescription, rule])); }

  classify(record: ParsedPayrollRecord): ConceptClassification {
    const normalized = canonicalizeConceptDescription(record.conceptDescriptionOriginal);
    const rule = this.aliases.get(normalized);
    if (!rule) return { normalized, matched: false };
    return { normalized, matched: true, aliasId: rule.aliasId, conceptId: rule.conceptId, conceptCode: rule.conceptCode,
      conceptName: rule.conceptName, groupId: rule.groupId, groupCode: rule.groupCode, groupName: rule.groupName,
      operationFactor: rule.operationFactor === -1 ? -1 : 1 };
  }
}

export const ACTIVE_CONCEPT_MATCHERS_SQL = `SELECT a.id AS aliasId, c.id AS conceptId, c.code AS conceptCode, c.name AS conceptName,
  g.id AS groupId, g.code AS groupCode, g.name AS groupName, c.operation_factor AS operationFactor, a.normalized_description AS normalizedDescription
  FROM concept_aliases a JOIN payroll_concepts c ON c.id = a.concept_id LEFT JOIN concept_groups g ON g.id = c.group_id
  WHERE a.active = 1 AND c.active = 1`;
