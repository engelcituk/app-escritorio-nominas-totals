import { describe, expect, it } from 'vitest';
import { canonicalPayload, operationResponseSchema } from '../../src/main/services/central/syncContracts.js';
import { retryDelay } from '../../src/main/services/central/SyncOrchestrator.js';
import { syncOperationSchema, syncQuerySchema } from '../../src/shared/schemas/sync.js';
import { reportPayloadSchema, filenameSchema, reconciliationPayloadSchema } from '../../src/main/services/central/resultContracts.js';

describe('outbox: contenido e idempotencia', () => {
  it('limita reportes al contrato y prohíbe rutas, IDs locales y dueños ambiguos', () => {
    const report = { reportType: 'SOURCE', payrollBatchUuid: '11111111-1111-4111-8111-111111111111', originalFilename: 'Reporte.xlsx',
      sizeBytes: 1234, sha256: 'a'.repeat(64), generatedAt: '2026-08-26T12:00:00Z' };
    expect(reportPayloadSchema.safeParse(report).success).toBe(true);
    for (const patch of [{ sizeBytes: 0 }, { sizeBytes: 104857601 }, { originalFilename: '../report.xlsx' }, { filePath: 'C:/secret' },
      { monthlyReconciliationUuid: report.payrollBatchUuid }, { batchId: 5 }]) expect(reportPayloadSchema.safeParse({ ...report, ...patch }).success).toBe(false);
    expect(filenameSchema.safeParse('a\r\nb.xlsx').success).toBe(false);
  });
  it('rechaza expedientes cuyos contadores o fechas no cuadran', () => {
    const value = { conceptGroupUuid: '11111111-1111-4111-8111-111111111111', year: 2026, month: 8, status: 'COMPLETED', fileCount: 1, completedFiles: 1,
      totalLines: 4, validLines: 2, excludedLines: 1, invalidLines: 1, totalAmountCents: -1234, startedAt: '2026-08-26T12:00:00Z', completedAt: '2026-08-26T13:00:00Z' };
    expect(reconciliationPayloadSchema.safeParse(value).success).toBe(true);
    for (const patch of [{ validLines: 3 }, { year: 2101 }, { completedFiles: 2 }, { completedAt: '2026-08-25T13:00:00Z' }]) expect(reconciliationPayloadSchema.safeParse({ ...value, ...patch }).success).toBe(false);
  });
  it('ordena claves, mantiene arrays y excluye solo identidad/hash raíz', () => {
    const a = { year: 2026, values: ['á/é', 1, null], nested: { z: false, a: 2 } };
    expect(canonicalPayload({ ...a, operationUuid: 'one', payloadHashSha256: 'old' })).toEqual(canonicalPayload({ nested: { a: 2, z: false }, values: a.values, year: 2026 }));
    expect(canonicalPayload(a).json).toBe('{"nested":{"a":2,"z":false},"values":["á/é",1,null],"year":2026}');
    // Independent Python json.dumps(sort_keys=True,ensure_ascii=False,separators=(',',':')) + hashlib.sha256.
    expect(canonicalPayload(a).hash).toBe('11da98f6a112a21cf54d75a5b19e0de4846733e8cdc5888d93753be2b2641810');
    expect(canonicalPayload({ ...a, values: [...a.values].reverse() }).hash).not.toBe(canonicalPayload(a).hash);
    expect(canonicalPayload({ nested: { operationUuid: 'one' } }).hash).not.toBe(canonicalPayload({ nested: { operationUuid: 'two' } }).hash);
  });
  it.each([undefined, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, new Date()])('rechaza tipos no deterministas: %s', value => {
    expect(() => canonicalPayload({ value })).toThrow();
  });
  it.each(['token', 'password', 'authorization', 'filePath', 'original_file_path'])('rechaza secretos/rutas: %s', key => {
    expect(() => canonicalPayload({ nested: { [key]: 'private' } })).toThrow();
  });
  it('no acepta claves numéricas con orden JSON distinto al contrato PHP', () => {
    expect(() => canonicalPayload({ '2': 'x', '10': 'y' })).toThrow();
  });
  it('acota profundidad y escapa separadores Unicode como PHP', () => {
    let deep: object = {}; for (let i = 0; i < 35; i++) deep = { nested: deep };
    expect(() => canonicalPayload(deep)).toThrow();
    expect(canonicalPayload({ value: '\u2028/\u2029' }).json).toBe('{"value":"\\u2028/\\u2029"}');
  });
  it('valida el contrato de reserva sin confundirlo con entrega', () => {
    const value = { operationUuid: '11111111-1111-4111-8111-111111111111', operationType: 'batch.upsert', payloadHashSha256: 'a'.repeat(64), status: 'PENDING', attempts: 1, lastError: null, result: null, completedAt: null, createdAt: null };
    expect(operationResponseSchema.parse(value).status).toBe('PENDING');
    expect(operationResponseSchema.safeParse({ ...value, operationType: 'local.result.publish' }).success).toBe(false);
    expect(operationResponseSchema.safeParse({ ...value, token: 'secret' }).success).toBe(false);
  });
});
describe('outbox: política y límites IPC', () => {
  const policy = { baseDelayMs: 2000, maxDelayMs: 300000, maximumAttempts: 10 };
  it('backoff exponencial con jitter acotado y máximo', () => {
    expect(retryDelay(policy, 1, 0)).toBe(1000); expect(retryDelay(policy, 2, 1)).toBe(4000);
    expect(retryDelay(policy, 90, 1)).toBe(300000);
  });
  it('Retry-After nunca se reduce al máximo de backoff', () => {
    expect(retryDelay(policy, 3, 0, 900000)).toBe(900000);
  });
  it('rechaza payload/URL arbitrarios y consultas masivas desde renderer', () => {
    expect(syncOperationSchema.safeParse({ operationUuid: '11111111-1111-4111-8111-111111111111', payload: {} }).success).toBe(false);
    expect(syncQuerySchema.safeParse({ page: 1, pageSize: 10000, status: 'all', search: '' }).success).toBe(false);
  });
});
