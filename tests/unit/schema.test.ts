import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/main/database/migrations.js';

describe('esquema inicial del expediente mensual', () => {
  it('conserva el esquema v1 con catálogo, lotes activos y salidas vigentes', () => {
    expect(MIGRATIONS[0]?.version).toBe(1);
    expect(MIGRATIONS[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS monthly_reconciliations');
    expect(MIGRATIONS[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS payroll_types');
    expect(MIGRATIONS[0]?.sql).toContain('sort_order INTEGER NOT NULL UNIQUE');
    expect(MIGRATIONS[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS concept_groups');
    expect(MIGRATIONS[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS payroll_concepts');
    expect(MIGRATIONS[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS concept_aliases');
    expect(MIGRATIONS[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS batch_concept_snapshots');
    expect(MIGRATIONS[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS batch_retained_employees');
    expect(MIGRATIONS[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS batch_retained_totals');
    expect(MIGRATIONS[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS report_artifacts');
    expect(MIGRATIONS[0]?.sql).toContain('source_key TEXT NOT NULL');
    expect(MIGRATIONS[0]?.sql).toContain('idx_active_batch_slot');
    expect(MIGRATIONS[0]?.sql).toContain('idx_active_alias_unique');
    expect(MIGRATIONS[0]?.sql).not.toContain('CREATE TABLE IF NOT EXISTS import_groups');
    expect(MIGRATIONS[0]?.sql).not.toContain('CREATE TABLE IF NOT EXISTS generated_reports');
    expect(MIGRATIONS[0]?.sql).not.toContain('CREATE TABLE IF NOT EXISTS concept_rules');
    expect(MIGRATIONS[0]?.sql).not.toContain('CREATE TABLE IF NOT EXISTS payroll_records');
  });
});
