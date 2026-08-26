import type Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations.js';

export class MigrationService {
  constructor(private readonly database: Database.Database) {}

  assertCurrent(): void {
    const exists = this.database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    if (!exists) throw new Error('La base requiere inicialización antes de abrir conexiones operativas.');
    const versions = this.database.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>;
    if (versions.length !== MIGRATIONS.length || versions.some((row, index) => row.version !== MIGRATIONS[index]?.version)) {
      throw new Error('La versión de la base local requiere migración desde el inicio de la aplicación.');
    }
  }

  run(): void {
    this.database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const applied = new Set(
      (this.database.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((row) => row.version),
    );
    if ([...applied].some((version) => !MIGRATIONS.some((migration) => migration.version === version))) throw new Error('La base pertenece a una versión más reciente.');
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
