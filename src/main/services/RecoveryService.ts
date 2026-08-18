import type Database from 'better-sqlite3';

export class RecoveryService {
  constructor(private readonly database: Database.Database) {}

  recoverInterruptedBatches(): number {
    const now = new Date().toISOString();
    const batches = this.database.prepare(`UPDATE payroll_batches SET status = 'INTERRUPTED', updated_at = ? WHERE status = 'PROCESSING'`).run(now).changes;
    this.database.prepare(`UPDATE import_groups SET status = 'PARTIAL', updated_at = ? WHERE status = 'PROCESSING'`).run(now);
    return batches;
  }
}
