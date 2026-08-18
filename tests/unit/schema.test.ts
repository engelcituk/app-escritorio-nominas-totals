import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/main/database/migrations.js';

describe('esquema inicial multiarchivo', () => {
  it('mantiene una sola migración con expedientes, catálogo y fotografías auditables', () => {
    expect(MIGRATIONS).toHaveLength(1);
    expect(MIGRATIONS[0]?.version).toBe(1);
    expect(MIGRATIONS[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS import_groups');
    expect(MIGRATIONS[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS concept_groups');
    expect(MIGRATIONS[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS payroll_concepts');
    expect(MIGRATIONS[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS concept_aliases');
    expect(MIGRATIONS[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS batch_concept_snapshots');
    expect(MIGRATIONS[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS batch_retained_employees');
    expect(MIGRATIONS[0]?.sql).toContain('attempt INTEGER NOT NULL DEFAULT 1');
    expect(MIGRATIONS[0]?.sql).toContain('idx_active_alias_unique');
    expect(MIGRATIONS[0]?.sql).not.toContain('CREATE TABLE IF NOT EXISTS concept_rules');
    expect(MIGRATIONS[0]?.sql).not.toContain('CREATE TABLE IF NOT EXISTS payroll_records');
  });
});
