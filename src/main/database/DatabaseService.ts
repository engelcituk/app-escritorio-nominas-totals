import Database from 'better-sqlite3';
import { MigrationService } from './MigrationService.js';

export class DatabaseService {
  readonly connection: Database.Database;

  constructor(path: string) {
    this.connection = new Database(path);
    this.connection.pragma('journal_mode = WAL');
    this.connection.pragma('foreign_keys = ON');
    this.connection.pragma('busy_timeout = 5000');
    new MigrationService(this.connection).run();
    this.seed();
  }

  close(): void {
    this.connection.close();
  }

  private seed(): void {
    const now = new Date().toISOString();
    this.connection
      .prepare(`INSERT OR IGNORE INTO concept_families(id, code, name, description, active, created_at, updated_at)
                VALUES (1, 'ISR', 'Impuesto sobre la Renta', 'Retenciones de ISR de nómina', 1, ?, ?)`)
      .run(now, now);
    const count = (this.connection.prepare('SELECT COUNT(*) AS count FROM concept_rules').get() as { count: number }).count;
    if (count === 0) {
      const insert = this.connection.prepare(`INSERT INTO concept_rules(
        concept_family_id, payroll_type, concept_code_equals, description_contains, movement_type_equals,
        variant_code, variant_name, priority, active, created_at, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
      const tx = this.connection.transaction(() => {
        insert.run('SUELDOS', '101', 'ISR POR SALARIOS', 'D', 'ISR_POR_SALARIOS', 'ISR por salarios', 10, now, now);
        insert.run(null, null, 'ISR ASIMILADOS RETRO', null, 'ISR_ASIMILADOS_RETRO', 'ISR asimilados retroactivo', 20, now, now);
        insert.run(null, null, 'ISR ASIMILADOS', null, 'ISR_ASIMILADOS', 'ISR asimilados', 30, now, now);
        insert.run(null, null, 'ISR RETROACTIVO', null, 'ISR_RETROACTIVO', 'ISR retroactivo', 40, now, now);
        insert.run(null, null, 'ISR', null, 'ISR_OTRO', 'ISR', 100, now, now);
      });
      tx();
    }
  }
}
