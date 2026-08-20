import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import type Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import { UNIFORM_PAYROLL_COLUMNS, UNIFORM_PAYROLL_LAYOUT } from '../../shared/payroll-layouts/uniformPayrollLayout.js';
import { parseAmountToCents } from '../../shared/utils/money.js';
import { calculateFileSha256 } from './FileHashService.js';
import { getMonthlyReportDirectory } from './ReportPathService.js';
import { TxtStreamParser } from './TxtStreamParser.js';

interface BatchRow {
  id: number; reconciliation_id: number; source_order: number; year: number; month: number; fortnight: number;
  payroll_type_code: string; original_filename: string; file_hash_sha256: string; layout_code: string; layout_version: number; version: number;
}

const HEADER_FILL = 'FF5E1128';
const BORDER_COLOR = 'FFD8DDE5';
const MAX_DATA_ROWS_PER_SHEET = 1_048_575;

function styleHeader(row: ExcelJS.Row, columnCount: number): void {
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = row.getCell(column); cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }; cell.alignment = { vertical: 'middle' };
  }
  row.height = 24;
}

export class ExcelReportBuilder {
  constructor(private readonly database: Database.Database, private readonly outputDirectory: string) {}

  async build(batchId: number, sourceFilePath: string): Promise<{ sourcePath: string }> {
    const batch = this.database.prepare(`SELECT pb.*,pt.code payroll_type_code FROM payroll_batches pb
      JOIN payroll_types pt ON pt.id=pb.payroll_type_id WHERE pb.id=?`).get(batchId) as BatchRow | undefined;
    if (!batch) throw new Error('No se encontró el lote para generar el TXT completo.');
    const groupCode = (this.database.prepare(`SELECT cg.code FROM monthly_reconciliations mr JOIN concept_groups cg ON cg.id=mr.concept_group_id
      WHERE mr.id=?`).get(batch.reconciliation_id) as { code: string }).code;
    const directory = getMonthlyReportDirectory(this.outputDirectory,batch.year,batch.month,groupCode);
    await fs.mkdir(directory,{ recursive:true });
    const suffix = `QNA_${String(batch.fortnight).padStart(2,'0')}_${batch.year}_${batch.payroll_type_code}_V${batch.version}_L${batch.id}`;
    const sourcePath = join(directory,`TXT_Completo_${suffix}.xlsx`);
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename:sourcePath,useStyles:true,useSharedStrings:true });
    let sheetIndex=1; let rowCount=0; let issueCount=0; let sheet=this.addDataSheet(workbook,'Contenido TXT');
    const issues=workbook.addWorksheet('Líneas no compatibles',{ views:[{ state:'frozen',ySplit:1 }] });
    issues.columns=[{ header:'Línea de origen',key:'line',width:18 },{ header:'Contenido original',key:'content',width:80 },
      { header:'Problema',key:'issue',width:55 }]; styleHeader(issues.getRow(1),3); issues.getRow(1).commit();
    for await (const item of new TxtStreamParser().parse(sourceFilePath)) {
      if (rowCount>=MAX_DATA_ROWS_PER_SHEET) { sheet.commit(); sheetIndex+=1; rowCount=0; sheet=this.addDataSheet(workbook,`Contenido_${sheetIndex}`); }
      if (!item.record) { issues.addRow({ line:item.lineNumber,content:item.rawLine,issue:item.error ?? 'Línea inválida.' }).commit(); issueCount+=1; continue; }
      const values:Array<string|number>=item.rawLine.split(UNIFORM_PAYROLL_LAYOUT.delimiter).map((value)=>value.trim());
      const amount=parseAmountToCents(item.record.amountRaw); if (amount!==null) values[UNIFORM_PAYROLL_LAYOUT.fields.amount]=amount/100;
      const row=sheet.addRow(values); row.getCell(UNIFORM_PAYROLL_LAYOUT.fields.amount+1).numFmt='$#,##0.00;[Red]-$#,##0.00'; row.commit(); rowCount+=1;
    }
    sheet.commit(); if (!issueCount) issues.addRow({ issue:'No se detectaron líneas incompatibles.' }).commit(); issues.commit();
    const metadata=workbook.addWorksheet('Metadatos',{ views:[{ showGridLines:false }] }); metadata.getColumn(1).width=26; metadata.getColumn(2).width=68;
    const rows:Array<[string,string|number|Date]>=[['Archivo origen',batch.original_filename],['Hash SHA-256',batch.file_hash_sha256],
      ['Fecha de proceso',new Date()],['Año',batch.year],['Mes',batch.month],['Quincena',batch.fortnight],['Tipo',batch.payroll_type_code],
      ['Versión del lote',batch.version],['Layout',batch.layout_code],['Versión de layout',batch.layout_version],['Hojas de contenido',sheetIndex]];
    for (const values of rows) { const row=metadata.addRow(values); row.getCell(1).font={ bold:true,color:{ argb:'FF344054' } };
      row.getCell(1).fill={ type:'pattern',pattern:'solid',fgColor:{ argb:'FFF3F4F6' } }; for (const cell of [row.getCell(1),row.getCell(2)])
        cell.border={ bottom:{ style:'thin',color:{ argb:BORDER_COLOR } } }; if (values[0]==='Fecha de proceso') row.getCell(2).numFmt='yyyy-mm-dd hh:mm:ss'; row.commit(); }
    metadata.commit(); await workbook.commit();
    const now=new Date().toISOString(); this.database.prepare(`INSERT INTO report_artifacts(batch_id,report_type,filename,file_path,file_hash_sha256,updated_at)
      VALUES (?,'SOURCE',?,?,?,?) ON CONFLICT(batch_id,report_type) WHERE batch_id IS NOT NULL DO UPDATE SET filename=excluded.filename,
      file_path=excluded.file_path,file_hash_sha256=excluded.file_hash_sha256,updated_at=excluded.updated_at`)
      .run(batchId,basename(sourcePath),sourcePath,await calculateFileSha256(sourcePath),now);
    return { sourcePath };
  }

  private addDataSheet(workbook:ExcelJS.stream.xlsx.WorkbookWriter,name:string):ExcelJS.Worksheet {
    const sheet=workbook.addWorksheet(name,{ views:[{ state:'frozen',ySplit:1 }] });
    sheet.columns=UNIFORM_PAYROLL_COLUMNS.map(({ header,width })=>({ header,width })); sheet.autoFilter={ from:'A1',to:'V1' };
    styleHeader(sheet.getRow(1),UNIFORM_PAYROLL_COLUMNS.length); sheet.getRow(1).commit(); return sheet;
  }
}
