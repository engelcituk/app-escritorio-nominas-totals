import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import type { PayrollType, ProcessingStage } from '../../shared/enums/payroll.js';
import { BatchStatus, ProcessingStage as Stage, RecordStatus } from '../../shared/enums/payroll.js';
import { UNIFORM_PAYROLL_LAYOUT } from '../../shared/payroll-layouts/uniformPayrollLayout.js';
import type { ExclusionOptions, ProcessingProgress } from '../../shared/types/payroll.js';
import { DatabaseService } from '../database/DatabaseService.js';
import { ConceptRuleEngine, type ConceptRule } from '../services/ConceptRuleEngine.js';
import { ExclusionRuleEngine, type ExclusionRule } from '../services/ExclusionRuleEngine.js';
import { calculateFileSha256 } from '../services/FileHashService.js';
import { PayrollRecordEvaluator } from '../services/PayrollRecordEvaluator.js';
import { TotalsService, type BatchTotalInput } from '../services/TotalsService.js';
import { TxtStreamParser } from '../services/TxtStreamParser.js';

interface WorkerPayload {
  processId: string;
  databasePath: string;
  filePath: string;
  year: number;
  fortnight: number;
  payrollType: PayrollType;
  exclusions: ExclusionOptions;
  duplicateAction?: 'CANCEL' | 'REPLACE' | 'NEW_VERSION';
}

interface Counters { total: number; valid: number; excluded: number; invalid: number; unclassified: number; matched: number }

const payload = workerData as WorkerPayload;
const port = parentPort!;
if (!port) throw new Error('El procesador no pudo iniciar su canal de comunicación.');
let cancelled = false;
port.on('message', (message: { type: string }) => {
  if (message.type === 'cancel') cancelled = true;
});

function emitProgress(stage: ProcessingStage, counters: Counters, totalBytes: number, started: number, bytesProcessed: number): void {
  const progress: ProcessingProgress = {
    processId: payload.processId,
    stage,
    bytesProcessed: Math.min(bytesProcessed, totalBytes),
    totalBytes,
    percentage: totalBytes ? Math.min(100, Math.round((bytesProcessed / totalBytes) * 10000) / 100) : 0,
    linesProcessed: counters.total,
    validRecords: counters.valid,
    excludedRecords: counters.excluded,
    invalidRecords: counters.invalid,
    matchedRecords: counters.matched,
    elapsedMilliseconds: Date.now() - started,
  };
  port.postMessage({ type: 'progress', progress });
}

async function run(): Promise<void> {
  const databaseService = new DatabaseService(payload.databasePath);
  const db = databaseService.connection;
  const totalBytes = statSync(payload.filePath).size;
  const started = Date.now();
  const counters: Counters = { total: 0, valid: 0, excluded: 0, invalid: 0, unclassified: 0, matched: 0 };
  const totalsByGroup = new Map<string, BatchTotalInput>();
  let recordsTotal = 0;
  let batchId: number | null = null;
  let bytesProcessed = 0;

  try {
    emitProgress(Stage.VALIDATING, counters, totalBytes, started, 0);
    const fileHash = await calculateFileSha256(payload.filePath);
    const identical = db.prepare(`SELECT id, year, fortnight, payroll_type, version FROM payroll_batches
      WHERE file_hash_sha256 = ? AND status NOT IN ('FAILED','CANCELLED') ORDER BY id DESC LIMIT 1`).get(fileHash) as
      { id: number; year: number; fortnight: number; payroll_type: string; version: number } | undefined;
    if (identical && !payload.duplicateAction) throw new Error(`DUPLICATE_FILE:${identical.id}`);

    const previous = db.prepare(`SELECT id, version FROM payroll_batches WHERE year = ? AND fortnight = ? AND payroll_type = ?
      AND concept_family_id = 1 AND status NOT IN ('FAILED','CANCELLED','SUPERSEDED') ORDER BY version DESC LIMIT 1`)
      .get(payload.year, payload.fortnight, payload.payrollType) as { id: number; version: number } | undefined;
    if (previous && !payload.duplicateAction) throw new Error(`DUPLICATE_PERIOD:${previous.id}`);
    if (payload.duplicateAction === 'CANCEL' && (identical || previous)) throw new Error('PROCESS_CANCELLED_BY_DUPLICATE');

    const version = previous ? previous.version + 1 : 1;
    const now = new Date().toISOString();
    const inserted = db.prepare(`INSERT INTO payroll_batches(
      year, fortnight, payroll_type, concept_family_id, layout_code, layout_version, original_filename,
      original_file_path, file_size, file_hash_sha256, version, status, replaced_batch_id, started_at, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'PROCESSING', ?, ?, ?, ?)`)
      .run(payload.year, payload.fortnight, payload.payrollType, UNIFORM_PAYROLL_LAYOUT.code, UNIFORM_PAYROLL_LAYOUT.version,
        basename(payload.filePath), payload.filePath, totalBytes, fileHash, version,
        payload.duplicateAction === 'REPLACE' ? (previous?.id ?? null) : null, now, now, now);
    batchId = Number(inserted.lastInsertRowid);
    if (payload.duplicateAction === 'REPLACE' && previous) {
      db.prepare(`UPDATE payroll_batches SET status = 'SUPERSEDED', updated_at = ? WHERE id = ?`).run(now, previous.id);
    }

    const conceptRules = db.prepare(`SELECT * FROM concept_rules WHERE concept_family_id = 1 AND active = 1 ORDER BY priority`).all() as ConceptRule[];
    const exclusionRules = db.prepare(`SELECT * FROM exclusion_rules WHERE active = 1 ORDER BY priority`).all() as ExclusionRule[];
    const evaluator = new PayrollRecordEvaluator(new ConceptRuleEngine(conceptRules), new ExclusionRuleEngine(exclusionRules),
      payload.payrollType, payload.exclusions);
    const parser = new TxtStreamParser();
    let lastProgress = 0;
    emitProgress(Stage.READING, counters, totalBytes, started, 0);

    for await (const item of parser.parse(payload.filePath, () => cancelled)) {
      counters.total += 1;
      bytesProcessed += Buffer.byteLength(item.rawLine, 'utf8') + 1;
      if (!item.record) {
        counters.invalid += 1;
      } else {
        const evaluation = evaluator.evaluate(item.record);
        switch (evaluation.status) {
          case RecordStatus.INVALID: counters.invalid += 1; break;
          case RecordStatus.UNCLASSIFIED: counters.unclassified += 1; break;
          case RecordStatus.EXCLUDED: counters.excluded += 1; break;
          case RecordStatus.VALID: {
            counters.valid += 1;
            counters.matched += 1;
            const amountCents = evaluation.amountCents ?? 0;
            recordsTotal += amountCents;
            const total: BatchTotalInput = {
              conceptVariant: evaluation.classification.variant ?? null,
              conceptCode: item.record.conceptCode,
              conceptDescription: evaluation.classification.canonical,
              accountCode: item.record.accountCode,
              movementType: item.record.movementType,
              recordCount: 1,
              totalAmountCents: amountCents,
            };
            const key = JSON.stringify([total.conceptVariant, total.conceptCode, total.conceptDescription, total.accountCode, total.movementType]);
            const accumulated = totalsByGroup.get(key);
            if (accumulated) {
              accumulated.recordCount += 1;
              accumulated.totalAmountCents += amountCents;
            } else {
              totalsByGroup.set(key, total);
            }
            break;
          }
          default: break;
        }
      }
      if (Date.now() - lastProgress >= 250) {
        emitProgress(Stage.CLASSIFYING, counters, totalBytes, started, bytesProcessed);
        lastProgress = Date.now();
      }
    }

    if (cancelled) {
      db.prepare(`UPDATE payroll_batches SET status = 'CANCELLED', total_lines = ?, updated_at = ? WHERE id = ?`)
        .run(counters.total, new Date().toISOString(), batchId);
      port.postMessage({ type: 'cancelled', processId: payload.processId, batchId });
      return;
    }

    emitProgress(Stage.CALCULATING, counters, totalBytes, started, totalBytes);
    const totals = new TotalsService(db).persist(batchId, totalsByGroup.values(), recordsTotal);
    const status = totals.difference === 0 ? BatchStatus.PROCESSING : BatchStatus.FAILED_RECONCILIATION;
    db.prepare(`UPDATE payroll_batches SET status = ?, total_lines = ?, valid_lines = ?, excluded_lines = ?, invalid_lines = ?,
      unclassified_lines = ?, matching_lines = ?, total_amount_cents = ?, updated_at = ? WHERE id = ?`)
      .run(status, counters.total, counters.valid, counters.excluded, counters.invalid, counters.unclassified, counters.matched,
        totals.recordsTotal, new Date().toISOString(), batchId);
    port.postMessage({ type: 'processed', processId: payload.processId, batchId, counters, totalAmountCents: totals.recordsTotal,
      difference: totals.difference, fileHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo procesar el archivo.';
    if (batchId !== null) {
      db.prepare(`UPDATE payroll_batches SET status = 'FAILED', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), batchId);
    }
    port.postMessage({ type: 'error', processId: payload.processId, batchId, message });
  } finally {
    databaseService.close();
    port.close();
  }
}

void run();
