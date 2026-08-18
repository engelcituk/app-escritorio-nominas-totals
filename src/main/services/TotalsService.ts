import type Database from 'better-sqlite3';

export interface BatchTotalInput {
  sourceConceptId: number; conceptCode: string; conceptName: string; groupCode: string | null; groupName: string | null;
  sourcePayrollCode: string; sourceDescription: string; accountCode: string; movementType: string; operationFactor: 1 | -1;
  recordCount: number; originalAmountCents: number; totalAmountCents: number;
}

export class TotalsService {
  constructor(private readonly database: Database.Database) {}
  persist(batchId: number, totals: Iterable<BatchTotalInput>, recordsTotal: number): { recordsTotal: number; groupedTotal: number; difference: number } {
    const now = new Date().toISOString();
    const insert = this.database.prepare(`INSERT INTO batch_totals(batch_id, source_concept_id, concept_code, concept_name,
      group_code, group_name, source_payroll_code, source_description, account_code, movement_type, operation_factor,
      record_count, original_amount_cents, total_amount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let groupedTotal = 0;
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM batch_totals WHERE batch_id = ?').run(batchId);
      for (const total of totals) { groupedTotal += total.totalAmountCents; insert.run(batchId, total.sourceConceptId, total.conceptCode,
        total.conceptName, total.groupCode, total.groupName, total.sourcePayrollCode, total.sourceDescription, total.accountCode,
        total.movementType, total.operationFactor, total.recordCount, total.originalAmountCents, total.totalAmountCents, now); }
    })();
    return { recordsTotal, groupedTotal, difference: recordsTotal - groupedTotal };
  }
}
