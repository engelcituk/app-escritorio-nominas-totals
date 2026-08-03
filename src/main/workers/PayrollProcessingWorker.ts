import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import type { PayrollType, ProcessingStage } from '../../shared/enums/payroll.js';
import { BatchStatus, ProcessingStage as Stage, RecordStatus } from '../../shared/enums/payroll.js';
import { UNIFORM_PAYROLL_LAYOUT } from '../../shared/payroll-layouts/uniformPayrollLayout.js';
import type { ExclusionOptions, ProcessingProgress } from '../../shared/types/payroll.js';
import { parseAmountToCents } from '../../shared/utils/money.js';
import { DatabaseService } from '../database/DatabaseService.js';
import { ConceptRuleEngine, type ConceptRule } from '../services/ConceptRuleEngine.js';
import { ExclusionRuleEngine, type ExclusionRule } from '../services/ExclusionRuleEngine.js';
import { calculateFileSha256 } from '../services/FileHashService.js';
import { TotalsService } from '../services/TotalsService.js';
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
  port!.postMessage({ type: 'progress', progress });
}

interface Counters { total: number; valid: number; excluded: number; invalid: number; unclassified: number; matched: number }

async function run(): Promise<void> {
  const databaseService = new DatabaseService(payload.databasePath);
  const db = databaseService.connection;
  const totalBytes = statSync(payload.filePath).size;
  const started = Date.now();
  const counters: Counters = { total: 0, valid: 0, excluded: 0, invalid: 0, unclassified: 0, matched: 0 };
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
    const conceptEngine = new ConceptRuleEngine(conceptRules);
    const exclusionEngine = new ExclusionRuleEngine(exclusionRules);
    const parser = new TxtStreamParser();
    const insertRecord = db.prepare(`INSERT INTO payroll_records(
      batch_id, line_number, component, funding_source, employee_number, employee_name, position_name,
      movement_type, movement_classifier, concept_code, concept_description_original, concept_description_normalized,
      concept_description_canonical, concept_variant, account_code, amount_cents, control_code, final_indicator,
      status, concept_rule_id, exclusion_rule_id, exclusion_category, exclusion_reason, validation_error, raw_line, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    let pending: unknown[][] = [];
    const flush = (): void => {
      if (!pending.length) return;
      const rows = pending;
      pending = [];
      db.transaction(() => { for (const values of rows) insertRecord.run(...values); })();
    };
    let lastProgress = 0;
    emitProgress(Stage.READING, counters, totalBytes, started, 0);
    for await (const item of parser.parse(payload.filePath, () => cancelled)) {
      counters.total += 1;
      bytesProcessed += Buffer.byteLength(item.rawLine, 'utf8') + 1;
      const createdAt = new Date().toISOString();
      if (!item.record) {
        counters.invalid += 1;
        pending.push([batchId, item.lineNumber, null, null, null, null, null, null, null, null, null, null, null, null,
          null, null, null, null, RecordStatus.INVALID, null, null, null, null, item.error ?? 'Línea inválida.',
          payload.exclusions.includeAudit ? item.rawLine : null, createdAt]);
      } else {
        const record = item.record;
        const amountCents = parseAmountToCents(record.amountRaw);
        const classification = conceptEngine.classify(record, payload.payrollType);
        const exclusion = exclusionEngine.evaluate(record, payload.payrollType, payload.exclusions);
        let status: RecordStatus;
        let validationError: string | null = null;
        if (amountCents === null || !record.conceptCode || !record.accountCode || !record.movementType) {
          status = RecordStatus.INVALID;
          counters.invalid += 1;
          validationError = amountCents === null ? 'El importe no es válido.' : 'Falta un campo obligatorio.';
        } else if (exclusion.excluded) {
          status = RecordStatus.EXCLUDED;
          counters.excluded += 1;
        } else if (!classification.matched) {
          status = RecordStatus.UNCLASSIFIED;
          counters.unclassified += 1;
        } else {
          status = RecordStatus.VALID;
          counters.valid += 1;
          counters.matched += 1;
        }
        pending.push([batchId, record.lineNumber, record.component, record.fundingSource, record.employeeNumber,
          record.employeeName, record.positionName, record.movementType, record.movementClassifier, record.conceptCode,
          record.conceptDescriptionOriginal, classification.normalized, classification.canonical, classification.variant ?? null,
          record.accountCode, amountCents, record.controlCode, record.finalIndicator, status, classification.ruleId ?? null,
          exclusion.ruleId ?? null, exclusion.category ?? null, exclusion.reason ?? null, validationError,
          payload.exclusions.includeAudit ? item.rawLine : null, createdAt]);
      }
      if (pending.length >= 1000) flush();
      if (Date.now() - lastProgress >= 250) {
        emitProgress(Stage.SAVING, counters, totalBytes, started, bytesProcessed);
        lastProgress = Date.now();
      }
    }
    flush();

    if (cancelled) {
      db.transaction(() => {
        db.prepare('DELETE FROM payroll_records WHERE batch_id = ?').run(batchId);
        db.prepare(`UPDATE payroll_batches SET status = 'CANCELLED', total_lines = ?, updated_at = ? WHERE id = ?`)
          .run(counters.total, new Date().toISOString(), batchId);
      })();
      port.postMessage({ type: 'cancelled', processId: payload.processId, batchId });
      return;
    }

    emitProgress(Stage.CALCULATING, counters, totalBytes, started, totalBytes);
    const totals = new TotalsService(db).calculate(batchId);
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
