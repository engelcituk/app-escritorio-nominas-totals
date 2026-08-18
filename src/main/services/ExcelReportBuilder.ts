import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import type Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import type { PayrollType } from '../../shared/enums/payroll.js';
import { RecordStatus } from '../../shared/enums/payroll.js';
import { UNIFORM_PAYROLL_COLUMNS, UNIFORM_PAYROLL_LAYOUT } from '../../shared/payroll-layouts/uniformPayrollLayout.js';
import { ConceptMatcher, type ConceptMatchRule } from './ConceptMatcher.js';
import { calculateFileSha256 } from './FileHashService.js';
import { PayrollRecordEvaluator } from './PayrollRecordEvaluator.js';
import { TxtStreamParser } from './TxtStreamParser.js';

interface BatchRow {
  id: number; group_id: number; source_order: number; year: number; fortnight: number; payroll_type: PayrollType; original_filename: string; file_hash_sha256: string;
  total_lines: number; valid_lines: number; excluded_lines: number; invalid_lines: number; matching_lines: number;
  total_amount_cents: number; layout_code: string; layout_version: number; version: number; attempt: number;
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

  async build(batchId: number, sourceFilePath: string): Promise<{
    sourcePath: string; detailPath: string; totalsPath: string; exportedTotal: number;
  }> {
    const batch = this.database.prepare('SELECT * FROM payroll_batches WHERE id = ?').get(batchId) as BatchRow | undefined;
    if (!batch) throw new Error('No se encontró el lote para generar sus reportes.');
    const group = this.database.prepare(`SELECT version FROM import_groups WHERE id = ?`).get(batch.group_id) as { version: number };
    const periodDirectory = join(this.outputDirectory, String(batch.year), 'Expedientes', `EXP-${batch.group_id}-v${group.version}`,
      `Q${String(batch.fortnight).padStart(2, '0')}`);
    await fs.mkdir(periodDirectory, { recursive: true });
    const suffix = `QNA_${String(batch.fortnight).padStart(2, '0')}_${batch.year}_${batch.payroll_type}_A${batch.source_order}_L${batch.id}`;
    const sourcePath = join(periodDirectory, `TXT_Completo_${suffix}.xlsx`);
    const detailPath = join(periodDirectory, `Detalle_Conceptos_${suffix}.xlsx`);
    const totalsPath = join(periodDirectory, `Totales_Conceptos_${suffix}.xlsx`);

    const rules = this.database.prepare(`SELECT a.source_alias_id AS aliasId, c.source_concept_id AS conceptId,
      c.concept_code AS conceptCode, c.concept_name AS conceptName, NULL AS groupId, c.group_code AS groupCode,
      c.group_name AS groupName, c.operation_factor AS operationFactor, a.normalized_description AS normalizedDescription
      FROM batch_alias_snapshots a JOIN batch_concept_snapshots c ON c.batch_id=a.batch_id AND c.source_concept_id=a.source_concept_id
      WHERE a.batch_id=?`).all(batchId) as ConceptMatchRule[];
    const selectedConceptIds = new Set((this.database.prepare(`SELECT source_concept_id FROM batch_concept_snapshots WHERE batch_id=? AND selected=1`)
      .all(batchId) as Array<{ source_concept_id: number }>).map((item) => item.source_concept_id));
    const retainedEmployees = new Set((this.database.prepare(`SELECT employee_number FROM batch_retained_employees WHERE batch_id=?`).all(batchId) as
      Array<{ employee_number: string }>).map((item) => item.employee_number));
    const evaluator = new PayrollRecordEvaluator(new ConceptMatcher(rules), selectedConceptIds, retainedEmployees);

    const sourceWorkbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: sourcePath, useStyles: true, useSharedStrings: true });
    const detailWorkbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: detailPath, useStyles: true, useSharedStrings: true });
    const totalsWorkbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: totalsPath, useStyles: true, useSharedStrings: true });
    let sourceSheetIndex = 1;
    let sourceRowCount = 0;
    let sourceIssueCount = 0;
    let sourceSheet = this.addPayrollDataSheet(sourceWorkbook, 'Contenido TXT');
    const sourceIssuesSheet = this.addSourceIssueSheet(sourceWorkbook);
    let detailSheetIndex = 1;
    let detailRowCount = 0;
    let detailSheet = this.addPayrollDataSheet(detailWorkbook, 'Detalle');
    const exportedTotal = this.addSummaryAndAccountSheets(totalsWorkbook, batch);
    const excludedSheet = this.addIssueSheet(totalsWorkbook, 'Excluidos');
    const errorSheet = this.addIssueSheet(totalsWorkbook, 'Errores');

    for await (const item of new TxtStreamParser().parse(sourceFilePath)) {
      if (sourceRowCount >= MAX_DATA_ROWS_PER_SHEET) {
        sourceSheet.commit();
        sourceSheetIndex += 1;
        sourceRowCount = 0;
        sourceSheet = this.addPayrollDataSheet(sourceWorkbook, `Contenido_${sourceSheetIndex}`);
      }
      if (detailRowCount >= MAX_DATA_ROWS_PER_SHEET) {
        detailSheet.commit();
        detailSheetIndex += 1;
        detailRowCount = 0;
        detailSheet = this.addPayrollDataSheet(detailWorkbook, `Detalle_${detailSheetIndex}`);
      }

      if (!item.record) {
        this.addSourceIssueRow(sourceIssuesSheet, item.lineNumber, item.rawLine, item.error ?? 'Línea inválida.');
        sourceIssueCount += 1;
        this.addIssueRow(errorSheet, item.lineNumber, null, null, null, item.error ?? 'Línea inválida.');
      } else {
        const evaluation = evaluator.evaluate(item.record);
        const sourceColumns = this.toSourceColumns(item.rawLine, evaluation.amountCents);
        this.addPayrollDataRow(sourceSheet, sourceColumns);
        sourceRowCount += 1;
        if (evaluation.status === RecordStatus.VALID) {
          this.addPayrollDataRow(detailSheet, sourceColumns);
          detailRowCount += 1;
        } else if (evaluation.status === RecordStatus.EXCLUDED) {
          this.addIssueRow(excludedSheet, item.lineNumber, item.record.employeeNumber, item.record.conceptDescriptionOriginal,
            evaluation.amountCents, evaluation.exclusionReason ?? 'Concepto no incluido en la totalización.');
        } else if (evaluation.status === RecordStatus.INVALID) {
          this.addIssueRow(errorSheet, item.lineNumber, item.record.employeeNumber, item.record.conceptDescriptionOriginal,
            evaluation.amountCents, evaluation.validationError ?? 'Registro inválido.');
        }
      }
    }

    sourceSheet.commit();
    if (sourceIssueCount === 0) sourceIssuesSheet.addRow({ issue: 'No se detectaron líneas incompatibles.' }).commit();
    sourceIssuesSheet.commit();
    this.addMetadataSheet(sourceWorkbook, batch, sourceSheetIndex, 'Hojas de contenido');
    detailSheet.commit();
    this.addMetadataSheet(detailWorkbook, batch, detailSheetIndex);
    excludedSheet.commit();
    errorSheet.commit();
    this.addAuditSheet(totalsWorkbook, batch, exportedTotal);
    await Promise.all([sourceWorkbook.commit(), detailWorkbook.commit(), totalsWorkbook.commit()]);

    const insert = this.database.prepare(`INSERT INTO generated_reports(batch_id, report_type, filename, file_path, file_hash_sha256, generated_at)
      VALUES (?, ?, ?, ?, ?, ?)`);
    const now = new Date().toISOString();
    insert.run(batchId, 'SOURCE', basename(sourcePath), sourcePath, await calculateFileSha256(sourcePath), now);
    insert.run(batchId, 'DETAIL', basename(detailPath), detailPath, await calculateFileSha256(detailPath), now);
    insert.run(batchId, 'TOTALS', basename(totalsPath), totalsPath, await calculateFileSha256(totalsPath), now);
    return { sourcePath, detailPath, totalsPath, exportedTotal };
  }

  private addPayrollDataSheet(workbook: ExcelJS.stream.xlsx.WorkbookWriter, name: string): ExcelJS.Worksheet {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = UNIFORM_PAYROLL_COLUMNS.map(({ header, width }) => ({ header, width }));
    sheet.autoFilter = { from: 'A1', to: 'V1' };
    const header = sheet.getRow(1);
    styleHeader(header, UNIFORM_PAYROLL_COLUMNS.length);
    header.commit();
    return sheet;
  }

  private toSourceColumns(rawLine: string, amountCents: number | null): Array<string | number> {
    const sourceColumns: Array<string | number> = rawLine.split(UNIFORM_PAYROLL_LAYOUT.delimiter)
      .map((value) => value.trim());
    if (amountCents !== null) sourceColumns[UNIFORM_PAYROLL_LAYOUT.fields.amount] = amountCents / 100;
    return sourceColumns;
  }

  private addPayrollDataRow(sheet: ExcelJS.Worksheet, values: Array<string | number>): void {
    const row = sheet.addRow(values);
    row.getCell(UNIFORM_PAYROLL_LAYOUT.fields.amount + 1).numFmt = '$#,##0.00;[Red]-$#,##0.00';
    row.commit();
  }

  private addSourceIssueSheet(workbook: ExcelJS.stream.xlsx.WorkbookWriter): ExcelJS.Worksheet {
    const sheet = workbook.addWorksheet('Líneas no compatibles', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Línea de origen', key: 'line', width: 18 },
      { header: 'Contenido original', key: 'content', width: 80 },
      { header: 'Problema', key: 'issue', width: 55 },
    ];
    styleHeader(sheet.getRow(1), 3);
    sheet.getRow(1).commit();
    sheet.autoFilter = { from: 'A1', to: 'C1' };
    return sheet;
  }

  private addSourceIssueRow(sheet: ExcelJS.Worksheet, line: number, content: string, issue: string): void {
    sheet.addRow({ line, content, issue }).commit();
  }

  private addMetadataSheet(workbook: ExcelJS.stream.xlsx.WorkbookWriter, batch: BatchRow, sheetCount: number,
    sheetCountLabel = 'Hojas de detalle'): void {
    const metadata = workbook.addWorksheet('Metadatos', { views: [{ showGridLines: false }] });
    configureKeyValueSheet(metadata, 24, 68);
    const rows: Array<[string, string | number | Date]> = [
      ['Archivo origen', batch.original_filename], ['Hash SHA-256', batch.file_hash_sha256], ['Fecha de proceso', new Date()],
      ['Versión de aplicación', '0.1.0'], ['Layout', batch.layout_code], ['Versión de layout', batch.layout_version],
      [sheetCountLabel, sheetCount], ['Versión del lote', batch.version], ['Intento de procesamiento', batch.attempt],
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
    const signed = this.database.prepare(`SELECT
      COALESCE(SUM(CASE WHEN operation_factor = 1 THEN total_amount_cents ELSE 0 END), 0) AS additions,
      COALESCE(SUM(CASE WHEN operation_factor = -1 THEN total_amount_cents ELSE 0 END), 0) AS refunds
      FROM batch_totals WHERE batch_id = ?`).get(batch.id) as { additions: number; refunds: number };
    const summaryRows: Array<[string, string | number | Date]> = [
      ['Año', batch.year], ['Quincena', batch.fortnight], ['Tipo de nómina', batch.payroll_type],
      ['Archivo origen', batch.original_filename], ['Total de líneas', batch.total_lines], ['Registros válidos', batch.valid_lines],
      ['Registros catalogados', batch.matching_lines], ['Registros excluidos', batch.excluded_lines], ['Registros inválidos', batch.invalid_lines],
      ['Conceptos que suman', signed.additions / 100], ['Conceptos que restan', signed.refunds / 100],
      ['TOTAL A CONCILIAR', batch.total_amount_cents / 100], ['Fecha de procesamiento', new Date()],
      ['Versión del layout', batch.layout_version], ['Versión de la aplicación', '0.1.0'],
    ];
    for (const values of summaryRows) {
      const row = summary.addRow(values);
      styleKeyValueRow(row);
      if (['Total de líneas', 'Registros válidos', 'Registros catalogados', 'Registros excluidos', 'Registros inválidos'].includes(values[0])) {
        row.getCell(2).numFmt = '#,##0';
      } else if (['Conceptos que suman', 'Conceptos que restan'].includes(values[0])) {
        row.getCell(2).numFmt = '$#,##0.00;[Red]-$#,##0.00';
      } else if (typeof values[1] === 'number' && values[0] !== 'TOTAL A CONCILIAR') row.getCell(2).numFmt = '0';
      if (values[0] === 'Fecha de procesamiento') row.getCell(2).numFmt = 'yyyy-mm-dd hh:mm:ss';
      if (values[0] === 'TOTAL A CONCILIAR') {
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
      { header: 'Descripción origen', key: 'description', width: 30 }, { header: 'Concepto', key: 'concept', width: 28 },
      { header: 'Grupo', key: 'group', width: 20 },
      { header: 'Movimiento', key: 'movement', width: 14 }, { header: 'Operación', key: 'operation', width: 13 },
      { header: 'Registros', key: 'count', width: 14 }, { header: 'Importe original', key: 'original', width: 18 },
      { header: 'Contribución', key: 'total', width: 18 }, { header: '% del neto', key: 'percentage', width: 15 },
    ];
    const header = accounts.getRow(1);
    styleHeader(header, 11);
    header.commit();
    const totals = this.database.prepare(`SELECT * FROM batch_totals WHERE batch_id = ? ORDER BY account_code, concept_name`)
      .all(batch.id) as Array<Record<string, string | number>>;
    let exportedTotal = 0;
    for (const item of totals) {
      const amount = Number(item.total_amount_cents);
      exportedTotal += amount;
      const row = accounts.addRow({ account: item.account_code, code: item.source_payroll_code, description: item.source_description,
        concept: item.concept_name, group: item.group_name ?? 'Sin grupo', movement: item.movement_type, operation: Number(item.operation_factor) === -1 ? 'RESTA' : 'SUMA',
        count: item.record_count, original: Number(item.original_amount_cents) / 100, total: amount / 100,
        percentage: batch.total_amount_cents ? amount / batch.total_amount_cents : 0 });
      row.getCell(9).numFmt = '$#,##0.00;[Red]-$#,##0.00'; row.getCell(10).numFmt = '$#,##0.00;[Red]-$#,##0.00';
      row.getCell(11).numFmt = '0.00%';
      row.commit();
    }
    accounts.autoFilter = { from: 'A1', to: 'K1' };
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
