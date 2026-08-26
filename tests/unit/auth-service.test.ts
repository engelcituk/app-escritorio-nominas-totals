import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../src/main/services/central/AuthService.js';
import { parseCentralConfig } from '../../src/main/config/central.js';
import { SecureTokenError } from '../../src/main/services/central/SecureTokenStore.js';
import { z } from 'zod';

const installationUuid = '11111111-1111-4111-8111-111111111111';
const deviceUuid = '22222222-2222-4222-8222-222222222222';
const credentials = { email: 'test@example.invalid', password: 'test-password', deviceName: 'Equipo de prueba' };
const token = 'test-token-never-a-real-credential';
const configuration = parseCentralConfig({ apiBaseUrl: 'https://test.example', backofficeUrl: 'https://test.example' }, false);
const deviceResponse = { uuid: deviceUuid, installationUuid, name: credentials.deviceName, platform: 'win32', appVersion: '0.1.0',
  lastSeenAt: null, createdAt: null, revokedAt: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup() {
  let stored: string | null = null;
  const identity = { installationUuid, deviceUuid: null as string | null, deviceName: 'Equipo', appVersion: '0.1.0',
    registeredAt: null as string | null, lastSeenAt: null as string | null, apiOrigin: null as string | null };
  const device = {
    getIdentity: () => ({ ...identity }),
    prepareRegistration: vi.fn((origin: string) => { identity.deviceUuid = deviceUuid; identity.apiOrigin = origin; return { ...identity }; }),
    acceptRegistration: vi.fn((value: { deviceName: string }) => { identity.deviceName = value.deviceName; return { ...identity }; }),
    recordHeartbeat: vi.fn(() => { identity.lastSeenAt = '2026-08-26T00:00:00Z'; }),
  };
  const tokens = {
    read: vi.fn(async () => stored), save: vi.fn(async (value: string) => { stored = value; }),
    clear: vi.fn(async () => { stored = null; }), requireEncryption: vi.fn(),
  };
  const transport = vi.fn<typeof fetch>(async (url) => {
    if (String(url).endsWith('/tokens')) return json({ token, tokenType: 'Bearer', abilities: ['device:heartbeat'], device: deviceResponse }, 201);
    if (String(url).endsWith('/me')) return json(deviceResponse);
    if (String(url).endsWith('/heartbeat')) return json({ receivedAt: '2026-08-26T00:00:00Z' });
    return json({ message: 'Sesión cerrada.' });
  });
  const onChanged = vi.fn();
  const options = { configuration, isPackaged: false, platform: 'win32', device, tokens, transport, onChanged };
  const auth = new AuthService(options);
  return { auth, options, tokens, device, transport, onChanged };
}

describe('AuthService · contrato Laravel y ciclo de sesión', () => {
  it('un 401 del catálogo invalida la sesión aunque falle la limpieza del almacén', async () => {
    const { auth, tokens, transport } = setup(); await auth.login(credentials);
    transport.mockResolvedValueOnce(json({}, 401)); tokens.clear.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(auth.requestAuthenticated({ path: '/api/v1/catalogs/manifest', schema: z.object({}) })).rejects.toThrow();
    expect(auth.getStatus().state).toBe('AUTH_REQUIRED');
    await expect(auth.requestAuthenticated({ path: '/api/v1/catalogs/manifest', schema: z.object({}) })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });
  it('envía el contrato real, cifra el token y solo publica DTO sin secretos', async () => {
    const { auth, tokens, transport, onChanged } = setup();
    const status = await auth.login(credentials);
    expect(status.state).toBe('AUTHENTICATED');
    expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({ email: credentials.email, password: credentials.password,
      name: credentials.deviceName, deviceUuid, installationUuid, appVersion: '0.1.0', platform: 'win32' });
    expect(tokens.save).toHaveBeenCalledWith(token, { apiOrigin: 'https://test.example', installationUuid });
    expect(JSON.stringify([status, onChanged.mock.calls])).not.toContain(token);
    expect(JSON.stringify([status, onChanged.mock.calls])).not.toContain(credentials.password);
    expect(status).not.toHaveProperty('userName');
  });

  it('restaura sesión y heartbeat usando Bearer solo en main', async () => {
    const { auth, options, transport, device } = setup();
    await auth.login(credentials); auth.dispose();
    const restarted = new AuthService(options);
    expect((await restarted.restore()).state).toBe('AUTHENTICATED');
    expect(device.recordHeartbeat).toHaveBeenCalledWith(deviceUuid);
    expect(transport.mock.calls.at(-1)?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${token}` });
  });

  it.each([401, 403])('elimina sesión rechazada por /me (%i) sin tocar datos locales', async (code) => {
    const { auth, tokens, transport } = setup();
    await auth.login(credentials);
    transport.mockResolvedValueOnce(json({ message: credentials.password }, code));
    const status = await auth.check();
    expect(status.state).toBe('AUTH_REQUIRED');
    expect(tokens.clear).toHaveBeenCalledOnce();
    expect(JSON.stringify(status)).not.toContain(credentials.password);
  });

  it('una caída de red conserva sesión cifrada y diferencia offline de rechazo', async () => {
    const { auth, tokens, transport } = setup();
    await auth.login(credentials);
    transport.mockRejectedValueOnce(new Error('fetch failed'));
    expect((await auth.check()).state).toBe('OFFLINE');
    expect(tokens.clear).not.toHaveBeenCalled();
  });

  it('no confunde certificado inválido con modo offline', async () => {
    const { auth, transport } = setup();
    await auth.login(credentials);
    transport.mockRejectedValueOnce(new Error('net::ERR_CERT_AUTHORITY_INVALID'));
    expect(await auth.check()).toMatchObject({ state: 'UNVERIFIED', errorCode: 'TLS_ERROR' });
  });

  it('credenciales incorrectas son 422 y no refleja mensajes arbitrarios del backend', async () => {
    const { auth, transport } = setup();
    transport.mockResolvedValueOnce(json({ message: credentials.password }, 422));
    expect(await auth.login(credentials)).toMatchObject({ state: 'AUTH_REQUIRED', errorCode: 'LOGIN_REJECTED' });
    expect(auth.getStatus().message).not.toContain(credentials.password);
  });

  it('respeta Retry-After sin reemitir login ni heartbeat en bucle', async () => {
    const { auth, transport } = setup();
    transport.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '60' } }));
    const result = await auth.login(credentials);
    expect(result.retryAt).toBeGreaterThan(Date.now());
    await auth.login(credentials); await auth.check();
    expect(transport).toHaveBeenCalledOnce();
  });

  it('cierra localmente aunque falle logout remoto', async () => {
    const { auth, tokens, transport } = setup();
    await auth.login(credentials);
    transport.mockRejectedValueOnce(new Error('offline'));
    expect(await auth.logout()).toMatchObject({ state: 'AUTH_REQUIRED', errorCode: 'REMOTE_LOGOUT_UNCONFIRMED' });
    expect(tokens.clear).toHaveBeenCalledOnce();
  });

  it('un login tardío no revive la sesión después de logout', async () => {
    const { auth, transport, tokens } = setup();
    let resolveResponse!: (response: Response) => void;
    transport.mockImplementationOnce(() => new Promise((resolve) => { resolveResponse = resolve; }));
    const loggingIn = auth.login(credentials);
    await vi.waitFor(() => expect(resolveResponse).toBeTypeOf('function'));
    const loggingOut = auth.logout();
    resolveResponse(json({ token, tokenType: 'Bearer', abilities: [], device: deviceResponse }));
    await loggingIn; await loggingOut;
    expect(auth.getStatus().state).toBe('AUTH_REQUIRED');
    expect(await tokens.read()).toBeNull();
    expect(tokens.save).not.toHaveBeenCalled();
  });

  it('desactiva la sesión persistida antes de esperar al logout remoto', async () => {
    const { auth, transport, tokens } = setup();
    await auth.login(credentials);
    let finish!: (response: Response) => void;
    transport.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const closing = auth.logout();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(await tokens.read()).toBeNull();
    expect(auth.getStatus().state).toBe('AUTH_REQUIRED');
    finish(json({ message: 'Closed' }));
    await closing;
  });

  it('401 en heartbeat elimina un token invalidado después de /me', async () => {
    const { auth, tokens, transport } = setup();
    await auth.login(credentials);
    transport.mockResolvedValueOnce(json(deviceResponse)).mockResolvedValueOnce(json({}, 401));
    expect((await auth.check()).state).toBe('AUTH_REQUIRED');
    expect(tokens.clear).toHaveBeenCalledOnce();
  });

  it('rechaza identidades inesperadas y revoca el token recibido', async () => {
    const { auth, transport, tokens } = setup();
    transport.mockResolvedValueOnce(json({ token, tokenType: 'Bearer', abilities: [], device: { ...deviceResponse, installationUuid: deviceUuid } }));
    expect(await auth.login(credentials)).toMatchObject({ state: 'AUTH_REQUIRED', errorCode: 'CONFLICT' });
    expect(tokens.save).not.toHaveBeenCalled();
    expect(String(transport.mock.calls.at(-1)?.[0])).toMatch(/\/logout$/);
  });

  it('no emite token cuando safeStorage no está disponible', async () => {
    const { auth, tokens, transport } = setup();
    tokens.requireEncryption.mockImplementationOnce(() => { throw new SecureTokenError('SECURE_STORAGE_UNAVAILABLE'); });
    expect((await auth.login(credentials)).errorCode).toBe('SECURE_STORAGE_UNAVAILABLE');
    expect(transport).not.toHaveBeenCalled();
  });

  it('si falla el guardado, revoca token y no deja una sesión aparente', async () => {
    const { auth, tokens, transport } = setup();
    tokens.save.mockRejectedValueOnce(new SecureTokenError('SESSION_WRITE_FAILED'));
    expect((await auth.login(credentials)).state).toBe('AUTH_REQUIRED');
    expect(String(transport.mock.calls.at(-1)?.[0])).toMatch(/\/logout$/);
    expect(tokens.clear).toHaveBeenCalledOnce();
  });

  it('403 de heartbeat no elimina una sesión validada por /me', async () => {
    const { auth, tokens, transport } = setup();
    await auth.login(credentials);
    transport.mockResolvedValueOnce(json(deviceResponse)).mockResolvedValueOnce(json({}, 403));
    expect((await auth.check()).state).toBe('UNVERIFIED');
    expect(tokens.clear).not.toHaveBeenCalled();
  });

  it('configuración ausente y payload inválido no envían credenciales', async () => {
    const { auth, options, transport } = setup();
    expect((await auth.login({ ...credentials, email: '' })).errorCode).toBe('INVALID_INPUT');
    const unconfigured = new AuthService({ ...options, configuration: { configured: false, reason: 'MISSING_CONFIGURATION' } });
    expect((await unconfigured.login(credentials)).state).toBe('UNCONFIGURED');
    expect(transport).not.toHaveBeenCalled();
  });
});
