import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import type { BrowserWindow } from 'electron';
import { BatchStatus } from '../../shared/enums/payroll.js';
import type { MonthlyReconciliationResult, ProcessMonthlyImportRequest, ProcessingProgress } from '../../shared/types/payroll.js';
import { DatabaseService } from '../database/DatabaseService.js';
import { ExcelReportBuilder } from './ExcelReportBuilder.js';
import { MonthlyReportBuilder } from './MonthlyReportBuilder.js';

interface GroupPaths { files:Array<{ filePath:string;name:string }>; outputDirectory:string }
interface WorkerResult { batchId:number;counters:Record<string,number>;totalAmountCents:number }

export class ProcessingService {
  private readonly workers=new Map<string,Worker>(); private readonly cancelled=new Set<string>();
  constructor(private readonly databasePath:string,private readonly getWindow:()=>BrowserWindow|null){}

  start(request:ProcessMonthlyImportRequest,paths:GroupPaths):string{
    const processId=randomUUID(); const reconciliationId=this.getOrCreateReconciliation(request); void this.run(processId,reconciliationId,request,paths); return processId;
  }
  cancel(processId:string):boolean{ if(!this.workers.has(processId)&&!this.cancelled.has(processId))return false; this.cancelled.add(processId);
    this.workers.get(processId)?.postMessage({ type:'cancel' }); return true; }
  hasActiveProcesses():boolean{return this.workers.size>0;}

  private getOrCreateReconciliation(request:ProcessMonthlyImportRequest):number{
    const service=new DatabaseService(this.databasePath); try{
      const group=service.connection.prepare('SELECT id,active FROM concept_groups WHERE id=?').get(request.conceptGroupId) as { id:number;active:number }|undefined;
      if(!group||!group.active)throw new Error('El grupo de conceptos seleccionado no está disponible.');
      const existing=service.connection.prepare(`SELECT id FROM monthly_reconciliations WHERE year=? AND month=? AND concept_group_id=?`)
        .get(request.year,request.month,request.conceptGroupId) as { id:number }|undefined;
      if(request.reconciliationId&&existing?.id!==request.reconciliationId)throw new Error('El expediente mensual no corresponde al periodo seleccionado.');
      if(existing)return existing.id; const now=new Date().toISOString(); const id=Number(service.connection.prepare(`INSERT INTO monthly_reconciliations
        (year,month,concept_group_id,status,started_at,created_at,updated_at) VALUES (?,?,?,'DRAFT',?,?,?)`)
        .run(request.year,request.month,request.conceptGroupId,now,now,now).lastInsertRowid);
      this.audit(service,'CREATE',id,'Se creó el expediente mensual.',{ year:request.year,month:request.month,conceptGroupId:request.conceptGroupId }); return id;
    }finally{service.close();}
  }

  private async run(processId:string,reconciliationId:number,request:ProcessMonthlyImportRequest,paths:GroupPaths):Promise<void>{
    const totalBytes=paths.files.reduce((sum,file)=>sum+statSync(file.filePath).size,0); let completedBytes=0; const completed={ lines:0,valid:0,excluded:0,invalid:0,matched:0 };
    const batchIds:number[]=[]; let monthlyReport='';
    try{
      for(let index=0;index<request.files.length;index+=1){ if(this.cancelled.has(processId))throw new Error('PROCESS_CANCELLED');
        const file=request.files[index]!; const source=paths.files[index]!;
        const result=await this.runWorker(processId,{ processId,reconciliationId,sourceOrder:this.nextSourceOrder(reconciliationId),databasePath:this.databasePath,
          filePath:source.filePath,year:request.year,month:request.month,fortnight:file.fortnight,payrollTypeId:file.payrollTypeId,
          selectedConceptIds:file.selectedConceptIds,retainedEmployeeNumbers:file.retainedEmployeeNumbers,missingAcknowledged:file.missingAcknowledged,
          replaceActiveBatch:file.replaceActiveBatch },(progress)=>{ const size=statSync(source.filePath).size; const aggregate:ProcessingProgress={ ...progress,reconciliationId,
            activeFileIndex:index+1,totalFiles:request.files.length,activeFilename:source.name,totalBytes,bytesProcessed:completedBytes+Math.min(progress.bytesProcessed,size),
            percentage:totalBytes?Math.round(((completedBytes+Math.min(progress.bytesProcessed,size))/totalBytes)*10000)/100:0,
            linesProcessed:completed.lines+progress.linesProcessed,validRecords:completed.valid+progress.validRecords,
            excludedRecords:completed.excluded+progress.excludedRecords,invalidRecords:completed.invalid+progress.invalidRecords,matchedRecords:completed.matched+progress.matchedRecords };
          this.getWindow()?.webContents.send('payroll:progress',aggregate); });
        const service=new DatabaseService(this.databasePath); let previousId:number|null=null;
        try{
          const batch=service.connection.prepare('SELECT * FROM payroll_batches WHERE id=?').get(result.batchId) as Record<string,number|null>;
          await new ExcelReportBuilder(service.connection,paths.outputDirectory).build(result.batchId,source.filePath);
          previousId=Number(batch.replaced_batch_id??0)||null; const now=new Date().toISOString(); service.connection.transaction(()=>{
            if(previousId)service.connection.prepare(`UPDATE payroll_batches SET is_active=0,status='SUPERSEDED',updated_at=? WHERE id=?`).run(now,previousId);
            service.connection.prepare(`UPDATE payroll_batches SET is_active=1,status='COMPLETED',completed_at=?,updated_at=? WHERE id=?`).run(now,now,result.batchId);
            this.refresh(service,reconciliationId,true); })();
          try{ monthlyReport=await new MonthlyReportBuilder(service.connection,paths.outputDirectory).build(reconciliationId); }
          catch(error){ service.connection.transaction(()=>{ service.connection.prepare(`UPDATE payroll_batches SET is_active=0,status='FAILED',updated_at=? WHERE id=?`)
              .run(new Date().toISOString(),result.batchId); if(previousId)service.connection.prepare(`UPDATE payroll_batches SET is_active=1,status='COMPLETED',updated_at=? WHERE id=?`)
              .run(new Date().toISOString(),previousId); this.refresh(service,reconciliationId,false); })(); throw error; }
          this.audit(service,'IMPORT',reconciliationId,'Se actualizó el expediente mensual.',{ batchId:result.batchId,replacedBatchId:previousId });
        }catch(error){ const candidate=service.connection.prepare('SELECT is_active FROM payroll_batches WHERE id=?').get(result.batchId) as { is_active:number }|undefined;
          if(candidate&&!candidate.is_active)service.connection.prepare(`UPDATE payroll_batches SET status='FAILED',updated_at=? WHERE id=?`)
            .run(new Date().toISOString(),result.batchId); throw error;
        }finally{service.close();}
        batchIds.push(result.batchId); completed.lines+=Number(result.counters.total??0); completed.valid+=Number(result.counters.valid??0);
        completed.excluded+=Number(result.counters.excluded??0); completed.invalid+=Number(result.counters.invalid??0); completed.matched+=Number(result.counters.matched??0);
        completedBytes+=statSync(source.filePath).size;
      }
      const service=new DatabaseService(this.databasePath); let rec:Record<string,number>; try{ this.refresh(service,reconciliationId,false);
        rec=service.connection.prepare('SELECT * FROM monthly_reconciliations WHERE id=?').get(reconciliationId) as Record<string,number>;
      }finally{service.close();}
      const result:MonthlyReconciliationResult={ processId,reconciliationId,batchIds,batchId:batchIds.at(-1)??0,status:BatchStatus.COMPLETED,
        totalAmountCents:Number(rec!.total_amount_cents),totalLines:Number(rec!.total_lines),validLines:Number(rec!.valid_lines),
        excludedLines:Number(rec!.excluded_lines),invalidLines:Number(rec!.invalid_lines),monthlyReport };
      this.getWindow()?.webContents.send('payroll:completed',result);
    }catch(error){ const message=this.friendly(error instanceof Error?error.message:'No se pudo actualizar el expediente mensual.');
      this.getWindow()?.webContents.send('payroll:failed',{ processId,reconciliationId,batchId:batchIds.at(-1)??null,message });
    }finally{this.workers.delete(processId);this.cancelled.delete(processId);}
  }

  private nextSourceOrder(reconciliationId:number):number{ const service=new DatabaseService(this.databasePath); try{return Number((service.connection.prepare(
    'SELECT COALESCE(MAX(source_order),0)+1 value FROM payroll_batches WHERE reconciliation_id=?').get(reconciliationId) as { value:number }).value);}finally{service.close();}}

  private refresh(service:DatabaseService,reconciliationId:number,incrementRevision:boolean):void{
    const t=service.connection.prepare(`SELECT COUNT(*) files,COALESCE(SUM(total_lines),0) lines,COALESCE(SUM(valid_lines),0) valid,
      COALESCE(SUM(excluded_lines),0) excluded,COALESCE(SUM(invalid_lines),0) invalid,COALESCE(SUM(total_amount_cents),0) total
      FROM payroll_batches WHERE reconciliation_id=? AND is_active=1 AND status='COMPLETED'`).get(reconciliationId) as Record<string,number>;
    const now=new Date().toISOString(); service.connection.prepare(`UPDATE monthly_reconciliations SET status=?,revision=revision+?,file_count=?,completed_files=?,
      total_lines=?,valid_lines=?,excluded_lines=?,invalid_lines=?,total_amount_cents=?,completed_at=?,updated_at=? WHERE id=?`).run(t.files?'COMPLETED':'DRAFT',
      incrementRevision?1:0,t.files,t.files,t.lines,t.valid,t.excluded,t.invalid,t.total,t.files?now:null,now,reconciliationId);
  }

  private runWorker(processId:string,data:Record<string,unknown>,onProgress:(value:ProcessingProgress)=>void):Promise<WorkerResult>{
    return new Promise((resolve,reject)=>{ const worker=new Worker(new URL('../workers/PayrollProcessingWorker.js',import.meta.url),{ workerData:data }); this.workers.set(processId,worker);
      worker.on('message',(message:Record<string,unknown>)=>{ if(message.type==='progress')onProgress(message.progress as ProcessingProgress);
        else if(message.type==='processed')resolve(message as unknown as WorkerResult); else if(message.type==='cancelled')reject(new Error('PROCESS_CANCELLED'));
        else if(message.type==='error')reject(new Error(String(message.message))); }); worker.on('error',reject);
      worker.on('exit',(code)=>{if(code!==0)reject(new Error(`El procesador terminó con código ${code}.`));}); });
  }

  private audit(service:DatabaseService,action:string,id:number,description:string,metadata?:Record<string,unknown>):void{
    service.connection.prepare(`INSERT INTO audit_logs(action,entity_type,entity_id,description,metadata_json,created_at) VALUES (?,'MONTHLY_RECONCILIATION',?,?,?,?)`)
      .run(action,String(id),description,metadata?JSON.stringify(metadata):null,new Date().toISOString());
  }
  private friendly(message:string):string{ if(message==='DUPLICATE_ACTIVE')return 'Este archivo ya es la versión activa del expediente.';
    if(message.startsWith('REPLACEMENT_REQUIRED:'))return 'Ya existe un archivo activo para esa quincena y tipo. Confirma el reemplazo.';
    if(message==='PROCESS_CANCELLED')return 'El procesamiento fue cancelado.'; if(message.includes('SQLITE_BUSY'))return 'La base está ocupada. Intenta nuevamente.'; return message; }
}
