import type Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations.js';

export class MigrationService {
  constructor(private readonly database: Database.Database) {}

  run(): void {
    this.database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const applied = new Set(
      (this.database.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((row) => row.version),
    );
    const apply = this.database.transaction(() => {
      for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) continue;
        this.database.exec(migration.sql);
        this.database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
          migration.version,
          migration.name,
          new Date().toISOString(),
        );
      }
    });
    apply();
  }
}
