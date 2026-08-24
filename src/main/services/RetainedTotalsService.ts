import type Database from 'better-sqlite3';

export interface RetainedTotalInput {
  employeeNumber: string; employeeName: string; sourcePayrollCode: string; conceptName: string;
  sourceKey: string; accountCode: string; movementType: string; recordCount: number; amountCents: number;
}

export class RetainedTotalsService {
  constructor(private readonly database: Database.Database) {}

  persist(batchId:number, totals:Iterable<RetainedTotalInput>):void {
    const now=new Date().toISOString();
    const insert=this.database.prepare(`INSERT INTO batch_retained_totals(batch_id,employee_number,employee_name,source_payroll_code,
      concept_name,source_key,account_code,movement_type,record_count,amount_cents,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    this.database.transaction(()=>{
      this.database.prepare('DELETE FROM batch_retained_totals WHERE batch_id=?').run(batchId);
      for(const item of totals)insert.run(batchId,item.employeeNumber,item.employeeName,item.sourcePayrollCode,item.conceptName,
        item.sourceKey,item.accountCode,item.movementType,item.recordCount,item.amountCents,now);
    })();
  }
}
