import type Database from 'better-sqlite3';

export class TotalsService {
  constructor(private readonly database: Database.Database) {}

  calculate(batchId: number): { recordsTotal: number; groupedTotal: number; difference: number } {
    const now = new Date().toISOString();
    const tx = this.database.transaction(() => {
      this.database.prepare('DELETE FROM batch_totals WHERE batch_id = ?').run(batchId);
      this.database.prepare(`INSERT INTO batch_totals(
        batch_id, concept_family_id, concept_variant, concept_code, concept_description, account_code,
        movement_type, record_count, total_amount_cents, created_at
      ) SELECT batch_id, 1, concept_variant, concept_code, concept_description_canonical, account_code,
               movement_type, COUNT(*), SUM(amount_cents), ?
        FROM payroll_records WHERE batch_id = ? AND status = 'VALID'
        GROUP BY batch_id, concept_variant, concept_code, concept_description_canonical, account_code, movement_type`).run(now, batchId);
    });
    tx();
    const recordsTotal = (this.database.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payroll_records WHERE batch_id = ? AND status = 'VALID'`).get(batchId) as { total: number }).total;
    const groupedTotal = (this.database.prepare('SELECT COALESCE(SUM(total_amount_cents), 0) AS total FROM batch_totals WHERE batch_id = ?').get(batchId) as { total: number }).total;
    return { recordsTotal, groupedTotal, difference: recordsTotal - groupedTotal };
  }
}
