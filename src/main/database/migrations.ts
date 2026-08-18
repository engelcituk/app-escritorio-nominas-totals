export interface Migration { version: number; name: string; sql: string }

// Mientras el producto continúa en desarrollo se mantiene una única migración inicial.
export const MIGRATIONS: readonly Migration[] = [{
  version: 1,
  name: 'initial_schema_general_concepts',
  sql: `
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS concept_groups (
      id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payroll_concepts (
      id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, group_id INTEGER REFERENCES concept_groups(id),
      operation_factor INTEGER NOT NULL CHECK(operation_factor IN (-1, 1)), active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS concept_aliases (
      id INTEGER PRIMARY KEY, concept_id INTEGER NOT NULL REFERENCES payroll_concepts(id) ON DELETE CASCADE,
      source_description TEXT NOT NULL, normalized_description TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS import_groups (
      id INTEGER PRIMARY KEY, year INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL,
      file_count INTEGER NOT NULL DEFAULT 0, completed_files INTEGER NOT NULL DEFAULT 0, total_lines INTEGER NOT NULL DEFAULT 0,
      valid_lines INTEGER NOT NULL DEFAULT 0, excluded_lines INTEGER NOT NULL DEFAULT 0, invalid_lines INTEGER NOT NULL DEFAULT 0,
      total_amount_cents INTEGER NOT NULL DEFAULT 0, replaced_group_id INTEGER REFERENCES import_groups(id),
      started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payroll_batches (
      id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES import_groups(id) ON DELETE CASCADE, source_order INTEGER NOT NULL,
      year INTEGER NOT NULL, fortnight INTEGER NOT NULL, payroll_type TEXT NOT NULL, layout_code TEXT NOT NULL, layout_version INTEGER NOT NULL,
      original_filename TEXT NOT NULL, original_file_path TEXT NOT NULL, file_size INTEGER NOT NULL, file_hash_sha256 TEXT NOT NULL,
      lineage_batch_id INTEGER REFERENCES payroll_batches(id), version INTEGER NOT NULL DEFAULT 1,
      attempt INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL,
      total_lines INTEGER NOT NULL DEFAULT 0, valid_lines INTEGER NOT NULL DEFAULT 0, excluded_lines INTEGER NOT NULL DEFAULT 0,
      invalid_lines INTEGER NOT NULL DEFAULT 0, unclassified_lines INTEGER NOT NULL DEFAULT 0, matching_lines INTEGER NOT NULL DEFAULT 0,
      total_amount_cents INTEGER NOT NULL DEFAULT 0, started_at TEXT, completed_at TEXT,
      replaced_batch_id INTEGER REFERENCES payroll_batches(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(group_id, source_order, attempt)
    );
    CREATE TABLE IF NOT EXISTS batch_concept_snapshots (
      id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES payroll_batches(id) ON DELETE CASCADE,
      source_concept_id INTEGER NOT NULL, concept_code TEXT NOT NULL, concept_name TEXT NOT NULL, group_code TEXT, group_name TEXT,
      operation_factor INTEGER NOT NULL, selected INTEGER NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(batch_id, source_concept_id)
    );
    CREATE TABLE IF NOT EXISTS batch_alias_snapshots (
      id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES payroll_batches(id) ON DELETE CASCADE,
      source_alias_id INTEGER NOT NULL, source_concept_id INTEGER NOT NULL, source_description TEXT NOT NULL,
      normalized_description TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS batch_retained_employees (
      id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES payroll_batches(id) ON DELETE CASCADE,
      employee_number TEXT NOT NULL, employee_name TEXT, found_records INTEGER NOT NULL DEFAULT 0,
      excluded_records INTEGER NOT NULL DEFAULT 0, missing_acknowledged INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, UNIQUE(batch_id, employee_number)
    );
    CREATE TABLE IF NOT EXISTS batch_totals (
      id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES payroll_batches(id) ON DELETE CASCADE,
      source_concept_id INTEGER NOT NULL, concept_code TEXT NOT NULL, concept_name TEXT NOT NULL, group_code TEXT, group_name TEXT,
      source_payroll_code TEXT, source_description TEXT NOT NULL, account_code TEXT, movement_type TEXT,
      operation_factor INTEGER NOT NULL, record_count INTEGER NOT NULL, original_amount_cents INTEGER NOT NULL,
      total_amount_cents INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS generated_reports (
      id INTEGER PRIMARY KEY, batch_id INTEGER REFERENCES payroll_batches(id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES import_groups(id) ON DELETE CASCADE, report_type TEXT NOT NULL, filename TEXT NOT NULL,
      file_path TEXT NOT NULL, file_hash_sha256 TEXT NOT NULL, generated_at TEXT NOT NULL,
      CHECK((batch_id IS NOT NULL AND group_id IS NULL) OR (batch_id IS NULL AND group_id IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
      description TEXT NOT NULL, metadata_json TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alias_normalized ON concept_aliases(normalized_description);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_alias_unique ON concept_aliases(normalized_description) WHERE active=1;
    CREATE INDEX IF NOT EXISTS idx_batches_group ON payroll_batches(group_id, source_order);
    CREATE INDEX IF NOT EXISTS idx_batches_period ON payroll_batches(year, fortnight, payroll_type);
    CREATE INDEX IF NOT EXISTS idx_batches_hash ON payroll_batches(file_hash_sha256);
    CREATE INDEX IF NOT EXISTS idx_totals_batch ON batch_totals(batch_id, source_concept_id, account_code);
  `,
}] as const;
