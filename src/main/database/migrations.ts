export interface Migration { version: number; name: string; sql: string }

// La versión 1 se conserva; los cambios nuevos se aplican de forma incremental.
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
      sort_order INTEGER NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
}, {
  version: 2,
  name: 'desktop_installation_identity',
  sql: `
    CREATE TABLE app_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      installation_uuid TEXT NOT NULL UNIQUE,
      central_device_uuid TEXT UNIQUE,
      device_name TEXT NOT NULL,
      registered_at TEXT,
      last_seen_at TEXT,
      last_app_version TEXT NOT NULL,
      api_origin TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TRIGGER app_identity_installation_immutable
    BEFORE UPDATE OF installation_uuid ON app_identity
    WHEN OLD.installation_uuid IS NOT NEW.installation_uuid
    BEGIN
      SELECT RAISE(ABORT, 'INSTALLATION_UUID_IMMUTABLE');
    END;
  `,
}, {
  version: 3,
  name: 'central_catalog_replica',
  sql: `
    ALTER TABLE concept_groups ADD COLUMN central_uuid TEXT;
    ALTER TABLE concept_groups ADD COLUMN catalog_revision INTEGER;
    ALTER TABLE concept_groups ADD COLUMN mapping_status TEXT NOT NULL DEFAULT 'LEGACY_UNMAPPED' CHECK(mapping_status IN ('MAPPED','LEGACY_UNMAPPED'));
    ALTER TABLE concept_groups ADD COLUMN present_in_snapshot INTEGER NOT NULL DEFAULT 0 CHECK(present_in_snapshot IN (0,1));
    CREATE UNIQUE INDEX idx_concept_groups_central_uuid ON concept_groups(central_uuid);
    CREATE INDEX idx_concept_groups_catalog_status ON concept_groups(mapping_status,active,present_in_snapshot);
    CREATE TRIGGER concept_groups_central_uuid_immutable BEFORE UPDATE OF central_uuid ON concept_groups
    WHEN OLD.central_uuid IS NOT NULL AND OLD.central_uuid IS NOT NEW.central_uuid
    BEGIN SELECT RAISE(ABORT, 'CENTRAL_UUID_IMMUTABLE'); END;
    ALTER TABLE payroll_concepts ADD COLUMN central_uuid TEXT;
    ALTER TABLE payroll_concepts ADD COLUMN catalog_revision INTEGER;
    ALTER TABLE payroll_concepts ADD COLUMN mapping_status TEXT NOT NULL DEFAULT 'LEGACY_UNMAPPED' CHECK(mapping_status IN ('MAPPED','LEGACY_UNMAPPED'));
    ALTER TABLE payroll_concepts ADD COLUMN present_in_snapshot INTEGER NOT NULL DEFAULT 0 CHECK(present_in_snapshot IN (0,1));
    CREATE UNIQUE INDEX idx_payroll_concepts_central_uuid ON payroll_concepts(central_uuid);
    CREATE INDEX idx_payroll_concepts_catalog_status ON payroll_concepts(mapping_status,active,present_in_snapshot);
    CREATE TRIGGER payroll_concepts_central_uuid_immutable BEFORE UPDATE OF central_uuid ON payroll_concepts
    WHEN OLD.central_uuid IS NOT NULL AND OLD.central_uuid IS NOT NEW.central_uuid
    BEGIN SELECT RAISE(ABORT, 'CENTRAL_UUID_IMMUTABLE'); END;
    ALTER TABLE concept_aliases ADD COLUMN central_uuid TEXT;
    ALTER TABLE concept_aliases ADD COLUMN catalog_revision INTEGER;
    ALTER TABLE concept_aliases ADD COLUMN mapping_status TEXT NOT NULL DEFAULT 'LEGACY_UNMAPPED' CHECK(mapping_status IN ('MAPPED','LEGACY_UNMAPPED'));
    ALTER TABLE concept_aliases ADD COLUMN present_in_snapshot INTEGER NOT NULL DEFAULT 0 CHECK(present_in_snapshot IN (0,1));
    CREATE UNIQUE INDEX idx_concept_aliases_central_uuid ON concept_aliases(central_uuid);
    CREATE INDEX idx_concept_aliases_catalog_status ON concept_aliases(mapping_status,active,present_in_snapshot);
    CREATE TRIGGER concept_aliases_central_uuid_immutable BEFORE UPDATE OF central_uuid ON concept_aliases
    WHEN OLD.central_uuid IS NOT NULL AND OLD.central_uuid IS NOT NEW.central_uuid
    BEGIN SELECT RAISE(ABORT, 'CENTRAL_UUID_IMMUTABLE'); END;
    ALTER TABLE payroll_types ADD COLUMN central_uuid TEXT;
    ALTER TABLE payroll_types ADD COLUMN catalog_revision INTEGER;
    ALTER TABLE payroll_types ADD COLUMN mapping_status TEXT NOT NULL DEFAULT 'LEGACY_UNMAPPED' CHECK(mapping_status IN ('MAPPED','LEGACY_UNMAPPED'));
    ALTER TABLE payroll_types ADD COLUMN present_in_snapshot INTEGER NOT NULL DEFAULT 0 CHECK(present_in_snapshot IN (0,1));
    CREATE UNIQUE INDEX idx_payroll_types_central_uuid ON payroll_types(central_uuid);
    CREATE INDEX idx_payroll_types_catalog_status ON payroll_types(mapping_status,active,present_in_snapshot);
    CREATE TRIGGER payroll_types_central_uuid_immutable BEFORE UPDATE OF central_uuid ON payroll_types
    WHEN OLD.central_uuid IS NOT NULL AND OLD.central_uuid IS NOT NEW.central_uuid
    BEGIN SELECT RAISE(ABORT, 'CENTRAL_UUID_IMMUTABLE'); END;
    ALTER TABLE payroll_types ADD COLUMN central_sort_order INTEGER;
    CREATE TABLE catalog_sync_state (
      id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER, checksum_sha256 TEXT, published_at TEXT,
      snapshot_schema_version INTEGER NOT NULL DEFAULT 1,
      synced_at TEXT, valid_until TEXT, api_origin TEXT, requires_verification INTEGER NOT NULL DEFAULT 1,
      last_attempt_at TEXT, last_error TEXT, retry_at INTEGER, updated_at TEXT NOT NULL
    );
    CREATE TABLE catalog_sync_conflicts (
      id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL, local_id INTEGER NOT NULL,
      local_code TEXT, conflict_type TEXT NOT NULL, description TEXT NOT NULL,
      revision INTEGER, created_at TEXT NOT NULL, resolved_at TEXT
    );
    CREATE UNIQUE INDEX idx_catalog_conflict_open ON catalog_sync_conflicts(entity_type,local_id,conflict_type) WHERE resolved_at IS NULL;
    INSERT INTO catalog_sync_conflicts(entity_type,local_id,local_code,conflict_type,description,created_at)
      SELECT 'concept_groups',id,code,'LEGACY_UNMAPPED','Registro local pendiente de vincular al primer catálogo central.',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM concept_groups;
    INSERT INTO catalog_sync_conflicts(entity_type,local_id,local_code,conflict_type,description,created_at)
      SELECT 'payroll_concepts',id,code,'LEGACY_UNMAPPED','Registro local pendiente de vincular al primer catálogo central.',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM payroll_concepts;
    INSERT INTO catalog_sync_conflicts(entity_type,local_id,local_code,conflict_type,description,created_at)
      SELECT 'concept_aliases',id,normalized_description,'LEGACY_UNMAPPED','Alias local pendiente de vincular al primer catálogo central.',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM concept_aliases;
    INSERT INTO catalog_sync_conflicts(entity_type,local_id,local_code,conflict_type,description,created_at)
      SELECT 'payroll_types',id,code,'LEGACY_UNMAPPED','Registro local pendiente de vincular al primer catálogo central.',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM payroll_types;
    CREATE TABLE catalog_legacy_labels (
      entity_type TEXT NOT NULL, local_id INTEGER NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      captured_at TEXT NOT NULL, PRIMARY KEY(entity_type,local_id)
    );
    INSERT INTO catalog_legacy_labels SELECT 'GROUP',id,code,name,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM concept_groups;
    INSERT INTO catalog_legacy_labels SELECT 'TYPE',id,code,name,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM payroll_types;
    ALTER TABLE monthly_reconciliations ADD COLUMN concept_group_code_snapshot TEXT;
    ALTER TABLE monthly_reconciliations ADD COLUMN concept_group_name_snapshot TEXT;
    ALTER TABLE monthly_reconciliations ADD COLUMN catalog_provenance TEXT NOT NULL DEFAULT 'LEGACY_AT_MIGRATION';
    UPDATE monthly_reconciliations SET concept_group_code_snapshot=(SELECT code FROM concept_groups WHERE id=concept_group_id),
      concept_group_name_snapshot=(SELECT name FROM concept_groups WHERE id=concept_group_id);
    ALTER TABLE payroll_batches ADD COLUMN catalog_revision INTEGER;
    ALTER TABLE payroll_batches ADD COLUMN concept_group_uuid TEXT;
    ALTER TABLE payroll_batches ADD COLUMN concept_group_code_snapshot TEXT;
    ALTER TABLE payroll_batches ADD COLUMN concept_group_name_snapshot TEXT;
    ALTER TABLE payroll_batches ADD COLUMN payroll_type_uuid TEXT;
    ALTER TABLE payroll_batches ADD COLUMN payroll_type_code_snapshot TEXT;
    ALTER TABLE payroll_batches ADD COLUMN payroll_type_name_snapshot TEXT;
    UPDATE payroll_batches SET payroll_type_code_snapshot=(SELECT code FROM payroll_types WHERE id=payroll_type_id),
      payroll_type_name_snapshot=(SELECT name FROM payroll_types WHERE id=payroll_type_id);
    ALTER TABLE batch_concept_snapshots ADD COLUMN central_uuid TEXT;
    ALTER TABLE batch_concept_snapshots ADD COLUMN group_id_snapshot INTEGER;
    ALTER TABLE batch_concept_snapshots ADD COLUMN concept_group_uuid TEXT;
    ALTER TABLE batch_concept_snapshots ADD COLUMN catalog_revision INTEGER;
    ALTER TABLE batch_alias_snapshots ADD COLUMN central_uuid TEXT;
    ALTER TABLE batch_alias_snapshots ADD COLUMN concept_uuid TEXT;
    ALTER TABLE batch_alias_snapshots ADD COLUMN catalog_revision INTEGER;
    CREATE INDEX idx_batch_snapshot_alias_lookup ON batch_alias_snapshots(batch_id,normalized_description);
  `,
}, {
  version: 4,
  name: 'durable_sync_outbox',
  sql: `
    CREATE TABLE sync_outbox (
      id INTEGER PRIMARY KEY,
      operation_uuid TEXT NOT NULL UNIQUE,
      operation_type TEXT NOT NULL CHECK(operation_type IN ('local.result.publish','reconciliation.upsert','batch.upsert','report.upload')),
      entity_type TEXT NOT NULL,
      local_entity_id INTEGER,
      central_entity_uuid TEXT,
      api_origin TEXT NOT NULL,
      installation_uuid TEXT NOT NULL,
      device_uuid TEXT NOT NULL,
      payload_hash_sha256 TEXT NOT NULL CHECK(length(payload_hash_sha256)=64),
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','IN_PROGRESS','RETRY','SYNCED','FAILED','CONFLICT')),
      local_ready INTEGER NOT NULL DEFAULT 1 CHECK(local_ready IN (0,1)),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
      cycle_attempts INTEGER NOT NULL DEFAULT 0 CHECK(cycle_attempts>=0),
      next_attempt_at TEXT,
      last_http_status INTEGER,
      last_error_code TEXT,
      last_error_message TEXT,
      depends_on TEXT REFERENCES sync_outbox(operation_uuid),
      supersedes TEXT REFERENCES sync_outbox(operation_uuid),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      CHECK(depends_on IS NOT operation_uuid), CHECK(supersedes IS NOT operation_uuid)
    );
    CREATE INDEX idx_outbox_due ON sync_outbox(status,next_attempt_at,id);
    CREATE INDEX idx_outbox_entity ON sync_outbox(entity_type,local_entity_id);
    CREATE INDEX idx_outbox_dependency ON sync_outbox(depends_on);
    CREATE INDEX idx_outbox_hash ON sync_outbox(payload_hash_sha256);
    CREATE TABLE sync_runtime (id INTEGER PRIMARY KEY CHECK(id=1), paused_until TEXT, requires_session_verification INTEGER NOT NULL DEFAULT 0 CHECK(requires_session_verification IN (0,1)));
    INSERT INTO sync_runtime(id) VALUES(1);
    CREATE UNIQUE INDEX idx_outbox_result_intent ON sync_outbox(local_entity_id) WHERE operation_type='local.result.publish';
    CREATE TRIGGER outbox_request_immutable BEFORE UPDATE OF operation_uuid,operation_type,entity_type,local_entity_id,
      api_origin,installation_uuid,device_uuid,payload_hash_sha256,payload_json,depends_on,supersedes ON sync_outbox
    BEGIN SELECT RAISE(ABORT, 'OUTBOX_REQUEST_IMMUTABLE'); END;
    CREATE TRIGGER outbox_resource_immutable BEFORE UPDATE OF central_entity_uuid ON sync_outbox
    WHEN OLD.central_entity_uuid IS NOT NULL AND OLD.central_entity_uuid IS NOT NEW.central_entity_uuid
    BEGIN SELECT RAISE(ABORT, 'CENTRAL_UUID_IMMUTABLE'); END;
  `,
}, {
  version: 5,
  name: 'result_publications_and_reports',
  sql: `
    CREATE TABLE sync_publications (
      parent_uuid TEXT PRIMARY KEY REFERENCES sync_outbox(operation_uuid),
      reconciliation_id INTEGER NOT NULL REFERENCES monthly_reconciliations(id),
      revision INTEGER NOT NULL,
      reconciliation_json TEXT NOT NULL CHECK(json_valid(reconciliation_json)),
      batch_json TEXT NOT NULL CHECK(json_valid(batch_json))
    );
    CREATE TABLE sync_report_files (
      parent_uuid TEXT NOT NULL REFERENCES sync_outbox(operation_uuid),
      report_type TEXT NOT NULL CHECK(report_type IN ('SOURCE','MONTHLY_TOTALS')),
      original_filename TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes>0),
      sha256 TEXT NOT NULL CHECK(length(sha256)=64), generated_at TEXT NOT NULL,
      PRIMARY KEY(parent_uuid,report_type)
    );
    CREATE TABLE sync_delivery_steps (
      parent_uuid TEXT NOT NULL REFERENCES sync_outbox(operation_uuid),
      step INTEGER NOT NULL CHECK(step BETWEEN 1 AND 4),
      operation_uuid TEXT NOT NULL UNIQUE REFERENCES sync_outbox(operation_uuid),
      PRIMARY KEY(parent_uuid,step)
    );
    CREATE INDEX idx_publications_reconciliation ON sync_publications(reconciliation_id,revision);
    CREATE TRIGGER sync_publication_immutable BEFORE UPDATE ON sync_publications
      BEGIN SELECT RAISE(ABORT, 'PUBLICATION_IMMUTABLE'); END;
    CREATE TRIGGER sync_report_immutable BEFORE UPDATE ON sync_report_files
      BEGIN SELECT RAISE(ABORT, 'REPORT_IMMUTABLE'); END;
    CREATE TRIGGER sync_step_immutable BEFORE UPDATE ON sync_delivery_steps
      BEGIN SELECT RAISE(ABORT, 'DELIVERY_STEP_IMMUTABLE'); END;
  `,
}] as const;
