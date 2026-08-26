import type { AuthStatus } from '../../../shared/types/auth.js';
import type { RemoteOperationType, SyncProgress, SyncQuery, SyncStatus, SyncRemoteHistory } from '../../../shared/types/sync.js';
import { remoteHistorySchema } from './resultContracts.js';
import type { CentralConfiguration, CentralConfig } from '../../config/central.js';
import { ApiError, type ApiRequest, type ApiResponse } from './ApiClient.js';
import { SyncOutboxService, type OutboxRow } from './SyncOutboxService.js';
import { canonicalPayload, operationResponseSchema, resourceTypes, SyncError, type RemoteOperation } from './syncContracts.js';

export interface SyncAuth {
  getStatus(): AuthStatus; getSessionGeneration(): number; check(): Promise<AuthStatus>;
  requestAuthenticated<T>(request: ApiRequest<T>): Promise<ApiResponse<T>>;
}
/** Exact DTO validators and resource mutation/upload adapters in main only. */
export interface SyncAdapter {
  validatePayload(payload: unknown): void;
  execute(operation: Readonly<OutboxRow>, payload: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<void | string>;
  verifyCompleted?(operation: Readonly<OutboxRow>, payload: Readonly<Record<string, unknown>>, resourceUuid: string, signal: AbortSignal): Promise<void>;
}
export function retryDelay(policy: CentralConfig['syncRetryPolicy'], attempt: number, random: number, retryAfterMs = 0): number {
  const cap = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.min(30, Math.max(0, attempt - 1)));
  return Math.max(Math.round(cap * (0.5 + Math.max(0, Math.min(1, random)) * 0.5)), retryAfterMs);
}

export class SyncOrchestrator {
  private active: Promise<SyncStatus> | null = null;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private internalError = false;
  private progress: SyncProgress | null = null;
  constructor(private readonly options: {
    configuration: CentralConfiguration; auth: SyncAuth; withOutbox: <T>(action: (queue: SyncOutboxService) => T) => T;
    isBlocked: () => boolean; adapters: Partial<Record<RemoteOperationType, SyncAdapter>>;
    prepareLocal?: () => Promise<void>;
    onChanged?: (status: SyncStatus) => void; now?: () => number; random?: () => number;
  }) {}
  private now(): number { return this.options.now?.() ?? Date.now(); }
  private types(): RemoteOperationType[] { return Object.keys(this.options.adapters) as RemoteOperationType[]; }
  private handledTypes(): string[] { return [...this.types(), ...(this.options.prepareLocal ? ['local.result.publish'] : [])]; }
  setProgress(progress: SyncProgress | null): void { this.progress = progress; this.publish(); }
  getStatus(): SyncStatus {
    const auth = this.options.auth.getStatus();
    const { summary, runtime } = this.options.withOutbox(queue => ({ summary: queue.summary(this.handledTypes()), runtime: queue.runtime() }));
    const paused = this.options.isBlocked() || Boolean(runtime.paused_until && Date.parse(runtime.paused_until) > this.now());
    const state: SyncStatus['state'] = this.internalError ? 'ERROR' : !this.options.configuration.configured ? 'UNCONFIGURED'
      : auth.state === 'OFFLINE' ? 'OFFLINE' : auth.state !== 'AUTHENTICATED' || auth.busy || runtime.requires_session_verification ? 'AUTH_REQUIRED'
        : this.active ? 'RUNNING' : paused ? 'PAUSED' : summary.waitingAdapter && summary.pending === summary.waitingAdapter ? 'WAITING_ADAPTER' : 'IDLE';
    const messages: Record<SyncStatus['state'], string> = {
      UNCONFIGURED: 'Falta la configuración institucional.', AUTH_REQUIRED: 'Verifica la sesión para enviar operaciones. La cola permanece guardada.',
      OFFLINE: 'Sin conexión. El trabajo local se conserva en la cola.', PAUSED: 'En espera del procesamiento, catálogo, restauración o plazo de reintento.',
      RUNNING: 'Consultando y enviando operaciones pendientes.', WAITING_ADAPTER: 'Falta un adaptador compatible para estas operaciones. Actualiza o consulta al administrador.',
      IDLE: summary.pending ? 'Operaciones guardadas; se respetan dependencias y plazos de reintento.' : 'No hay operaciones pendientes de envío.',
      ERROR: 'No se pudo acceder a la cola. Revisa el almacenamiento local y reinicia la aplicación para recuperar el intento.',
    };
    return { ...summary, state, progress: this.progress, busy: this.active !== null, message: messages[state],
      nextAttemptAt: runtime.paused_until && Date.parse(runtime.paused_until) > this.now() ? runtime.paused_until : summary.nextAttemptAt,
      canRun: !this.internalError && !this.disposed && !this.active && this.options.configuration.configured && auth.state === 'AUTHENTICATED' && !auth.busy
        && !paused && !runtime.requires_session_verification && this.types().length > 0,
      canCheckConnection: !this.disposed && !this.active && !auth.busy && this.options.configuration.configured && (!auth.retryAt || auth.retryAt <= this.now()) };
  }
  start(): void {
    if (this.timer || this.disposed) return;
    const tick = () => { try { void this.run().catch(() => { this.internalError = true; }); } catch { this.internalError = true; } };
    this.timer = setInterval(tick, 5000); this.timer.unref(); tick();
  }
  run(): Promise<SyncStatus> {
    if (this.active) return this.active;
    if (this.disposed || !this.getStatus().canRun) return Promise.resolve(this.getStatus());
    this.controller = new AbortController();
    this.active = Promise.resolve().then(() => this.drain(this.controller!.signal)).catch(() => { this.internalError = true; })
      .finally(() => { this.active = null; this.controller = null; this.publish(); }).then(() => this.getStatus());
    this.publish(); return this.active;
  }
  sessionChanged(): void {
    const auth = this.options.auth.getStatus();
    if (auth.busy || auth.state !== 'AUTHENTICATED') this.controller?.abort();
    if (!auth.busy && auth.state === 'AUTHENTICATED') this.options.withOutbox(queue => queue.sessionVerified());
    this.publish();
  }
  activityChanged(): void { if (this.options.isBlocked()) this.controller?.abort(); this.publish(); }
  async checkConnection(): Promise<SyncStatus> {
    if (!this.getStatus().canCheckConnection) return this.getStatus();
    await this.options.auth.check(); this.sessionChanged(); return this.run();
  }
  async retry(uuid: string): Promise<SyncStatus> {
    if (!this.getStatus().canRun) return this.getStatus();
    this.options.withOutbox(queue => queue.retry(uuid, this.handledTypes(), this.now())); return this.run();
  }
  list(query: SyncQuery) {
    const result = this.options.withOutbox(queue => queue.page(query, this.handledTypes(), this.now()));
    if (!this.getStatus().canRun) result.items.forEach(row => { row.canRetry = false; }); return result;
  }
  detail(uuid: string) {
    const result = this.options.withOutbox(queue => queue.detail(uuid, this.handledTypes(), this.now()));
    if (result && !this.getStatus().canRun) result.canRetry = false; return result;
  }
  restoredBackup(): void { this.options.withOutbox(queue => { queue.recoverInterrupted(this.now()); queue.pause(null, true); }); this.publish(); }
  async remoteHistory(uuid: string): Promise<SyncRemoteHistory> {
    const auth = this.options.auth.getStatus();
    if (auth.state !== 'AUTHENTICATED' || auth.busy || this.options.isBlocked()) throw new SyncError('AUTH_REQUIRED');
    const row = this.options.withOutbox(queue => queue.get(uuid));
    if (!row || row.operation_type !== 'reconciliation.upsert' || row.status !== 'SYNCED' || !row.central_entity_uuid
      || row.api_origin !== auth.apiOrigin || row.device_uuid !== auth.deviceUuid || row.installation_uuid !== auth.installationUuid) throw new SyncError('IDENTITY_MISMATCH');
    const response = await this.options.auth.requestAuthenticated({ path: `/api/v1/reconciliations/${row.central_entity_uuid}`, schema: remoteHistorySchema, maximumResponseBytes: 8 * 1024 * 1024 });
    if (response.kind !== 'data' || response.data.uuid !== row.central_entity_uuid) throw new SyncError('ACK_MISMATCH');
    return { ...response.data, checkedAt: new Date(this.now()).toISOString() };
  }
  dispose(): void { this.disposed = true; if (this.timer) clearInterval(this.timer); this.timer = null; this.controller?.abort(); }
  private publish(): void {
    if (this.disposed) return;
    try { this.options.onChanged?.(this.getStatus()); } catch { this.internalError = true; }
  }

  private async drain(signal: AbortSignal): Promise<void> {
    const config = this.options.configuration; if (!config.configured) return;
    this.internalError = false;
    const generation = this.options.auth.getSessionGeneration();
    const check = () => {
      const auth = this.options.auth.getStatus();
      if (signal.aborted || this.disposed || generation !== this.options.auth.getSessionGeneration() || auth.state !== 'AUTHENTICATED' || auth.busy || this.options.isBlocked()) throw new ApiError('CANCELLED');
    };
    for (let index = 0; index < 25; index++) {
      try { check(); } catch { return; }
      await this.options.prepareLocal?.();
      try { check(); } catch { return; }
      const row = this.options.withOutbox(queue => queue.claim(this.types(), this.now(), config.config.syncRetryPolicy.maximumAttempts)); if (!row) return;
      this.publish();
      try {
        const auth = this.options.auth.getStatus();
        if (row.api_origin !== config.config.apiBaseUrl || row.installation_uuid !== auth.installationUuid || row.device_uuid !== auth.deviceUuid) throw new SyncError('IDENTITY_MISMATCH');
        const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
        const computed = canonicalPayload(payload);
        if (computed.hash !== row.payload_hash_sha256 || computed.json !== row.payload_json) throw new SyncError('PAYLOAD_CHANGED');
        const type = row.operation_type as RemoteOperationType; const adapter = this.options.adapters[type];
        if (!adapter) throw new SyncError('WAITING_ADAPTER');
        adapter.validatePayload(payload);
        let remote: RemoteOperation | null = null;
        // Query before every retry (also safe on the first attempt). A lookup 404 means
        // no visible reservation; mutation 404 remains a non-retryable reference failure.
        try { remote = await this.lookup(row, signal); }
        catch (error) { if (!(error instanceof ApiError && error.httpStatus === 404)) throw error; }
        check();
        if (!remote) {
          const reservation = await this.options.auth.requestAuthenticated({ method: 'POST', path: '/api/v1/sync/operations', schema: operationResponseSchema,
            body: { operationUuid: row.operation_uuid, operationType: type, payloadHashSha256: row.payload_hash_sha256 }, signal });
          if (reservation.kind !== 'data') throw new SyncError('ACK_MISMATCH'); remote = reservation.data;
        }
        check(); this.verifyAck(row, remote);
        if (remote.status !== 'COMPLETED') {
          const resourceUuid = await adapter.execute(row, payload, signal); check(); remote = await this.lookup(row, signal); check(); this.verifyAck(row, remote);
          if (resourceUuid && remote.result?.resourceUuid !== resourceUuid) throw new SyncError('ACK_MISMATCH');
        }
        if (remote.status !== 'COMPLETED' || !remote.result || !remote.completedAt) throw new SyncError('REMOTE_PENDING');
        await adapter.verifyCompleted?.(row, payload, remote.result.resourceUuid, signal); check();
        this.options.withOutbox(queue => queue.finish(row.operation_uuid, remote!.result!.resourceUuid, this.now()));
      } catch (error) {
        const code = error instanceof ApiError || error instanceof SyncError ? error.code : 'INTERNAL_ERROR';
        const http = error instanceof ApiError ? error.httpStatus : null;
        const retryable = error instanceof ApiError ? error.retryable || code === 'CANCELLED' : code === 'REMOTE_PENDING';
        const conflict = ['CONFLICT', 'ACK_MISMATCH', 'IDENTITY_MISMATCH', 'PAYLOAD_CHANGED'].includes(code);
        const retryAfter = error instanceof ApiError && http === 429 ? error.retryAfterMs ?? 60_000 : 0;
        // Cap to a representable UTC date, never shorten a representable Retry-After.
        const next = Math.min(Date.UTC(9999, 11, 31, 23, 59, 59), this.now() + retryDelay(config.config.syncRetryPolicy, row.cycle_attempts, this.options.random?.() ?? Math.random(), retryAfter));
        const status = conflict ? 'CONFLICT' : retryable && row.cycle_attempts < config.config.syncRetryPolicy.maximumAttempts ? 'RETRY' : 'FAILED';
        this.options.withOutbox(queue => {
          queue.fail(row.operation_uuid, status, code, http, retryable ? next : null, this.now());
          if (http === 429 || ['NETWORK_ERROR', 'TIMEOUT'].includes(code)) queue.pause(next);
          if (['FORBIDDEN', 'TLS_ERROR'].includes(code)) queue.pause(null, true);
        });
        // A permission 403 is not proof of revocation; /me verifies it and AuthService
        // removes credentials only when device verification actually rejects them.
        if (['FORBIDDEN', 'NETWORK_ERROR', 'TIMEOUT'].includes(code) && !signal.aborted) await this.options.auth.check();
        if (retryable || ['AUTH_REQUIRED', 'FORBIDDEN', 'TLS_ERROR'].includes(code)) return;
      }
    }
  }
  private async lookup(row: OutboxRow, signal: AbortSignal): Promise<RemoteOperation> {
    const response = await this.options.auth.requestAuthenticated({ path: `/api/v1/sync/operations/${row.operation_uuid}`, schema: operationResponseSchema, signal });
    if (response.kind !== 'data') throw new SyncError('ACK_MISMATCH'); return response.data;
  }
  private verifyAck(row: OutboxRow, remote: RemoteOperation): void {
    if (remote.operationUuid !== row.operation_uuid || remote.operationType !== row.operation_type || remote.payloadHashSha256 !== row.payload_hash_sha256
      || (remote.result && (remote.result.resourceType !== resourceTypes[remote.operationType] || (row.central_entity_uuid && row.central_entity_uuid !== remote.result.resourceUuid)))
      || (remote.status === 'COMPLETED' && (!remote.result || !remote.completedAt))) throw new SyncError('ACK_MISMATCH');
  }
}
