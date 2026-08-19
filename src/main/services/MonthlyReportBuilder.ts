import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import type Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import { calculateFileSha256 } from './FileHashService.js';

interface ReconciliationRow { id:number; year:number; month:number; revision:number; total_amount_cents:number; group_code:string; group_name:string }
type DataRow=Record<string,string|number|null>;
const WINE='FF5E1128'; const RED='FFC8043C'; const PALE='FFF5F0F2'; const LINE='FFD8DDE5'; const MONEY='$#,##0.00;[Red]-$#,##0.00';

function title(sheet:ExcelJS.Worksheet,text:string,subtitle:string,lastColumn:number):void {
  sheet.mergeCells(1,1,1,lastColumn); const t=sheet.getCell(1,1); t.value=text; t.font={ bold:true,size:16,color:{ argb:'FFFFFFFF' } };
  t.fill={ type:'pattern',pattern:'solid',fgColor:{ argb:WINE } }; t.alignment={ vertical:'middle' }; sheet.getRow(1).height=32;
  sheet.mergeCells(2,1,2,lastColumn); const s=sheet.getCell(2,1); s.value=subtitle; s.font={ color:{ argb:'FF475467' },italic:true };
  s.fill={ type:'pattern',pattern:'solid',fgColor:{ argb:'FFF8FAFC' } }; sheet.getRow(2).height=24;
}
function header(row:ExcelJS.Row,count:number):void { for(let i=1;i<=count;i+=1){ const c=row.getCell(i); c.font={ bold:true,color:{ argb:'FFFFFFFF' } };
  c.fill={ type:'pattern',pattern:'solid',fgColor:{ argb:WINE } }; c.alignment={ vertical:'middle',wrapText:true }; } row.height=26; }
function borders(row:ExcelJS.Row,count:number):void { for(let i=1;i<=count;i+=1) row.getCell(i).border={ bottom:{ style:'thin',color:{ argb:LINE } } }; }

export class MonthlyReportBuilder {
  constructor(private readonly database:Database.Database,private readonly outputDirectory:string){}

  async build(reconciliationId:number):Promise<string>{
    const rec=this.database.prepare(`SELECT mr.*,cg.code group_code,cg.name group_name FROM monthly_reconciliations mr
      JOIN concept_groups cg ON cg.id=mr.concept_group_id WHERE mr.id=?`).get(reconciliationId) as ReconciliationRow|undefined;
    if(!rec) throw new Error('No se encontró el expediente mensual.');
    const batches=this.database.prepare(`SELECT pb.*,pt.code payroll_type_code,pt.name payroll_type_name FROM payroll_batches pb
      JOIN payroll_types pt ON pt.id=pb.payroll_type_id WHERE pb.reconciliation_id=? AND pb.is_active=1 AND pb.status='COMPLETED'
      ORDER BY pb.fortnight,pt.name`).all(reconciliationId) as DataRow[];
    const totals=this.database.prepare(`SELECT pb.fortnight,pt.code payroll_type_code,pt.name payroll_type_name,bt.* FROM batch_totals bt
      JOIN payroll_batches pb ON pb.id=bt.batch_id JOIN payroll_types pt ON pt.id=pb.payroll_type_id
      WHERE pb.reconciliation_id=? AND pb.is_active=1 AND pb.status='COMPLETED'
      ORDER BY pb.fortnight,pt.name,bt.source_key,bt.account_code,bt.concept_name`).all(reconciliationId) as DataRow[];
    const computed=totals.reduce((sum,row)=>sum+Number(row.total_amount_cents),0);
    if(computed!==rec.total_amount_cents) throw new Error(`El reporte mensual no concilia: diferencia ${rec.total_amount_cents-computed} centavos.`);
    const directory=join(this.outputDirectory,String(rec.year),`M${String(rec.month).padStart(2,'0')}`,rec.group_code); await fs.mkdir(directory,{ recursive:true });
    const path=join(directory,`Totales_${rec.group_code}_${rec.year}_M${String(rec.month).padStart(2,'0')}.xlsx`);
    const temporary=`${path}.tmp-${process.pid}-${Date.now()}.xlsx`; const workbook=new ExcelJS.Workbook(); workbook.creator='SEFIPLAN Nómina';
    this.addSummary(workbook,rec,totals); this.addPayroll(workbook,rec,batches,totals); this.addGrouped(workbook,rec,totals);
    this.addControl(workbook,rec,batches,computed); this.addRetained(workbook,rec,reconciliationId);
    await workbook.xlsx.writeFile(temporary); try { await fs.rename(temporary,path); }
    catch(error){ await fs.rm(temporary,{ force:true }); throw error; }
    const now=new Date().toISOString(); this.database.prepare(`INSERT INTO report_artifacts(reconciliation_id,report_type,filename,file_path,file_hash_sha256,updated_at)
      VALUES (?,'MONTHLY_TOTALS',?,?,?,?) ON CONFLICT(reconciliation_id,report_type) WHERE reconciliation_id IS NOT NULL DO UPDATE SET
      filename=excluded.filename,file_path=excluded.file_path,file_hash_sha256=excluded.file_hash_sha256,updated_at=excluded.updated_at`)
      .run(reconciliationId,basename(path),path,await calculateFileSha256(path),now); return path;
  }

  private addSummary(workbook:ExcelJS.Workbook,rec:ReconciliationRow,totals:DataRow[]):void{
    const concepts=[...new Set(totals.map((row)=>String(row.concept_name)))].sort((a,b)=>a.localeCompare(b,'es'));
    const q1=rec.month*2-1; const q2=rec.month*2; const last=2+concepts.length+3;
    const sheet=workbook.addWorksheet('Resumen mensual',{ views:[{ state:'frozen',ySplit:8,xSplit:2,showGridLines:false }] }); title(sheet,
      `Conciliación mensual de ${rec.group_name}`,`${rec.year} · Mes ${String(rec.month).padStart(2,'0')} · Revisión ${rec.revision}`,last);
    const additions=totals.filter((r)=>Number(r.operation_factor)===1).reduce((s,r)=>s+Number(r.total_amount_cents),0);
    const refunds=Math.abs(totals.filter((r)=>Number(r.operation_factor)===-1).reduce((s,r)=>s+Number(r.total_amount_cents),0));
    const indicators=[['Total neto',rec.total_amount_cents/100],['Conceptos que suman',additions/100],['Reintegros',refunds/100],['Archivos activos',new Set(totals.map(r=>r.batch_id)).size]];
    indicators.forEach(([label,value],index)=>{ const col=index*2+1; sheet.mergeCells(4,col,4,col+1); sheet.getCell(4,col).value=label; sheet.getCell(4,col).font={ bold:true,color:{ argb:'FF475467' } };
      sheet.mergeCells(5,col,5,col+1); const c=sheet.getCell(5,col); c.value=value; c.font={ bold:true,size:14,color:{ argb:index===0?RED:'FF101828' } };
      c.fill={ type:'pattern',pattern:'solid',fgColor:{ argb:index===0?'FFFFF1F3':PALE } }; if(index<3)c.numFmt=MONEY; });
    const headers=['Fuente','Cuenta contable',...concepts,`Q${String(q1).padStart(2,'0')}`,`Q${String(q2).padStart(2,'0')}`,'Total mensual'];
    const start=8; sheet.getRow(start).values=headers; header(sheet.getRow(start),headers.length);
    const grouped=new Map<string,{ source:string;account:string;concepts:Map<string,number>;q1:number;q2:number;total:number }>();
    for(const row of totals){ const source=String(row.source_key||'SIN FUENTE'); const account=String(row.account_code||'SIN CUENTA'); const key=`${source}\u0000${account}`;
      const item=grouped.get(key)??{ source,account,concepts:new Map(),q1:0,q2:0,total:0 }; const amount=Number(row.total_amount_cents);
      item.concepts.set(String(row.concept_name),(item.concepts.get(String(row.concept_name))??0)+amount); if(Number(row.fortnight)===q1)item.q1+=amount; else item.q2+=amount;
      item.total+=amount; grouped.set(key,item); }
    for(const item of [...grouped.values()].sort((a,b)=>a.source.localeCompare(b.source)||a.account.localeCompare(b.account))){
      const row=sheet.addRow([item.source,item.account,...concepts.map(c=>(item.concepts.get(c)??0)/100),item.q1/100,item.q2/100,item.total/100]);
      for(let c=3;c<=headers.length;c+=1)row.getCell(c).numFmt=MONEY; borders(row,headers.length); }
    const totalRow=sheet.addRow(['TOTAL MENSUAL','',...concepts.map(c=>totals.filter(r=>String(r.concept_name)===c).reduce((s,r)=>s+Number(r.total_amount_cents),0)/100),
      totals.filter(r=>Number(r.fortnight)===q1).reduce((s,r)=>s+Number(r.total_amount_cents),0)/100,
      totals.filter(r=>Number(r.fortnight)===q2).reduce((s,r)=>s+Number(r.total_amount_cents),0)/100,rec.total_amount_cents/100]);
    totalRow.font={ bold:true,color:{ argb:'FFFFFFFF' } }; totalRow.fill={ type:'pattern',pattern:'solid',fgColor:{ argb:RED } };
    for(let c=3;c<=headers.length;c+=1)totalRow.getCell(c).numFmt=MONEY;
    sheet.autoFilter={ from:{ row:start,column:1 },to:{ row:start,column:headers.length } }; sheet.getColumn(1).width=18; sheet.getColumn(2).width=34;
    for(let c=3;c<=headers.length;c+=1)sheet.getColumn(c).width=19;
  }

  private addPayroll(workbook:ExcelJS.Workbook,rec:ReconciliationRow,batches:DataRow[],totals:DataRow[]):void{
    const sheet=workbook.addWorksheet('Por nómina',{ views:[{ state:'frozen',ySplit:4,showGridLines:false }] }); const headers=['Quincena','Tipo de nómina','Versión','Archivo','Registros','Excluidos','Inválidos','Suma','Reintegros','Total neto'];
    title(sheet,'Totales por archivo y tipo de nómina',`${rec.year} · Mes ${String(rec.month).padStart(2,'0')}`,headers.length); sheet.getRow(4).values=headers; header(sheet.getRow(4),headers.length);
    for(const batch of batches){ const own=totals.filter(r=>Number(r.batch_id)===Number(batch.id)); const plus=own.filter(r=>Number(r.operation_factor)===1).reduce((s,r)=>s+Number(r.total_amount_cents),0);
      const minus=Math.abs(own.filter(r=>Number(r.operation_factor)===-1).reduce((s,r)=>s+Number(r.total_amount_cents),0)); const row=sheet.addRow([`Q${String(batch.fortnight).padStart(2,'0')}`,
        batch.payroll_type_name,batch.version,batch.original_filename,batch.valid_lines,batch.excluded_lines,batch.invalid_lines,plus/100,minus/100,Number(batch.total_amount_cents)/100]);
      [8,9,10].forEach(c=>row.getCell(c).numFmt=MONEY); borders(row,headers.length); }
    sheet.autoFilter={ from:'A4',to:'J4' }; [12,24,10,48,14,14,14,18,18,18].forEach((w,i)=>sheet.getColumn(i+1).width=w);
  }

  private addGrouped(workbook:ExcelJS.Workbook,rec:ReconciliationRow,totals:DataRow[]):void{
    const sheet=workbook.addWorksheet('Desglose agrupado',{ views:[{ state:'frozen',ySplit:4,showGridLines:false }] }); const headers=['Quincena','Tipo','Fuente','Cuenta contable','Concepto','Operación','Registros','Importe original','Contribución neta'];
    title(sheet,'Desglose agrupado','Base auditable del resumen mensual',headers.length); sheet.getRow(4).values=headers; header(sheet.getRow(4),headers.length);
    for(const item of totals){ const row=sheet.addRow([`Q${String(item.fortnight).padStart(2,'0')}`,item.payroll_type_name,item.source_key,item.account_code,item.concept_name,
      Number(item.operation_factor)===-1?'RESTA':'SUMA',item.record_count,Number(item.original_amount_cents)/100,Number(item.total_amount_cents)/100]);
      row.getCell(8).numFmt=MONEY; row.getCell(9).numFmt=MONEY; borders(row,headers.length); }
    sheet.autoFilter={ from:'A4',to:'I4' }; [12,24,18,34,34,12,14,20,20].forEach((w,i)=>sheet.getColumn(i+1).width=w);
  }

  private addControl(workbook:ExcelJS.Workbook,rec:ReconciliationRow,batches:DataRow[],computed:number):void{
    const sheet=workbook.addWorksheet('Control',{ views:[{ state:'frozen',ySplit:8,showGridLines:false }] }); const headers=['Quincena','Tipo','Versión','Archivo','Hash SHA-256','Líneas','Válidas','Excluidas','Inválidas','Total','Procesado'];
    title(sheet,'Control de archivos activos',`Conciliación: ${(rec.total_amount_cents-computed)/100} · debe ser $0.00`,headers.length);
    [['Año',rec.year],['Mes',rec.month],['Grupo',rec.group_name],['Revisión',rec.revision],['Diferencia de control',(rec.total_amount_cents-computed)/100]].forEach((v,i)=>{ sheet.getCell(4+i,1).value=v[0];
      sheet.getCell(4+i,1).font={ bold:true }; sheet.getCell(4+i,2).value=v[1]; if(i===4)sheet.getCell(8,2).numFmt=MONEY; });
    sheet.getRow(10).values=headers; header(sheet.getRow(10),headers.length);
    for(const b of batches){ const row=sheet.addRow([`Q${String(b.fortnight).padStart(2,'0')}`,b.payroll_type_name,b.version,b.original_filename,b.file_hash_sha256,
      b.total_lines,b.valid_lines,b.excluded_lines,b.invalid_lines,Number(b.total_amount_cents)/100,b.completed_at?new Date(String(b.completed_at)):null]); row.getCell(10).numFmt=MONEY; row.getCell(11).numFmt='yyyy-mm-dd hh:mm'; borders(row,headers.length); }
    sheet.autoFilter={ from:'A10',to:'K10' }; [12,24,10,48,68,12,12,12,12,18,22].forEach((w,i)=>sheet.getColumn(i+1).width=w);
  }

  private addRetained(workbook:ExcelJS.Workbook,rec:ReconciliationRow,reconciliationId:number):void{
    const sheet=workbook.addWorksheet('Retenidos',{ views:[{ state:'frozen',ySplit:4,showGridLines:false }] }); const headers=['Quincena','Tipo','Archivo','Empleado','Nombre','Encontrados','Excluidos','Resultado'];
    title(sheet,'Empleados retenidos','Lista aplicada de forma independiente por TXT',headers.length); sheet.getRow(4).values=headers; header(sheet.getRow(4),headers.length);
    const rows=this.database.prepare(`SELECT pb.fortnight,pt.name payroll_type,pb.original_filename,r.* FROM batch_retained_employees r JOIN payroll_batches pb ON pb.id=r.batch_id
      JOIN payroll_types pt ON pt.id=pb.payroll_type_id WHERE pb.reconciliation_id=? AND pb.is_active=1 ORDER BY pb.fortnight,pt.name,r.employee_number`).all(reconciliationId) as DataRow[];
    for(const item of rows){ const row=sheet.addRow([`Q${String(item.fortnight).padStart(2,'0')}`,item.payroll_type,item.original_filename,item.employee_number,item.employee_name??'',item.found_records,item.excluded_records,
      Number(item.found_records)?'Encontrado':'No encontrado']); borders(row,headers.length); }
    if(!rows.length)sheet.addRow(['','','','','No se capturaron empleados retenidos.']); sheet.autoFilter={ from:'A4',to:'H4' };
    [12,24,46,18,38,14,14,20].forEach((w,i)=>sheet.getColumn(i+1).width=w);
  }
}
