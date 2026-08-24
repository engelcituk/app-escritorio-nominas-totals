export interface Migration { version: number; name: string; sql: string }

// Esquema inicial definitivo del expediente mensual. Durante desarrollo las bases incompatibles se recrean.
export const MIGRATIONS: readonly Migration[] = [{
  version: 1,
  name: 'initial_monthly_reconciliation_schema',
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
    CREATE TABLE IF NOT EXISTS payroll_types (
      id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS monthly_reconciliations (
      id INTEGER PRIMARY KEY, year INTEGER NOT NULL, month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
      concept_group_id INTEGER NOT NULL REFERENCES concept_groups(id), status TEXT NOT NULL DEFAULT 'DRAFT',
      revision INTEGER NOT NULL DEFAULT 0, file_count INTEGER NOT NULL DEFAULT 0, completed_files INTEGER NOT NULL DEFAULT 0,
      total_lines INTEGER NOT NULL DEFAULT 0, valid_lines INTEGER NOT NULL DEFAULT 0, excluded_lines INTEGER NOT NULL DEFAULT 0,
      invalid_lines INTEGER NOT NULL DEFAULT 0, total_amount_cents INTEGER NOT NULL DEFAULT 0,
      started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(year,month,concept_group_id)
    );
    CREATE TABLE IF NOT EXISTS payroll_batches (
      id INTEGER PRIMARY KEY, reconciliation_id INTEGER NOT NULL REFERENCES monthly_reconciliations(id) ON DELETE CASCADE,
      source_order INTEGER NOT NULL, year INTEGER NOT NULL, month INTEGER NOT NULL, fortnight INTEGER NOT NULL,
      payroll_type_id INTEGER NOT NULL REFERENCES payroll_types(id), layout_code TEXT NOT NULL, layout_version INTEGER NOT NULL,
      original_filename TEXT NOT NULL, original_file_path TEXT NOT NULL, file_size INTEGER NOT NULL, file_hash_sha256 TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 0,
      total_lines INTEGER NOT NULL DEFAULT 0, valid_lines INTEGER NOT NULL DEFAULT 0, excluded_lines INTEGER NOT NULL DEFAULT 0,
      invalid_lines INTEGER NOT NULL DEFAULT 0, unclassified_lines INTEGER NOT NULL DEFAULT 0, matching_lines INTEGER NOT NULL DEFAULT 0,
      total_amount_cents INTEGER NOT NULL DEFAULT 0, started_at TEXT, completed_at TEXT,
      replaced_batch_id INTEGER REFERENCES payroll_batches(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS batch_concept_snapshots (
      id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES payroll_batches(id) ON DELETE CASCADE,
      source_concept_id INTEGER NOT NULL, concept_code TEXT NOT NULL, concept_name TEXT NOT NULL, group_code TEXT, group_name TEXT,
      operation_factor INTEGER NOT NULL, selected INTEGER NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(batch_id,source_concept_id)
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
      created_at TEXT NOT NULL, UNIQUE(batch_id,employee_number)
    );
    CREATE TABLE IF NOT EXISTS batch_retained_totals (
      id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES payroll_batches(id) ON DELETE CASCADE,
      employee_number TEXT NOT NULL, employee_name TEXT NOT NULL, source_payroll_code TEXT NOT NULL,
      concept_name TEXT NOT NULL, source_key TEXT NOT NULL, account_code TEXT NOT NULL, movement_type TEXT NOT NULL,
      record_count INTEGER NOT NULL, amount_cents INTEGER NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(batch_id,employee_number,source_payroll_code,concept_name,source_key,account_code,movement_type)
    );
    CREATE TABLE IF NOT EXISTS batch_totals (
      id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES payroll_batches(id) ON DELETE CASCADE,
      source_concept_id INTEGER NOT NULL, concept_code TEXT NOT NULL, concept_name TEXT NOT NULL, group_code TEXT, group_name TEXT,
      source_payroll_code TEXT, source_description TEXT NOT NULL, source_key TEXT NOT NULL, account_code TEXT,
      movement_type TEXT, operation_factor INTEGER NOT NULL, record_count INTEGER NOT NULL,
      original_amount_cents INTEGER NOT NULL, total_amount_cents INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS report_artifacts (
      id INTEGER PRIMARY KEY, batch_id INTEGER REFERENCES payroll_batches(id) ON DELETE CASCADE,
      reconciliation_id INTEGER REFERENCES monthly_reconciliations(id) ON DELETE CASCADE,
      report_type TEXT NOT NULL, filename TEXT NOT NULL, file_path TEXT NOT NULL, file_hash_sha256 TEXT NOT NULL, updated_at TEXT NOT NULL,
      CHECK((batch_id IS NOT NULL AND reconciliation_id IS NULL) OR (batch_id IS NULL AND reconciliation_id IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
      description TEXT NOT NULL, metadata_json TEXT, created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_alias_unique ON concept_aliases(normalized_description) WHERE active=1;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_batch_slot ON payroll_batches(reconciliation_id,fortnight,payroll_type_id) WHERE is_active=1;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_report_batch_type ON report_artifacts(batch_id,report_type) WHERE batch_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_report_month_type ON report_artifacts(reconciliation_id,report_type) WHERE reconciliation_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_alias_normalized ON concept_aliases(normalized_description);
    CREATE INDEX IF NOT EXISTS idx_batches_month ON payroll_batches(reconciliation_id,fortnight,payroll_type_id,is_active);
    CREATE INDEX IF NOT EXISTS idx_batches_hash ON payroll_batches(file_hash_sha256);
    CREATE INDEX IF NOT EXISTS idx_totals_batch ON batch_totals(batch_id,source_concept_id,source_key,account_code);
    CREATE INDEX IF NOT EXISTS idx_retained_totals_batch ON batch_retained_totals(batch_id,source_key,account_code,concept_name);
  `,
}] as const;
