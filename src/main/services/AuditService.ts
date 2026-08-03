import type Database from 'better-sqlite3';

export class AuditService {
  constructor(private readonly database: Database.Database) {}

  log(action: string, entityType: string, entityId: string | number | null, description: string, metadata?: unknown): void {
    this.database.prepare(`INSERT INTO audit_logs(action, entity_type, entity_id, description, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(action, entityType, entityId === null ? null : String(entityId), description,
        metadata === undefined ? null : JSON.stringify(metadata), new Date().toISOString());
  }
}
