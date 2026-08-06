export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS concept_families (
        id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT, active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS concept_rules (
        id INTEGER PRIMARY KEY, concept_family_id INTEGER NOT NULL REFERENCES concept_families(id), payroll_type TEXT,
        concept_code_equals TEXT, description_equals TEXT, description_contains TEXT, description_regex TEXT,
        account_equals TEXT, account_starts_with TEXT, movement_type_equals TEXT, variant_code TEXT NOT NULL,
        variant_name TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 100, active INTEGER NOT NULL DEFAULT 1,
        valid_from TEXT, valid_to TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS exclusion_rules (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, payroll_type TEXT, semantic_field TEXT NOT NULL,
        operator TEXT NOT NULL, comparison_value TEXT, case_sensitive INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 100,
        active INTEGER NOT NULL DEFAULT 1, valid_from TEXT, valid_to TEXT, exclusion_category TEXT NOT NULL,
        exclusion_reason TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payroll_batches (
        id INTEGER PRIMARY KEY, year INTEGER NOT NULL, fortnight INTEGER NOT NULL, payroll_type TEXT NOT NULL,
        concept_family_id INTEGER NOT NULL REFERENCES concept_families(id), layout_code TEXT NOT NULL, layout_version INTEGER NOT NULL,
        original_filename TEXT NOT NULL, original_file_path TEXT NOT NULL, file_size INTEGER NOT NULL, file_hash_sha256 TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, total_lines INTEGER NOT NULL DEFAULT 0,
        valid_lines INTEGER NOT NULL DEFAULT 0, excluded_lines INTEGER NOT NULL DEFAULT 0, invalid_lines INTEGER NOT NULL DEFAULT 0,
        unclassified_lines INTEGER NOT NULL DEFAULT 0, matching_lines INTEGER NOT NULL DEFAULT 0,
        total_amount_cents INTEGER NOT NULL DEFAULT 0, started_at TEXT, completed_at TEXT, replaced_batch_id INTEGER REFERENCES payroll_batches(id),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS batch_totals (
        id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES payroll_batches(id) ON DELETE CASCADE,
        concept_family_id INTEGER NOT NULL REFERENCES concept_families(id), concept_variant TEXT, concept_code TEXT,
        concept_description TEXT, account_code TEXT, movement_type TEXT, record_count INTEGER NOT NULL,
        total_amount_cents INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS generated_reports (
        id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES payroll_batches(id) ON DELETE CASCADE,
        report_type TEXT NOT NULL, filename TEXT NOT NULL, file_path TEXT NOT NULL, file_hash_sha256 TEXT NOT NULL, generated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
        description TEXT NOT NULL, metadata_json TEXT, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_batches_period ON payroll_batches(year, fortnight, payroll_type);
      CREATE INDEX IF NOT EXISTS idx_batches_hash ON payroll_batches(file_hash_sha256);
      CREATE INDEX IF NOT EXISTS idx_totals_group ON batch_totals(batch_id, account_code, concept_variant);
    `,
  },
] as const;
