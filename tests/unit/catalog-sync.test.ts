import { describe, expect, it, vi } from 'vitest';
import { CatalogSyncService, deriveCatalogStatus } from '../../src/main/services/central/CatalogSyncService.js';
import type { CatalogRepository, CatalogStateRow } from '../../src/main/services/central/CatalogRepository.js';
import { ApiError, type ApiRequest, type ApiResponse } from '../../src/main/services/central/ApiClient.js';
import { parseCentralConfig } from '../../src/main/config/central.js';
import type { AuthStatus } from '../../src/shared/types/auth.js';
import { snapshot } from '../fixtures/central-catalog.js';

const now = Date.parse('2026-08-26T12:00:00Z');
const authStatus: AuthStatus = { state: 'AUTHENTICATED', busy: false, apiOrigin: 'https://nomina.example', appVersion: '0.1.0',
  installationUuid: 'installation', deviceUuid: 'device', deviceName: 'Prueba', lastSeenAt: null, message: null, errorCode: null, retryAt: null };
function state(): CatalogStateRow { return { snapshot_schema_version: 1, revision: 1, checksum_sha256: snapshot().checksumSha256, published_at: null,
  synced_at: new Date(now).toISOString(), valid_until: new Date(now + 3600_000).toISOString(), api_origin: 'https://nomina.example',
  requires_verification: 0, last_attempt_at: null, last_error: null, retry_at: null }; }
function derive(overrides: Partial<Parameters<typeof deriveCatalogStatus>[0]> = {}) {
  return deriveCatalogStatus({ auth: authStatus, state: state(), configured: true, busy: false, now, maximumAgeSeconds: 3600, legacyCount: 0, conflictCount: 0, ...overrides });
}

describe('vigencia de catálogo', () => {
  it('requiere primera copia, sesión verificada y vigencia; admite offline dentro del plazo', () => {
    expect(derive({ state: null })).toMatchObject({ canProcess: false, state: 'FIRST_SYNC_REQUIRED' });
    expect(derive({ auth: { ...authStatus, state: 'OFFLINE' } })).toMatchObject({ canProcess: true, state: 'READY_OFFLINE' });
    for (const value of ['UNVERIFIED', 'AUTH_REQUIRED', 'UNCONFIGURED'] as const) expect(derive({ auth: { ...authStatus, state: value } }).canProcess).toBe(false);
    expect(derive({ now: now + 3600_000 })).toMatchObject({ state: 'CATALOG_EXPIRED', canProcess: false });
    expect(derive({ maximumAgeSeconds: 60, now: now + 60_000 }).canProcess).toBe(false);
    expect(derive({ now: now - 1 }).canProcess).toBe(false);
    expect(derive({ state: { ...state(), requires_verification: 1 } }).canProcess).toBe(false);
  });
  it('error transitorio conserva copia vigente; TLS y permisos bloquean, rate limit impide sync', () => {
    expect(derive({ state: { ...state(), last_error: 'HTTP_ERROR' } })).toMatchObject({ canProcess: true, state: 'DEGRADED' });
    for (const last_error of ['TLS_ERROR', 'FORBIDDEN', 'CATALOG_ORIGIN_MISMATCH']) expect(derive({ state: { ...state(), last_error } }).canProcess).toBe(false);
    expect(derive({ state: { ...state(), retry_at: now + 1000 } }).canSynchronize).toBe(false);
    expect(derive({ busy: true }).canProcess).toBe(true);
    expect(derive({ busy: true, state: null }).canProcess).toBe(false);
  });
});

function harness(initial: CatalogStateRow | null = null) {
  let stored = initial; let generation = 1; let processing = false; let session = { ...authStatus }; let verified = Boolean(initial);
  const request = vi.fn<(request: ApiRequest<unknown>) => Promise<ApiResponse<unknown>>>();
  const apply = vi.fn((value: ReturnType<typeof snapshot>) => { stored = { ...state(), revision: value.revision, checksum_sha256: value.checksumSha256 }; verified = true; });
  const confirm = vi.fn(() => { if (!verified) throw new Error('invalid copy'); });
  const repository = {
    state: () => stored, counts: () => ({ legacyCount: 0, conflictCount: 0 }), verifyStored: () => verified,
    requireVerification: () => { if (stored) stored.requires_verification = 1; }, apply, confirmUnchanged: confirm,
    recordAttempt: (error: string | null = null, retryAt: number | null = null) => { stored = { ...(stored ?? { ...state(), revision: null, checksum_sha256: null, synced_at: null, valid_until: null, requires_verification: 1 }), last_error: error, retry_at: retryAt }; },
  } as unknown as CatalogRepository;
  const backup = vi.fn(async () => {});
  const service = new CatalogSyncService({ configuration: parseCentralConfig({ apiBaseUrl: authStatus.apiOrigin, backofficeUrl: authStatus.apiOrigin }, false),
    auth: { getStatus: () => session, getSessionGeneration: () => generation, requestAuthenticated: request as <T>(request: ApiRequest<T>) => Promise<ApiResponse<T>> },
    withRepository: operation => operation(repository), backup, isProcessing: () => processing, now: () => now });
  const value = snapshot();
  const data = (body: unknown, checksum = value.checksumSha256): ApiResponse<unknown> => ({ kind: 'data', data: body, etag: `"${checksum}"` });
  const manifest = { revision: value.revision, checksumSha256: value.checksumSha256, publishedAt: value.publishedAt };
  return { service, request, apply, backup, confirm, data, value, manifest,
    logout: () => { ++generation; session = { ...session, state: 'AUTH_REQUIRED' }; service.sessionChanged(); },
    setProcessing: () => { processing = true; } };
}

describe('sincronización de catálogos', () => {
  it('single flight aplica snapshot solo después del backup; 304 no descarga otra copia', async () => {
    const h = harness(); h.request.mockResolvedValueOnce(h.data(h.manifest)).mockResolvedValueOnce(h.data(h.value));
    const pending = h.service.synchronize(); expect(h.service.synchronize()).toBe(pending);
    expect((await pending).canProcess).toBe(true); expect(h.backup).toHaveBeenCalledOnce(); expect(h.apply).toHaveBeenCalledOnce();
    expect(h.backup.mock.invocationCallOrder[0]).toBeLessThan(h.apply.mock.invocationCallOrder[0]!);
    h.request.mockResolvedValueOnce({ kind: 'not-modified', etag: `"${h.value.checksumSha256}"` });
    await h.service.synchronize(); expect(h.request).toHaveBeenCalledTimes(3); expect(h.confirm).toHaveBeenCalledOnce();
    expect(h.request.mock.calls[2]![0].ifNoneMatch).toBe(`"${h.value.checksumSha256}"`);
  });
  it('rechaza descarga corrupta conservando revisión y posibilidad offline de copia previa', async () => {
    const h = harness(state()); h.value.payrollTypes[0]!.name = 'Corrupto';
    h.request.mockResolvedValueOnce(h.data(h.manifest)).mockResolvedValueOnce(h.data(h.value));
    expect(await h.service.synchronize()).toMatchObject({ revision: 1, canProcess: true, errorCode: 'CHECKSUM_MISMATCH' });
    expect(h.apply).not.toHaveBeenCalled();
  });
  it('aborta primera aplicación si falla backup', async () => {
    const h = harness(); h.request.mockResolvedValueOnce(h.data(h.manifest)).mockResolvedValueOnce(h.data(h.value));
    h.backup.mockRejectedValueOnce(new Error('disk full'));
    expect((await h.service.synchronize()).canProcess).toBe(false); expect(h.apply).not.toHaveBeenCalled();
  });
  it('descarta respuesta tardía al cerrar sesión o empezar un proceso durante descarga', async () => {
    for (const action of ['logout', 'setProcessing'] as const) {
      const h = harness(state()); h.request.mockImplementationOnce(async () => { h[action](); return h.data(h.manifest); });
      await h.service.synchronize(); expect(h.apply).not.toHaveBeenCalled(); expect(h.request).toHaveBeenCalledOnce();
    }
  });
  it('reintenta una publicación cambiante una vez y respeta Retry-After', async () => {
    const h = harness(); const newer = { ...h.value, revision: 2 };
    h.request.mockResolvedValueOnce(h.data(h.manifest)).mockResolvedValueOnce(h.data(newer))
      .mockResolvedValueOnce(h.data({ ...h.manifest, revision: 2 })).mockResolvedValueOnce(h.data(newer));
    expect((await h.service.synchronize()).revision).toBe(2); expect(h.request).toHaveBeenCalledTimes(4);
    h.request.mockRejectedValueOnce(new ApiError('HTTP_ERROR', 429, 120_000));
    expect(await h.service.synchronize()).toMatchObject({ canSynchronize: false, retryAt: now + 120_000 });
    await h.service.synchronize(); expect(h.request).toHaveBeenCalledTimes(5);
  });
  it('restaurar obliga descarga completa y el inicio valida revisión en main', async () => {
    const h = harness(state()); expect(() => h.service.assertCanProcess(0)).toThrowError(/revisión/);
    h.service.restoredBackup(); expect(() => h.service.assertCanProcess(1)).toThrow();
    h.request.mockResolvedValueOnce(h.data(h.manifest)).mockResolvedValueOnce(h.data(h.value));
    await h.service.synchronize(); expect(h.request.mock.calls[0]![0].ifNoneMatch).toBeUndefined();
  });
  it('una caída de red posterior a 403 no vuelve a habilitar un catálogo rechazado', async () => {
    const h = harness(state()); h.request.mockRejectedValueOnce(new ApiError('FORBIDDEN', 403));
    expect((await h.service.synchronize()).canProcess).toBe(false);
    h.request.mockRejectedValueOnce(new ApiError('NETWORK_ERROR'));
    expect((await h.service.synchronize()).canProcess).toBe(false);
    h.request.mockResolvedValueOnce(h.data(h.manifest)).mockResolvedValueOnce(h.data(h.value));
    expect((await h.service.synchronize()).canProcess).toBe(true);
    expect(h.request.mock.calls[2]![0].ifNoneMatch).toBeUndefined();
  });
});
