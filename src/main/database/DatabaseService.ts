import Database from 'better-sqlite3';
import { MigrationService } from './MigrationService.js';

export class IncompatibleSchemaError extends Error {
  constructor() { super('La base local usa un esquema de desarrollo anterior.'); this.name = 'IncompatibleSchemaError'; }
}

export class DatabaseService {
  readonly connection: Database.Database;

  constructor(path: string, options: { initialize?: boolean } = {}) {
    this.connection = new Database(path);
    try {
      this.connection.pragma('journal_mode = WAL');
      this.connection.pragma('foreign_keys = ON');
      this.connection.pragma('busy_timeout = 5000');
      if (options.initialize) new MigrationService(this.connection).run();
      else new MigrationService(this.connection).assertCurrent();
      this.validateSchema();
    } catch (error) { this.connection.close(); throw error; }
  }

  close(): void { this.connection.close(); }

  private validateSchema(): void {
    const required = ['concept_groups', 'payroll_concepts', 'concept_aliases', 'payroll_types', 'monthly_reconciliations',
      'payroll_batches', 'batch_concept_snapshots', 'batch_retained_employees', 'batch_retained_totals', 'batch_totals', 'report_artifacts', 'sync_outbox', 'sync_runtime', 'sync_publications', 'sync_report_files', 'sync_delivery_steps'];
    const tables = new Set((this.connection.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((row) => row.name));
    if (required.some((name) => !tables.has(name))) throw new IncompatibleSchemaError();
    const requiredColumns: Record<string, string[]> = {
      monthly_reconciliations: ['year', 'month', 'concept_group_id', 'revision', 'total_amount_cents'],
      payroll_batches: ['reconciliation_id', 'month', 'fortnight', 'payroll_type_id', 'file_hash_sha256', 'is_active', 'replaced_batch_id'],
      payroll_concepts: ['code', 'group_id', 'operation_factor', 'active'],
      payroll_types: ['code', 'name', 'sort_order', 'active'],
      concept_aliases: ['concept_id', 'normalized_description', 'active'],
      batch_retained_employees: ['batch_id', 'employee_number', 'missing_acknowledged'],
      batch_retained_totals: ['batch_id', 'employee_number', 'source_key', 'account_code', 'concept_name', 'record_count', 'amount_cents'],
      batch_totals: ['batch_id', 'source_key', 'account_code', 'total_amount_cents'],
      sync_outbox: ['operation_uuid', 'operation_type', 'api_origin', 'installation_uuid', 'device_uuid', 'payload_json', 'payload_hash_sha256', 'status', 'local_ready', 'cycle_attempts', 'next_attempt_at'],
      sync_runtime: ['paused_until', 'requires_session_verification'],
      sync_publications: ['parent_uuid', 'reconciliation_id', 'revision', 'reconciliation_json', 'batch_json'],
      sync_report_files: ['parent_uuid', 'report_type', 'original_filename', 'size_bytes', 'sha256', 'generated_at'],
      sync_delivery_steps: ['parent_uuid', 'step', 'operation_uuid'],
    };
    for (const [table, columns] of Object.entries(requiredColumns)) {
      const actual = new Set((this.connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
      if (columns.some((column) => !actual.has(column))) throw new IncompatibleSchemaError();
    }
  }
}
