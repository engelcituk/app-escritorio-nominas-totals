import type { AuthStatus } from '../../../shared/types/auth.js';
import type { CatalogStatus } from '../../../shared/types/catalog.js';
import type { CentralConfiguration } from '../../config/central.js';
import { ApiError, checksumFromEtag, type ApiRequest, type ApiResponse } from './ApiClient.js';
import { CatalogRepository, type CatalogStateRow } from './CatalogRepository.js';
import { CatalogError, catalogManifestSchema, catalogSnapshotSchema, validateCatalogSnapshot } from './catalogContracts.js';

interface CatalogAuth {
  getStatus(): AuthStatus;
  getSessionGeneration(): number;
  requestAuthenticated<T>(request: ApiRequest<T>): Promise<ApiResponse<T>>;
}

export function deriveCatalogStatus(input: { auth: AuthStatus; state: CatalogStateRow | null; configured: boolean;
  busy: boolean; now: number; maximumAgeSeconds: number; legacyCount: number; conflictCount: number }): CatalogStatus {
  const { state, auth, now } = input;
  const lastSync = state?.synced_at ? Date.parse(state.synced_at) : NaN;
  const expires = Math.min(state?.valid_until ? Date.parse(state.valid_until) : NaN, lastSync + input.maximumAgeSeconds * 1000);
  const hasCopy = state?.revision !== null && state?.revision !== undefined && Boolean(state.checksum_sha256);
  const clockValid = Number.isFinite(lastSync) && now >= lastSync;
  const valid = hasCopy && !state?.requires_verification && clockValid && expires > now;
  const authValid = ['AUTHENTICATED', 'OFFLINE'].includes(auth.state);
  let status: CatalogStatus['state']; let message: string;
  if (!input.configured) { status = 'UNCONFIGURED'; message = 'Configura el servidor institucional para sincronizar los catálogos.'; }
  else if (!authValid) { status = 'AUTH_REQUIRED'; message = 'Inicia sesión o verifica la sesión antes de procesar nuevos archivos.'; }
  else if (input.busy) { status = 'SYNCING'; message = 'Verificando catálogos. Los procesos ya iniciados continúan.'; }
  else if (!hasCopy || state?.requires_verification) { status = 'FIRST_SYNC_REQUIRED'; message = 'Se requiere descargar y verificar el catálogo central antes de procesar.'; }
  else if (!valid) { status = 'CATALOG_EXPIRED'; message = clockValid ? 'El catálogo venció. Sincroniza para iniciar nuevas cargas.' : 'La fecha del equipo cambió. Corrige el reloj y verifica el catálogo en línea.'; }
  else if (auth.state === 'OFFLINE' || ['NETWORK_ERROR', 'TIMEOUT'].includes(state?.last_error ?? '')) { status = 'READY_OFFLINE'; message = 'Catálogo vigente sin conexión. Los reportes se generan localmente.'; }
  else if (state?.last_error) { status = 'DEGRADED'; message = 'No se pudo actualizar el catálogo. Consulta el aviso; la copia anterior se conserva.'; }
  else { status = 'READY_ONLINE'; message = 'Catálogo central verificado. Disponible para nuevas cargas.'; }
  const blockedError = ['FORBIDDEN', 'TLS_ERROR', 'CATALOG_ORIGIN_MISMATCH'].includes(state?.last_error ?? '');
  return { state: status, revision: state?.revision ?? null, checksum: state?.checksum_sha256 ?? null, syncedAt: state?.synced_at ?? null,
    validUntil: Number.isFinite(expires) ? new Date(expires).toISOString() : null, busy: input.busy,
    canProcess: input.configured && authValid && !auth.busy && valid && !blockedError,
    canSynchronize: input.configured && authValid && !auth.busy && !input.busy && (state?.retry_at ?? 0) <= now,
    message, errorCode: state?.last_error ?? null, retryAt: state?.retry_at ?? null, legacyCount: input.legacyCount, conflictCount: input.conflictCount };
}

export class CatalogSyncService {
  private active: Promise<CatalogStatus> | null = null;
  private controller: AbortController | null = null;
  private disposed = false;
  constructor(private readonly options: {
    configuration: CentralConfiguration; auth: CatalogAuth;
    withRepository: <T>(operation: (repository: CatalogRepository) => T) => T;
    backup: () => Promise<void>; isProcessing: () => boolean; onChanged?: (status: CatalogStatus) => void;
    now?: () => number;
  }) {
    options.withRepository((repository) => { if (repository.state()?.revision !== null && repository.state() && !repository.verifyStored()) repository.requireVerification(); });
  }

  getStatus(): CatalogStatus {
    return this.options.withRepository((repository) => {
      const status = deriveCatalogStatus({ auth: this.options.auth.getStatus(), state: repository.state(),
        configured: this.options.configuration.configured, busy: this.active !== null, now: this.now(), maximumAgeSeconds: this.age(), ...repository.counts() });
      if (this.options.isProcessing()) { status.canSynchronize = false; status.canProcess = false; }
      return status;
    });
  }

  assertCanProcess(revision: number): void {
    if (this.options.isProcessing()) throw new CatalogError('PROCESS_ACTIVE', 'Espera a que termine la operación activa antes de iniciar otra carga.');
    const status = this.getStatus();
    if (!status.canProcess) throw new CatalogError('CATALOG_NOT_READY', status.message);
    if (revision !== status.revision) throw new CatalogError('CATALOG_CHANGED', 'Cambió la revisión del catálogo. Vuelve a analizar los TXT y confirma la selección.');
  }

  synchronize(): Promise<CatalogStatus> {
    if (this.active) return this.active;
    if (this.disposed || !this.getStatus().canSynchronize) return Promise.resolve(this.getStatus());
    this.controller = new AbortController();
    // Defer work until `active` is assigned so callbacks/IPC see a single flight.
    this.active = Promise.resolve().then(() => this.perform(this.controller!.signal)).finally(() => {
      this.active = null; this.controller = null; this.publish();
    }).then(() => this.getStatus());
    this.publish();
    return this.active;
  }

  sessionChanged(): void {
    const auth = this.options.auth.getStatus();
    if (auth.busy || !['AUTHENTICATED', 'OFFLINE'].includes(auth.state)) this.controller?.abort();
    this.publish();
  }
  restoredBackup(): void { this.options.withRepository((repository) => repository.requireVerification()); this.publish(); }
  dispose(): void { this.disposed = true; this.controller?.abort(); }

  private async perform(signal: AbortSignal): Promise<void> {
    if (!this.options.configuration.configured) return;
    const origin = this.options.configuration.config.apiBaseUrl;
    const generation = this.options.auth.getSessionGeneration();
    const check = () => {
      if (signal.aborted || this.disposed || generation !== this.options.auth.getSessionGeneration()) throw new ApiError('CANCELLED');
      if (this.options.isProcessing()) throw new CatalogError('PROCESS_ACTIVE', 'Espera a que termine el procesamiento para aplicar un catálogo.');
    };
    try {
      check();
      this.options.withRepository((repository) => repository.recordAttempt());
      const cached = this.options.withRepository((repository) => ({ state: repository.state(), verified: repository.verifyStored() }));
      if (cached.state?.api_origin && cached.state.api_origin !== origin) throw new CatalogError('CATALOG_ORIGIN_MISMATCH', 'El catálogo guardado pertenece a otro servidor.');
      const etag = cached.verified && !cached.state?.requires_verification && cached.state?.checksum_sha256 ? `"${cached.state.checksum_sha256}"` : undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const manifest = await this.options.auth.requestAuthenticated({ path: '/api/v1/catalogs/manifest', schema: catalogManifestSchema,
          signal, ...(etag ? { ifNoneMatch: etag } : {}) });
        check();
        if (manifest.kind === 'not-modified') {
          this.options.withRepository((repository) => repository.confirmUnchanged(origin, this.age(), this.now()));
          return;
        }
        if (checksumFromEtag(manifest.etag) !== manifest.data.checksumSha256) throw new CatalogError('ETAG_MISMATCH', 'El ETag no coincide con el manifest del catálogo.');
        const response = await this.options.auth.requestAuthenticated({ path: '/api/v1/catalogs/snapshot', schema: catalogSnapshotSchema,
          signal, maximumResponseBytes: 32 * 1024 * 1024 });
        check();
        if (response.kind !== 'data') throw new CatalogError('INVALID_SNAPSHOT', 'Se esperaba un catálogo completo.');
        const snapshot = validateCatalogSnapshot(response.data);
        if (checksumFromEtag(response.etag) !== snapshot.checksumSha256) throw new CatalogError('ETAG_MISMATCH', 'El ETag del snapshot no coincide con su contenido.');
        if (snapshot.revision !== manifest.data.revision || snapshot.checksumSha256 !== manifest.data.checksumSha256) {
          if (attempt === 0) continue;
          throw new CatalogError('CATALOG_CHANGED', 'La publicación cambió durante la descarga. Reintenta la sincronización.');
        }
        if (!cached.state?.synced_at) await this.options.backup();
        check();
        this.options.withRepository((repository) => repository.apply(snapshot, origin, this.age(), this.now()));
        return;
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CANCELLED') return;
      const code = error instanceof ApiError || error instanceof CatalogError ? error.code : 'CATALOG_APPLY_FAILED';
      const retryAt = error instanceof ApiError && error.httpStatus === 429 ? this.now() + (error.retryAfterMs ?? 60_000) : null;
      this.options.withRepository((repository) => {
        // An offline retry must not erase a known permission or trust failure.
        if (['FORBIDDEN', 'TLS_ERROR', 'CATALOG_ORIGIN_MISMATCH'].includes(code)) repository.requireVerification();
        repository.recordAttempt(code, retryAt);
      });
    }
  }
  private age(): number { return this.options.configuration.configured ? this.options.configuration.config.catalogMaximumOfflineAge : 0; }
  private now(): number { return this.options.now?.() ?? Date.now(); }
  private publish(): void { if (!this.disposed) this.options.onChanged?.(this.getStatus()); }
}
