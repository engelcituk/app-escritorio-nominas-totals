import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RemoteOperationType } from '../../../shared/types/sync.js';

export const remoteOperationTypeSchema = z.enum(['reconciliation.upsert', 'batch.upsert', 'report.upload']);
export const operationResponseSchema = z.strictObject({
  operationUuid: z.string().uuid(), operationType: remoteOperationTypeSchema,
  payloadHashSha256: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']),
  attempts: z.number().int().nonnegative().safe(), lastError: z.string().nullable(),
  result: z.strictObject({ resourceType: z.enum(['monthlyReconciliation', 'payrollBatch', 'reportArtifact']), resourceUuid: z.string().uuid() }).nullable(),
  completedAt: z.string().datetime({ offset: true }).nullable(), createdAt: z.string().datetime({ offset: true }).nullable(),
});
export type RemoteOperation = z.infer<typeof operationResponseSchema>;
export const resourceTypes: Record<RemoteOperationType, NonNullable<RemoteOperation['result']>['resourceType']> = {
  'reconciliation.upsert': 'monthlyReconciliation', 'batch.upsert': 'payrollBatch', 'report.upload': 'reportArtifact',
};
export class SyncError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'SyncError'; }
}

/** Contract: recursively sort object keys, keep array order, strip only root identity/hash.
 * DTO adapters must validate their exact wire schema before enqueue and delivery. */
export function canonicalPayload(input: unknown): { json: string; hash: string } {
  let nodes = 0;
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 1_000_000 || depth > 32) throw new SyncError('PAYLOAD_LIMIT');
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    if (Array.isArray(value)) return value.map(item => visit(item, depth + 1));
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.entries(value).filter(([key]) => depth !== 0 || !['operationUuid', 'payloadHashSha256'].includes(key))
        .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map(([key, item]) => {
          // Contract keys are ASCII names; reject hidden credentials and local paths.
          if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || /token|password|authorization|secret|path/i.test(key)) throw new SyncError('UNSAFE_PAYLOAD');
          return [key, visit(item, depth + 1)];
        }));
    }
    throw new SyncError('INVALID_PAYLOAD');
  };
  if (!input || Array.isArray(input) || typeof input !== 'object') throw new SyncError('INVALID_PAYLOAD');
  const json = JSON.stringify(visit(input, 0)).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  if (Buffer.byteLength(json) > 32 * 1024 * 1024) throw new SyncError('PAYLOAD_LIMIT');
  return { json, hash: createHash('sha256').update(json, 'utf8').digest('hex') };
}

const messages: Record<string, string> = {
  RESULT_CONTRACT_INVALID: 'El resultado local no cumple el contrato central. Revisa catálogo, periodo y datos; el trabajo local se conserva.',
  HISTORICAL_REPORT_MISSING: 'No se conserva el mensual de esta revisión histórica. Requiere recuperación del respaldo; no se enviará el mensual de otra revisión.',
  REPORT_FILE_MISSING: 'Falta la copia del Excel para este envío. Recupera sync-files del respaldo antes de reintentar.',
  REPORT_FILE_INVALID: 'El Excel no coincide con su hash/tamaño o excede 100 MiB. Se bloqueó el envío.',
  REPORT_STORAGE_FULL: 'No hay espacio para conservar el Excel pendiente. Libera espacio y recupera la publicación.',
  WAITING_ADAPTER: 'No hay un adaptador compatible para esta operación. Consulta al administrador.',
  WAITING_DEPENDENCY: 'Espera la confirmación de la operación anterior. Revisa su diagnóstico si tiene errores.',
  LOCAL_REPORTS_PENDING: 'Esperando a que termine la generación local de reportes.',
  LOCAL_REPORTS_UNCONFIRMED: 'La aplicación se cerró antes de confirmar los reportes locales. Revisa el expediente; no se enviará automáticamente.',
  LOCAL_RESULT_FAILED: 'No se completó la generación local de reportes. Reprocesa el TXT; esta intención no se enviará.',
  AUTH_REQUIRED: 'Inicia sesión y reintenta la misma operación.', FORBIDDEN: 'Permiso insuficiente o dispositivo revocado. Verifica la sesión y consulta al administrador.',
  CONFLICT: 'Conflicto remoto: no cambies el UUID ni el contenido. Revisa el diagnóstico en la administración central.',
  ACK_MISMATCH: 'La confirmación no corresponde a la operación o recurso esperado. Requiere revisión.',
  IDENTITY_MISMATCH: 'La operación pertenece a otro servidor o dispositivo. No se enviará con esta sesión.',
  NETWORK_ERROR: 'No hay conexión con el servidor. La operación sigue guardada.', TIMEOUT: 'Se agotó el tiempo de espera. Se consultará el estado remoto antes de repetir.',
  TLS_ERROR: 'No se pudo verificar el certificado del servidor. Revisa la configuración institucional.',
  HTTP_ERROR: 'El servidor rechazó o no pudo completar la operación.', INVALID_RESPONSE: 'La respuesta remota no cumple el contrato esperado.',
  REMOTE_PENDING: 'La operación aún no tiene confirmación remota de finalización.',
  PAYLOAD_CHANGED: 'El contenido local no coincide con su hash original. Se bloqueó el envío.',
  INTERRUPTED: 'Intento interrumpido. Se consultará su UUID remoto antes de repetir.',
  RETRY_LIMIT: 'Se agotó el límite de intentos automáticos. Revisa la causa antes de reintentar manualmente.',
  CANCELLED: 'Intento suspendido. La operación y su identidad se conservan.',
  INTERNAL_ERROR: 'No se pudo completar la sincronización. Consulta al administrador.',
};
export function syncMessage(code: string | null): string { return code ? messages[code] ?? messages.INTERNAL_ERROR! : 'Pendiente de confirmación remota.'; }
