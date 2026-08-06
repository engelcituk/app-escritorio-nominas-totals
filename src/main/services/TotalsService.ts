import type Database from 'better-sqlite3';

export interface BatchTotalInput {
  conceptVariant: string | null;
  conceptCode: string;
  conceptDescription: string;
  accountCode: string;
  movementType: string;
  recordCount: number;
  totalAmountCents: number;
}

export class TotalsService {
  constructor(private readonly database: Database.Database) {}

  persist(batchId: number, totals: Iterable<BatchTotalInput>, recordsTotal: number): { recordsTotal: number; groupedTotal: number; difference: number } {
    const now = new Date().toISOString();
    const insert = this.database.prepare(`INSERT INTO batch_totals(
      batch_id, concept_family_id, concept_variant, concept_code, concept_description, account_code,
      movement_type, record_count, total_amount_cents, created_at
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let groupedTotal = 0;
    const tx = this.database.transaction(() => {
      this.database.prepare('DELETE FROM batch_totals WHERE batch_id = ?').run(batchId);
      for (const total of totals) {
        groupedTotal += total.totalAmountCents;
        insert.run(batchId, total.conceptVariant, total.conceptCode, total.conceptDescription, total.accountCode,
          total.movementType, total.recordCount, total.totalAmountCents, now);
      }
    });
    tx();
    return { recordsTotal, groupedTotal, difference: recordsTotal - groupedTotal };
  }
}
