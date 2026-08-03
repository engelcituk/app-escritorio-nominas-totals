import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import type Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import { calculateFileSha256 } from './FileHashService.js';

interface BatchRow {
  id: number; year: number; fortnight: number; payroll_type: string; original_filename: string; file_hash_sha256: string;
  total_lines: number; valid_lines: number; excluded_lines: number; invalid_lines: number; matching_lines: number;
  total_amount_cents: number; layout_code: string; layout_version: number; version: number;
}

const HEADER_FILL = 'FF5E1128';
const PRIMARY_FILL = 'FFC8043C';

export class ExcelReportBuilder {
  constructor(private readonly database: Database.Database, private readonly outputDirectory: string) {}

  async build(batchId: number): Promise<{ detailPath: string; totalsPath: string; exportedTotal: number }> {
    await fs.mkdir(this.outputDirectory, { recursive: true });
    const batch = this.database.prepare('SELECT * FROM payroll_batches WHERE id = ?').get(batchId) as BatchRow | undefined;
    if (!batch) throw new Error('No se encontró el lote para generar sus reportes.');
    const suffix = `QNA_${String(batch.fortnight).padStart(2, '0')}_${batch.year}_${batch.payroll_type}`;
    const detailPath = join(this.outputDirectory, `Detalle_Extraido_ISR_${suffix}.xlsx`);
    const totalsPath = join(this.outputDirectory, `Totales_ISR_${suffix}.xlsx`);
    await this.buildDetail(batch, detailPath);
    const exportedTotal = await this.buildTotals(batch, totalsPath);
    const insert = this.database.prepare(`INSERT INTO generated_reports(batch_id, report_type, filename, file_path, file_hash_sha256, generated_at)
      VALUES (?, ?, ?, ?, ?, ?)`);
    const now = new Date().toISOString();
    insert.run(batchId, 'DETAIL', basename(detailPath), detailPath, await calculateFileSha256(detailPath), now);
    insert.run(batchId, 'TOTALS', basename(totalsPath), totalsPath, await calculateFileSha256(totalsPath), now);
    return { detailPath, totalsPath, exportedTotal };
  }

  private async buildDetail(batch: BatchRow, path: string): Promise<void> {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: path, useStyles: true, useSharedStrings: true });
    let sheetIndex = 1;
    let rowCount = 0;
    let sheet = this.addDetailSheet(workbook, 'Detalle');
    const rows = this.database.prepare(`SELECT line_number, component, funding_source, employee_number, employee_name,
      movement_type, concept_code, concept_description_original, concept_variant, amount_cents, account_code,
      control_code, final_indicator, concept_rule_id, status FROM payroll_records WHERE batch_id = ? ORDER BY line_number`).iterate(batch.id);
    for (const raw of rows) {
      if (rowCount >= 1_048_575) {
        sheet.commit();
        sheetIndex += 1;
        rowCount = 0;
        sheet = this.addDetailSheet(workbook, `Detalle_${sheetIndex}`);
      }
      const row = raw as Record<string, string | number | null>;
      const added = sheet.addRow([
        batch.year, batch.fortnight, batch.payroll_type, row.line_number, row.component, row.funding_source,
        row.employee_number, row.employee_name, row.movement_type, row.concept_code, row.concept_description_original,
        row.concept_variant, typeof row.amount_cents === 'number' ? row.amount_cents / 100 : null, row.account_code,
        row.control_code, row.final_indicator, row.concept_rule_id, row.status,
      ]);
      added.getCell(13).numFmt = '$#,##0.00;[Red]-$#,##0.00';
      added.commit();
      rowCount += 1;
    }
    sheet.commit();
    const metadata = workbook.addWorksheet('Metadatos');
    const metadataRows: Array<[string, string | number]> = [
      ['Archivo origen', batch.original_filename], ['Hash SHA-256', batch.file_hash_sha256], ['Fecha de proceso', new Date().toISOString()],
      ['Versión de aplicación', '0.1.0'], ['Layout', batch.layout_code], ['Versión de layout', batch.layout_version],
      ['Hojas de detalle', sheetIndex], ['Versión del lote', batch.version],
    ];
    for (const values of metadataRows) metadata.addRow(values).commit();
    metadata.commit();
    await workbook.commit();
  }

  private addDetailSheet(workbook: ExcelJS.stream.xlsx.WorkbookWriter, name: string): ExcelJS.Worksheet {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      ['Año', 10], ['Quincena', 11], ['Tipo de nómina', 20], ['Línea de origen', 15], ['Componente', 15],
      ['Fuente de financiamiento', 23], ['Número de empleado', 19], ['Nombre del empleado', 34], ['Tipo de movimiento', 19],
      ['Código de concepto', 19], ['Concepto original', 30], ['Variante ISR', 24], ['Importe', 16], ['Cuenta contable', 30],
      ['Código de control', 18], ['Indicador final', 17], ['Regla aplicada', 17], ['Estatus', 16],
    ].map(([header, width]) => ({ header: String(header), width: Number(width) }));
    sheet.autoFilter = { from: 'A1', to: 'R1' };
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    header.commit();
    return sheet;
  }

  private async buildTotals(batch: BatchRow, path: string): Promise<number> {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: path, useStyles: true, useSharedStrings: true });
    const summary = workbook.addWorksheet('Resumen');
    const summaryRows: Array<[string, string | number]> = [
      ['Año', batch.year], ['Quincena', batch.fortnight], ['Tipo de nómina', batch.payroll_type], ['Familia procesada', 'ISR'],
      ['Archivo origen', batch.original_filename], ['Hash', batch.file_hash_sha256], ['Total de líneas', batch.total_lines],
      ['Registros válidos', batch.valid_lines], ['Registros ISR', batch.matching_lines], ['Registros excluidos', batch.excluded_lines],
      ['Registros inválidos', batch.invalid_lines], ['TOTAL ISR A CONCILIAR', batch.total_amount_cents / 100],
      ['Fecha de procesamiento', new Date().toISOString()], ['Versión del layout', batch.layout_version], ['Versión de la aplicación', '0.1.0'],
    ];
    for (const values of summaryRows) {
      const row = summary.addRow(values);
      if (values[0] === 'TOTAL ISR A CONCILIAR') {
        row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRIMARY_FILL } };
        row.getCell(2).numFmt = '$#,##0.00;[Red]-$#,##0.00';
      }
      row.commit();
    }
    summary.commit();

    const accounts = workbook.addWorksheet('Totales por cuenta', { views: [{ state: 'frozen', ySplit: 1 }] });
    accounts.columns = [
      { header: 'Cuenta contable', key: 'account', width: 30 }, { header: 'Código', key: 'code', width: 14 },
      { header: 'Descripción', key: 'description', width: 30 }, { header: 'Variante ISR', key: 'variant', width: 24 },
      { header: 'Movimiento', key: 'movement', width: 14 }, { header: 'Registros', key: 'count', width: 14 },
      { header: 'Importe total', key: 'total', width: 18 }, { header: '% del total', key: 'percentage', width: 15 },
    ];
    const header = accounts.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    header.commit();
    const totals = this.database.prepare(`SELECT * FROM batch_totals WHERE batch_id = ? ORDER BY account_code, concept_variant`).all(batch.id) as Array<Record<string, string | number>>;
    let exportedTotal = 0;
    for (const item of totals) {
      const amount = Number(item.total_amount_cents);
      exportedTotal += amount;
      const row = accounts.addRow({ account: item.account_code, code: item.concept_code, description: item.concept_description,
        variant: item.concept_variant, movement: item.movement_type, count: item.record_count, total: amount / 100,
        percentage: batch.total_amount_cents ? amount / batch.total_amount_cents : 0 });
      row.getCell(7).numFmt = '$#,##0.00;[Red]-$#,##0.00';
      row.getCell(8).numFmt = '0.00%';
      row.commit();
    }
    accounts.autoFilter = { from: 'A1', to: 'H1' };
    accounts.commit();

    for (const [name, status] of [['Excluidos', 'EXCLUDED'], ['Errores', 'INVALID']] as const) {
      const sheet = workbook.addWorksheet(name);
      sheet.columns = [{ header: 'Línea', key: 'line', width: 12 }, { header: 'Empleado', key: 'employee', width: 22 },
        { header: 'Concepto', key: 'concept', width: 35 }, { header: 'Importe', key: 'amount', width: 16 },
        { header: 'Motivo', key: 'reason', width: 45 }];
      const rows = this.database.prepare(`SELECT line_number, employee_number, concept_description_original, amount_cents,
        COALESCE(exclusion_reason, validation_error) AS reason FROM payroll_records WHERE batch_id = ? AND status = ? ORDER BY line_number`).iterate(batch.id, status);
      for (const raw of rows) {
        const item = raw as Record<string, string | number | null>;
        const row = sheet.addRow({ line: item.line_number, employee: item.employee_number, concept: item.concept_description_original,
          amount: typeof item.amount_cents === 'number' ? item.amount_cents / 100 : null, reason: item.reason });
        row.getCell(4).numFmt = '$#,##0.00;[Red]-$#,##0.00';
        row.commit();
      }
      sheet.commit();
    }

    const audit = workbook.addWorksheet('Auditoría');
    for (const values of [
      ['Control', 'Importe'], ['Suma de registros válidos', batch.total_amount_cents / 100],
      ['Suma de totales persistidos', exportedTotal / 100], ['Suma exportada', exportedTotal / 100],
      ['Diferencia', (batch.total_amount_cents - exportedTotal) / 100],
    ]) audit.addRow(values).commit();
    audit.commit();
    await workbook.commit();
    return exportedTotal;
  }
}
