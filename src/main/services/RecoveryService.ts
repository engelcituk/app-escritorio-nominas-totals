import type Database from 'better-sqlite3';

export class RecoveryService {
  constructor(private readonly database: Database.Database) {}

  recoverInterruptedBatches(): number {
    return this.database.prepare(`UPDATE payroll_batches SET status = 'INTERRUPTED', updated_at = ? WHERE status = 'PROCESSING'`)
      .run(new Date().toISOString()).changes;
  }
}
