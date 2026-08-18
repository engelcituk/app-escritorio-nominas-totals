import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import type Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import { calculateFileSha256 } from './FileHashService.js';

interface GroupRow { id: number; year: number; version: number; total_amount_cents: number }

export class GroupReportBuilder {
  constructor(private readonly database: Database.Database, private readonly outputDirectory: string) {}
  async build(groupId: number): Promise<string> {
    const group = this.database.prepare('SELECT * FROM import_groups WHERE id=?').get(groupId) as GroupRow | undefined;
    if (!group) throw new Error('No se encontró el expediente para generar su consolidado.');
    const directory = join(this.outputDirectory, String(group.year), 'Expedientes', `EXP-${group.id}-v${group.version}`);
    await fs.mkdir(directory, { recursive: true });
    const path = join(directory, `Consolidado_Conceptos_EXP-${group.id}-v${group.version}.xlsx`);
    const workbook = new ExcelJS.Workbook(); workbook.creator = 'SEFIPLAN Nómina';
    const header = (row: ExcelJS.Row): void => { row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5E1128' } }; };
    const batches = this.database.prepare(`SELECT * FROM payroll_batches WHERE group_id=? AND status='COMPLETED' ORDER BY source_order`)
      .all(groupId) as Array<Record<string, string | number | null>>;

    const summary = workbook.addWorksheet('Resumen'); summary.columns = [{ width: 36 }, { width: 28 }];
    const additions = this.sum(groupId, 1); const deductions = this.sum(groupId, -1);
    const isr = this.database.prepare(`SELECT COALESCE(SUM(bt.total_amount_cents),0) AS total FROM batch_totals bt JOIN payroll_batches pb ON pb.id=bt.batch_id
      WHERE pb.group_id=? AND pb.status='COMPLETED' AND bt.group_code='ISR'`).get(groupId) as { total: number };
    [['Control', 'Valor'], ['Expediente', group.id], ['Año', group.year], ['Versión', group.version], ['Archivos conciliados', batches.length],
      ['Conceptos que suman', additions / 100], ['Conceptos que restan', deductions / 100], ['Total ISR', isr.total / 100],
      ['TOTAL GENERAL', group.total_amount_cents / 100]].forEach((values, index) => { const row = summary.addRow(values); if (!index) header(row);
        else if (index >= 5) row.getCell(2).numFmt = '$#,##0.00;[Red]-$#,##0.00'; });

    const sources = workbook.addWorksheet('Archivos'); sources.columns = [
      { header: 'Orden', key: 'order', width: 10 }, { header: 'Quincena', key: 'fortnight', width: 12 },
      { header: 'Tipo de nómina', key: 'type', width: 22 }, { header: 'Archivo', key: 'file', width: 44 },
      { header: 'Hash SHA-256', key: 'hash', width: 68 }, { header: 'Registros', key: 'records', width: 14 },
      { header: 'Excluidos', key: 'excluded', width: 14 }, { header: 'Total', key: 'total', width: 18 }]; header(sources.getRow(1));
    for (const batch of batches) { const row = sources.addRow({ order: batch.source_order, fortnight: batch.fortnight, type: batch.payroll_type,
      file: batch.original_filename, hash: batch.file_hash_sha256, records: batch.total_lines, excluded: batch.excluded_lines,
      total: Number(batch.total_amount_cents) / 100 }); row.getCell(8).numFmt = '$#,##0.00;[Red]-$#,##0.00'; }
    sources.autoFilter = { from: 'A1', to: 'H1' };

    const totals = workbook.addWorksheet('Totales'); totals.columns = [
      { header: 'Quincena', key: 'fortnight', width: 12 }, { header: 'Tipo de nómina', key: 'type', width: 22 },
      { header: 'Concepto', key: 'concept', width: 34 }, { header: 'Grupo', key: 'group', width: 22 },
      { header: 'Cuenta', key: 'account', width: 34 }, { header: 'Operación', key: 'operation', width: 14 },
      { header: 'Registros', key: 'records', width: 14 }, { header: 'Importe original', key: 'original', width: 20 },
      { header: 'Contribución', key: 'total', width: 20 }]; header(totals.getRow(1));
    const grouped = this.database.prepare(`SELECT pb.fortnight,pb.payroll_type,bt.concept_name,bt.group_name,bt.account_code,bt.operation_factor,
      SUM(bt.record_count) records,SUM(bt.original_amount_cents) original,SUM(bt.total_amount_cents) total FROM batch_totals bt
      JOIN payroll_batches pb ON pb.id=bt.batch_id WHERE pb.group_id=? AND pb.status='COMPLETED'
      GROUP BY pb.fortnight,pb.payroll_type,bt.source_concept_id,bt.account_code,bt.operation_factor
      ORDER BY pb.fortnight,pb.payroll_type,bt.concept_name`).all(groupId) as Array<Record<string, string | number | null>>;
    for (const item of grouped) { const row = totals.addRow({ fortnight: item.fortnight, type: item.payroll_type, concept: item.concept_name,
      group: item.group_name ?? 'Sin grupo', account: item.account_code, operation: Number(item.operation_factor) === -1 ? 'RESTA' : 'SUMA',
      records: item.records, original: Number(item.original) / 100, total: Number(item.total) / 100 });
      row.getCell(8).numFmt = '$#,##0.00;[Red]-$#,##0.00'; row.getCell(9).numFmt = '$#,##0.00;[Red]-$#,##0.00'; }

    const retained = workbook.addWorksheet('Retenidos'); retained.columns = [
      { header: 'Archivo', key: 'file', width: 44 }, { header: 'Quincena', key: 'fortnight', width: 12 },
      { header: 'Empleado', key: 'employee', width: 20 }, { header: 'Nombre', key: 'name', width: 40 },
      { header: 'Encontrados', key: 'found', width: 15 }, { header: 'Excluidos', key: 'excluded', width: 15 },
      { header: 'Resultado', key: 'result', width: 22 }]; header(retained.getRow(1));
    const retainedRows = this.database.prepare(`SELECT pb.original_filename,pb.fortnight,r.* FROM batch_retained_employees r
      JOIN payroll_batches pb ON pb.id=r.batch_id WHERE pb.group_id=? ORDER BY pb.source_order,r.employee_number`).all(groupId) as
      Array<Record<string, string | number | null>>;
    for (const item of retainedRows) retained.addRow({ file: item.original_filename, fortnight: item.fortnight, employee: item.employee_number,
      name: item.employee_name ?? '', found: item.found_records, excluded: item.excluded_records,
      result: Number(item.found_records) ? 'Encontrado' : 'No encontrado' });

    await workbook.xlsx.writeFile(path); const hash = await calculateFileSha256(path);
    this.database.prepare(`INSERT INTO generated_reports(group_id,report_type,filename,file_path,file_hash_sha256,generated_at)
      VALUES (?,'GROUP_TOTALS',?,?,?,?)`).run(groupId, basename(path), path, hash, new Date().toISOString()); return path;
  }
  private sum(groupId: number, factor: 1 | -1): number { return (this.database.prepare(`SELECT COALESCE(SUM(bt.total_amount_cents),0) total
    FROM batch_totals bt JOIN payroll_batches pb ON pb.id=bt.batch_id WHERE pb.group_id=? AND pb.status='COMPLETED' AND bt.operation_factor=?`)
    .get(groupId, factor) as { total: number }).total; }
}
