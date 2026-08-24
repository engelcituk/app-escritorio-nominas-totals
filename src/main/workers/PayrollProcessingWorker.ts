import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import type { ProcessingStage } from '../../shared/enums/payroll.js';
import { BatchStatus, ProcessingStage as Stage, RecordStatus } from '../../shared/enums/payroll.js';
import { UNIFORM_PAYROLL_LAYOUT } from '../../shared/payroll-layouts/uniformPayrollLayout.js';
import type { ProcessingProgress } from '../../shared/types/payroll.js';
import { DatabaseService } from '../database/DatabaseService.js';
import { ACTIVE_CONCEPT_MATCHERS_SQL, ConceptMatcher, type ConceptMatchRule } from '../services/ConceptMatcher.js';
import { calculateFileSha256 } from '../services/FileHashService.js';
import { PayrollRecordEvaluator } from '../services/PayrollRecordEvaluator.js';
import { RetainedTotalsService, type RetainedTotalInput } from '../services/RetainedTotalsService.js';
import { TotalsService, type BatchTotalInput } from '../services/TotalsService.js';
import { TxtStreamParser } from '../services/TxtStreamParser.js';

interface WorkerPayload {
  processId: string; reconciliationId: number; sourceOrder: number; databasePath: string; filePath: string; year: number; month: number;
  fortnight: number; payrollTypeId: number; selectedConceptIds: number[]; retainedEmployeeNumbers: string[];
  missingAcknowledged: boolean; replaceActiveBatch: boolean;
}
interface Counters { total: number; valid: number; excluded: number; invalid: number; unclassified: number; matched: number }

const payload = workerData as WorkerPayload;
const port = parentPort!;
if (!port) throw new Error('El procesador no pudo iniciar su canal de comunicación.');
let cancelled = false;
port.on('message', (message: { type: string }) => { if (message.type === 'cancel') cancelled = true; });

function emitProgress(stage: ProcessingStage, counters: Counters, totalBytes: number, started: number, bytesProcessed: number): void {
  const progress: ProcessingProgress = { processId: payload.processId, stage, bytesProcessed: Math.min(bytesProcessed, totalBytes), totalBytes,
    percentage: totalBytes ? Math.min(100, Math.round((bytesProcessed / totalBytes) * 10000) / 100) : 0,
    linesProcessed: counters.total, validRecords: counters.valid, excludedRecords: counters.excluded,
    invalidRecords: counters.invalid, matchedRecords: counters.matched, elapsedMilliseconds: Date.now() - started };
  port.postMessage({ type: 'progress', progress });
}

async function run(): Promise<void> {
  const service = new DatabaseService(payload.databasePath); const db = service.connection;
  const totalBytes = statSync(payload.filePath).size; const started = Date.now();
  const counters: Counters = { total: 0, valid: 0, excluded: 0, invalid: 0, unclassified: 0, matched: 0 };
  const totalsByGroup = new Map<string, BatchTotalInput>();
  const retainedTotalsByGroup = new Map<string, RetainedTotalInput>();
  const retainedStats = new Map<string, { name: string; found: number; excluded: number }>();
  const retainedSet = new Set(payload.retainedEmployeeNumbers); const selected = new Set(payload.selectedConceptIds);
  let recordsTotal = 0; let batchId: number | null = null; let bytesProcessed = 0;
  try {
    emitProgress(Stage.VALIDATING, counters, totalBytes, started, 0);
    const fileHash = await calculateFileSha256(payload.filePath);
    if (db.prepare(`SELECT id FROM payroll_batches WHERE reconciliation_id=? AND file_hash_sha256=? AND is_active=1`)
      .get(payload.reconciliationId, fileHash)) throw new Error('DUPLICATE_ACTIVE');
    const current = db.prepare(`SELECT id,version FROM payroll_batches WHERE reconciliation_id=? AND fortnight=?
      AND payroll_type_id=? AND is_active=1`).get(payload.reconciliationId, payload.fortnight, payload.payrollTypeId) as
      { id: number; version: number } | undefined;
    if (current && !payload.replaceActiveBatch) throw new Error(`REPLACEMENT_REQUIRED:${current.id}`);

    const now = new Date().toISOString();
    const inserted = db.prepare(`INSERT INTO payroll_batches(reconciliation_id,source_order,year,month,fortnight,payroll_type_id,
      layout_code,layout_version,original_filename,original_file_path,file_size,file_hash_sha256,version,status,is_active,replaced_batch_id,
      started_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'PROCESSING',0,?,?,?,?)`).run(
      payload.reconciliationId, payload.sourceOrder, payload.year, payload.month, payload.fortnight, payload.payrollTypeId,
      UNIFORM_PAYROLL_LAYOUT.code, UNIFORM_PAYROLL_LAYOUT.version, basename(payload.filePath), payload.filePath, totalBytes, fileHash,
      current ? current.version + 1 : 1, current?.id ?? null, now, now, now);
    batchId = Number(inserted.lastInsertRowid);

    const rules = db.prepare(ACTIVE_CONCEPT_MATCHERS_SQL).all() as ConceptMatchRule[];
    const concepts = db.prepare(`SELECT c.id, c.code, c.name, c.operation_factor, g.code AS group_code, g.name AS group_name
      FROM payroll_concepts c LEFT JOIN concept_groups g ON g.id = c.group_id WHERE c.active = 1`).all() as
      Array<{ id: number; code: string; name: string; operation_factor: number; group_code: string | null; group_name: string | null }>;
    const saveConcept = db.prepare(`INSERT INTO batch_concept_snapshots(batch_id, source_concept_id, concept_code, concept_name,
      group_code, group_name, operation_factor, selected, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const saveAlias = db.prepare(`INSERT INTO batch_alias_snapshots(batch_id, source_alias_id, source_concept_id, source_description,
      normalized_description, created_at) SELECT ?, id, concept_id, source_description, normalized_description, ?
      FROM concept_aliases WHERE active = 1`);
    const saveRetained = db.prepare(`INSERT INTO batch_retained_employees(batch_id, employee_number, missing_acknowledged, created_at)
      VALUES (?, ?, ?, ?)`);
    db.transaction(() => {
      for (const concept of concepts) saveConcept.run(batchId, concept.id, concept.code, concept.name, concept.group_code,
        concept.group_name, concept.operation_factor, selected.has(concept.id) ? 1 : 0, now);
      saveAlias.run(batchId, now);
      for (const employee of retainedSet) saveRetained.run(batchId, employee, payload.missingAcknowledged ? 1 : 0, now);
    })();

    const evaluator = new PayrollRecordEvaluator(new ConceptMatcher(rules), selected, retainedSet);
    let lastProgress = 0; emitProgress(Stage.READING, counters, totalBytes, started, 0);
    for await (const item of new TxtStreamParser().parse(payload.filePath, () => cancelled)) {
      counters.total += 1; bytesProcessed += Buffer.byteLength(item.rawLine, 'utf8') + 1;
      if (!item.record) counters.invalid += 1;
      else {
        const evaluation = evaluator.evaluate(item.record);
        if (evaluation.classification.matched) counters.matched += 1;
        if (retainedSet.has(item.record.employeeNumber)) {
          const stat = retainedStats.get(item.record.employeeNumber) ?? { name: item.record.employeeName, found: 0, excluded: 0 };
          stat.name ||= item.record.employeeName; stat.found += 1;
          if (evaluation.exclusionCategory === 'RETAINED') stat.excluded += 1; retainedStats.set(item.record.employeeNumber, stat);
          const retained:RetainedTotalInput={ employeeNumber:item.record.employeeNumber,employeeName:item.record.employeeName,
            sourcePayrollCode:item.record.conceptCode,conceptName:evaluation.classification.conceptName??item.record.conceptDescriptionOriginal.trim(),
            sourceKey:item.record.sourceKey,accountCode:item.record.accountCode,movementType:item.record.movementType,recordCount:1,
            amountCents:evaluation.amountCents??0 };
          const retainedKey=JSON.stringify([retained.employeeNumber,retained.sourcePayrollCode,retained.conceptName,retained.sourceKey,
            retained.accountCode,retained.movementType]); const accumulatedRetained=retainedTotalsByGroup.get(retainedKey);
          if(accumulatedRetained){accumulatedRetained.recordCount+=1;accumulatedRetained.amountCents+=retained.amountCents;}
          else retainedTotalsByGroup.set(retainedKey,retained);
        }
        switch (evaluation.status) {
          case RecordStatus.INVALID: counters.invalid += 1; break;
          case RecordStatus.UNCLASSIFIED: counters.unclassified += 1; break;
          case RecordStatus.EXCLUDED: counters.excluded += 1; break;
          case RecordStatus.VALID: {
            counters.valid += 1; const original = evaluation.amountCents ?? 0; const applied = evaluation.appliedAmountCents ?? 0;
            recordsTotal += applied;
            const total: BatchTotalInput = { sourceConceptId: evaluation.classification.conceptId!,
              conceptCode: evaluation.classification.conceptCode!, conceptName: evaluation.classification.conceptName!,
              groupCode: evaluation.classification.groupCode ?? null, groupName: evaluation.classification.groupName ?? null,
              sourcePayrollCode: item.record.conceptCode, sourceDescription: evaluation.classification.normalized, sourceKey: item.record.sourceKey,
              accountCode: item.record.accountCode, movementType: item.record.movementType,
              operationFactor: evaluation.classification.operationFactor ?? 1, recordCount: 1,
              originalAmountCents: original, totalAmountCents: applied };
            const key = JSON.stringify([total.sourceConceptId,total.sourcePayrollCode,total.sourceDescription,total.sourceKey,total.accountCode,total.movementType]);
            const accumulated = totalsByGroup.get(key);
            if (accumulated) { accumulated.recordCount += 1; accumulated.originalAmountCents += original; accumulated.totalAmountCents += applied; }
            else totalsByGroup.set(key, total); break;
          }
          default: break;
        }
      }
      if (Date.now() - lastProgress >= 250) { emitProgress(Stage.CLASSIFYING, counters, totalBytes, started, bytesProcessed); lastProgress = Date.now(); }
    }
    if (cancelled) { db.prepare(`UPDATE payroll_batches SET status='CANCELLED', total_lines=?, updated_at=? WHERE id=?`)
      .run(counters.total, new Date().toISOString(), batchId); port.postMessage({ type: 'cancelled', processId: payload.processId, batchId }); return; }

    emitProgress(Stage.CALCULATING, counters, totalBytes, started, totalBytes);
    const totals = new TotalsService(db).persist(batchId, totalsByGroup.values(), recordsTotal);
    new RetainedTotalsService(db).persist(batchId,retainedTotalsByGroup.values());
    const status = totals.difference === 0 ? BatchStatus.PROCESSING : BatchStatus.FAILED_RECONCILIATION;
    db.prepare(`UPDATE payroll_batches SET status=?, total_lines=?, valid_lines=?, excluded_lines=?, invalid_lines=?, unclassified_lines=?,
      matching_lines=?, total_amount_cents=?, updated_at=? WHERE id=?`).run(status, counters.total, counters.valid, counters.excluded,
      counters.invalid, counters.unclassified, counters.matched, totals.recordsTotal, new Date().toISOString(), batchId);
    const updateRetained = db.prepare(`UPDATE batch_retained_employees SET employee_name=COALESCE(NULLIF(?,''),employee_name),
      found_records=?, excluded_records=? WHERE batch_id=? AND employee_number=?`);
    for (const [employee, stat] of retainedStats) updateRetained.run(stat.name, stat.found, stat.excluded, batchId, employee);
    port.postMessage({ type: 'processed', processId: payload.processId, batchId, counters, totalAmountCents: totals.recordsTotal, difference: totals.difference, fileHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo procesar el archivo.';
    if (batchId !== null) db.prepare(`UPDATE payroll_batches SET status='FAILED', updated_at=? WHERE id=?`).run(new Date().toISOString(), batchId);
    port.postMessage({ type: 'error', processId: payload.processId, batchId, message });
  } finally { service.close(); port.close(); }
}

void run();
