import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import type Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import type { PayrollType } from '../../shared/enums/payroll.js';
import { RecordStatus } from '../../shared/enums/payroll.js';
import { PAYROLL_FIELD_LABELS } from '../../shared/payroll-layouts/payrollFieldLabels.js';
import type { ExclusionOptions } from '../../shared/types/payroll.js';
import { ConceptRuleEngine, type ConceptRule } from './ConceptRuleEngine.js';
import { ExclusionRuleEngine, type ExclusionRule } from './ExclusionRuleEngine.js';
import { calculateFileSha256 } from './FileHashService.js';
import { PayrollRecordEvaluator } from './PayrollRecordEvaluator.js';
import { getPeriodReportDirectory } from './ReportPathService.js';
import { TxtStreamParser } from './TxtStreamParser.js';

interface BatchRow {
  id: number; year: number; fortnight: number; payroll_type: PayrollType; original_filename: string; file_hash_sha256: string;
  total_lines: number; valid_lines: number; excluded_lines: number; invalid_lines: number; matching_lines: number;
  total_amount_cents: number; layout_code: string; layout_version: number; version: number;
}

const HEADER_FILL = 'FF5E1128';
const PRIMARY_FILL = 'FFC8043C';
const LABEL_FILL = 'FFF3F4F6';
const BORDER_COLOR = 'FFD8DDE5';
const MAX_DATA_ROWS_PER_SHEET = 1_048_575;

function styleHeader(row: ExcelJS.Row, columnCount: number): void {
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = row.getCell(column);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle' };
  }
  row.height = 24;
}

function configureKeyValueSheet(sheet: ExcelJS.Worksheet, labelWidth: number, valueWidth: number): void {
  sheet.getColumn(1).width = labelWidth;
  sheet.getColumn(2).width = valueWidth;
  sheet.properties.defaultRowHeight = 21;
}

function styleKeyValueRow(row: ExcelJS.Row): void {
  const label = row.getCell(1);
  const value = row.getCell(2);
  label.font = { bold: true, color: { argb: 'FF344054' } };
  label.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LABEL_FILL } };
  label.alignment = { vertical: 'middle' };
  value.alignment = { vertical: 'middle', wrapText: false };
  for (const cell of [label, value]) cell.border = { bottom: { style: 'thin', color: { argb: BORDER_COLOR } } };
}

export class ExcelReportBuilder {
  constructor(private readonly database: Database.Database, private readonly outputDirectory: string) {}

  async build(batchId: number, sourceFilePath: string, exclusions: ExclusionOptions): Promise<{
    detailPath: string; totalsPath: string; exportedTotal: number;
  }> {
    const batch = this.database.prepare('SELECT * FROM payroll_batches WHERE id = ?').get(batchId) as BatchRow | undefined;
    if (!batch) throw new Error('No se encontró el lote para generar sus reportes.');
    const periodDirectory = getPeriodReportDirectory(this.outputDirectory, batch.year, batch.fortnight);
    await fs.mkdir(periodDirectory, { recursive: true });
    const suffix = `QNA_${String(batch.fortnight).padStart(2, '0')}_${batch.year}_${batch.payroll_type}`;
    const detailPath = join(periodDirectory, `Detalle_Extraido_ISR_${suffix}.xlsx`);
    const totalsPath = join(periodDirectory, `Totales_ISR_${suffix}.xlsx`);

    const conceptRules = this.database.prepare(`SELECT * FROM concept_rules WHERE concept_family_id = 1 AND active = 1
      ORDER BY priority`).all() as ConceptRule[];
    const exclusionRules = this.database.prepare(`SELECT * FROM exclusion_rules WHERE active = 1 ORDER BY priority`).all() as ExclusionRule[];
    const evaluator = new PayrollRecordEvaluator(new ConceptRuleEngine(conceptRules), new ExclusionRuleEngine(exclusionRules),
      batch.payroll_type, exclusions);

    const detailWorkbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: detailPath, useStyles: true, useSharedStrings: true });
    const totalsWorkbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: totalsPath, useStyles: true, useSharedStrings: true });
    let detailSheetIndex = 1;
    let detailRowCount = 0;
    let detailSheet = this.addDetailSheet(detailWorkbook, 'Detalle');
    const exportedTotal = this.addSummaryAndAccountSheets(totalsWorkbook, batch);
    const excludedSheet = this.addIssueSheet(totalsWorkbook, 'Excluidos');
    const errorSheet = this.addIssueSheet(totalsWorkbook, 'Errores');

    for await (const item of new TxtStreamParser().parse(sourceFilePath)) {
      if (detailRowCount >= MAX_DATA_ROWS_PER_SHEET) {
        detailSheet.commit();
        detailSheetIndex += 1;
        detailRowCount = 0;
        detailSheet = this.addDetailSheet(detailWorkbook, `Detalle_${detailSheetIndex}`);
      }

      if (!item.record) {
        const row = detailSheet.addRow([
          batch.year, batch.fortnight, batch.payroll_type, item.lineNumber, null, null, null, null, null,
          null, null, null, null, null, null, null, RecordStatus.INVALID,
        ]);
        row.commit();
        this.addIssueRow(errorSheet, item.lineNumber, null, null, null, item.error ?? 'Línea inválida.');
      } else {
        const evaluation = evaluator.evaluate(item.record);
        const row = detailSheet.addRow([
          batch.year, batch.fortnight, batch.payroll_type, item.lineNumber, item.record.dependencyKey,
          item.record.employeeNumber, item.record.employeeName, item.record.movementType, item.record.conceptCode,
          item.record.conceptDescriptionOriginal, evaluation.classification.variant ?? null,
          evaluation.amountCents === null ? null : evaluation.amountCents / 100, item.record.accountCode,
          item.record.fundingSource, item.record.paymentCenter, evaluation.classification.ruleId ?? null, evaluation.status,
        ]);
        row.getCell(12).numFmt = '$#,##0.00;[Red]-$#,##0.00';
        row.commit();
        if (evaluation.status === RecordStatus.EXCLUDED) {
          this.addIssueRow(excludedSheet, item.lineNumber, item.record.employeeNumber, item.record.conceptDescriptionOriginal,
            evaluation.amountCents, evaluation.exclusion.reason ?? 'Excluido por una regla activa.');
        } else if (evaluation.status === RecordStatus.INVALID) {
          this.addIssueRow(errorSheet, item.lineNumber, item.record.employeeNumber, item.record.conceptDescriptionOriginal,
            evaluation.amountCents, evaluation.validationError ?? 'Registro inválido.');
        }
      }
      detailRowCount += 1;
    }

    detailSheet.commit();
    this.addMetadataSheet(detailWorkbook, batch, detailSheetIndex);
    excludedSheet.commit();
    errorSheet.commit();
    this.addAuditSheet(totalsWorkbook, batch, exportedTotal);
    await Promise.all([detailWorkbook.commit(), totalsWorkbook.commit()]);

    const insert = this.database.prepare(`INSERT INTO generated_reports(batch_id, report_type, filename, file_path, file_hash_sha256, generated_at)
      VALUES (?, ?, ?, ?, ?, ?)`);
    const now = new Date().toISOString();
    insert.run(batchId, 'DETAIL', basename(detailPath), detailPath, await calculateFileSha256(detailPath), now);
    insert.run(batchId, 'TOTALS', basename(totalsPath), totalsPath, await calculateFileSha256(totalsPath), now);
    return { detailPath, totalsPath, exportedTotal };
  }

  private addDetailSheet(workbook: ExcelJS.stream.xlsx.WorkbookWriter, name: string): ExcelJS.Worksheet {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      ['Año', 10], ['Quincena', 11], ['Tipo de nómina', 20], ['Línea de origen', 15],
      [PAYROLL_FIELD_LABELS.dependencyKey, 24], ['Número de empleado', 19], ['Nombre del empleado', 34], ['Tipo de movimiento', 19],
      ['Código de concepto', 19], ['Concepto original', 30], ['Variante ISR', 24], ['Importe', 16], ['Cuenta contable', 30],
      [PAYROLL_FIELD_LABELS.fundingSource, 23], [PAYROLL_FIELD_LABELS.paymentCenter, 18], ['Regla aplicada', 17], ['Estatus', 16],
    ].map(([header, width]) => ({ header: String(header), width: Number(width) }));
    sheet.autoFilter = { from: 'A1', to: 'Q1' };
    const header = sheet.getRow(1);
    styleHeader(header, 17);
    header.commit();
    return sheet;
  }

  private addMetadataSheet(workbook: ExcelJS.stream.xlsx.WorkbookWriter, batch: BatchRow, detailSheetCount: number): void {
    const metadata = workbook.addWorksheet('Metadatos', { views: [{ showGridLines: false }] });
    configureKeyValueSheet(metadata, 24, 68);
    const rows: Array<[string, string | number | Date]> = [
      ['Archivo origen', batch.original_filename], ['Hash SHA-256', batch.file_hash_sha256], ['Fecha de proceso', new Date()],
      ['Versión de aplicación', '0.1.0'], ['Layout', batch.layout_code], ['Versión de layout', batch.layout_version],
      ['Hojas de detalle', detailSheetCount], ['Versión del lote', batch.version],
    ];
    for (const values of rows) {
      const row = metadata.addRow(values);
      styleKeyValueRow(row);
      if (values[0] === 'Fecha de proceso') row.getCell(2).numFmt = 'yyyy-mm-dd hh:mm:ss';
      row.commit();
    }
    metadata.commit();
  }

  private addSummaryAndAccountSheets(workbook: ExcelJS.stream.xlsx.WorkbookWriter, batch: BatchRow): number {
    const summary = workbook.addWorksheet('Resumen', { views: [{ showGridLines: false }] });
    configureKeyValueSheet(summary, 30, 48);
    const summaryRows: Array<[string, string | number | Date]> = [
      ['Año', batch.year], ['Quincena', batch.fortnight], ['Tipo de nómina', batch.payroll_type], ['Familia procesada', 'ISR'],
      ['Archivo origen', batch.original_filename], ['Total de líneas', batch.total_lines], ['Registros válidos', batch.valid_lines],
      ['Registros ISR', batch.matching_lines], ['Registros excluidos', batch.excluded_lines], ['Registros inválidos', batch.invalid_lines],
      ['TOTAL ISR A CONCILIAR', batch.total_amount_cents / 100], ['Fecha de procesamiento', new Date()],
      ['Versión del layout', batch.layout_version], ['Versión de la aplicación', '0.1.0'],
    ];
    for (const values of summaryRows) {
      const row = summary.addRow(values);
      styleKeyValueRow(row);
      if (['Total de líneas', 'Registros válidos', 'Registros ISR', 'Registros excluidos', 'Registros inválidos'].includes(values[0])) {
        row.getCell(2).numFmt = '#,##0';
      } else if (typeof values[1] === 'number' && values[0] !== 'TOTAL ISR A CONCILIAR') row.getCell(2).numFmt = '0';
      if (values[0] === 'Fecha de procesamiento') row.getCell(2).numFmt = 'yyyy-mm-dd hh:mm:ss';
      if (values[0] === 'TOTAL ISR A CONCILIAR') {
        row.height = 27;
        for (const cell of [row.getCell(1), row.getCell(2)]) {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRIMARY_FILL } };
          cell.alignment = { vertical: 'middle' };
        }
        row.getCell(2).numFmt = '$#,##0.00;[Red]-$#,##0.00';
        row.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
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
    styleHeader(header, 8);
    header.commit();
    const totals = this.database.prepare(`SELECT * FROM batch_totals WHERE batch_id = ? ORDER BY account_code, concept_variant`)
      .all(batch.id) as Array<Record<string, string | number>>;
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
    return exportedTotal;
  }

  private addIssueSheet(workbook: ExcelJS.stream.xlsx.WorkbookWriter, name: string): ExcelJS.Worksheet {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [{ header: 'Línea', key: 'line', width: 12 }, { header: 'Empleado', key: 'employee', width: 22 },
      { header: 'Concepto', key: 'concept', width: 35 }, { header: 'Importe', key: 'amount', width: 16 },
      { header: 'Motivo', key: 'reason', width: 55 }];
    const header = sheet.getRow(1);
    styleHeader(header, 5);
    header.commit();
    sheet.autoFilter = { from: 'A1', to: 'E1' };
    return sheet;
  }

  private addIssueRow(sheet: ExcelJS.Worksheet, line: number, employee: string | null, concept: string | null,
    amountCents: number | null, reason: string): void {
    const row = sheet.addRow({ line, employee, concept, amount: amountCents === null ? null : amountCents / 100, reason });
    row.getCell(4).numFmt = '$#,##0.00;[Red]-$#,##0.00';
    row.commit();
  }

  private addAuditSheet(workbook: ExcelJS.stream.xlsx.WorkbookWriter, batch: BatchRow, exportedTotal: number): void {
    const audit = workbook.addWorksheet('Auditoría', { views: [{ showGridLines: false }] });
    configureKeyValueSheet(audit, 34, 20);
    let rowIndex = 0;
    for (const values of [
      ['Control', 'Importe'], ['Suma de registros válidos', batch.total_amount_cents / 100],
      ['Suma de totales persistidos', exportedTotal / 100], ['Suma exportada', exportedTotal / 100],
      ['Diferencia', (batch.total_amount_cents - exportedTotal) / 100],
    ]) {
      const row = audit.addRow(values);
      rowIndex += 1;
      if (rowIndex === 1) styleHeader(row, 2);
      else {
        styleKeyValueRow(row);
        row.getCell(2).numFmt = '$#,##0.00;[Red]-$#,##0.00';
        row.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
      }
      row.commit();
    }
    audit.commit();
  }
}
