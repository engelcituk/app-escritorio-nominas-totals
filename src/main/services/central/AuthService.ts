import { loginInputSchema } from '../../../shared/schemas/auth.js';
import type { AuthStatus, LoginInput } from '../../../shared/types/auth.js';
import type { CentralConfiguration } from '../../config/central.js';
import { ApiClient, ApiError } from './ApiClient.js';
import type { DeviceService } from './DeviceService.js';
import { SecureTokenError, type SecureTokenStore } from './SecureTokenStore.js';
import { deviceResponseSchema, heartbeatResponseSchema, loginResponseSchema, logoutResponseSchema } from './contracts.js';

type IdentityStore = Pick<DeviceService, 'getIdentity' | 'prepareRegistration' | 'acceptRegistration' | 'recordHeartbeat'>;
type TokenStore = Pick<SecureTokenStore, 'read' | 'save' | 'clear' | 'requireEncryption'>;

/** Owns secrets and session transitions in main. IPC only receives getStatus(). */
export class AuthService {
  private token: string | null = null;
  private readonly client: ApiClient | null;
  private status: AuthStatus;
  private pending: Promise<unknown> = Promise.resolve();
  private controller: AbortController | null = null;
  private generation = 0;
  private disposed = false;

  constructor(private readonly options: {
    configuration: CentralConfiguration;
    isPackaged: boolean;
    platform: string;
    device: IdentityStore;
    tokens: TokenStore;
    transport?: typeof fetch;
    onChanged?: (status: AuthStatus) => void;
  }) {
    const identity = options.device.getIdentity();
    const config = options.configuration.configured ? options.configuration.config : null;
    this.client = config ? new ApiClient({ ...config, isPackaged: options.isPackaged,
      getToken: async () => this.token, ...(options.transport ? { transport: options.transport } : {}) }) : null;
    this.status = { state: config ? 'AUTH_REQUIRED' : 'UNCONFIGURED', busy: false,
      apiOrigin: config?.apiBaseUrl ?? null, appVersion: identity.appVersion, installationUuid: identity.installationUuid,
      deviceUuid: identity.deviceUuid, deviceName: identity.deviceName, lastSeenAt: identity.lastSeenAt,
      message: config ? null : 'Falta una configuración institucional válida. Contacta al administrador.',
      errorCode: config ? null : 'UNCONFIGURED', retryAt: null };
  }

  getStatus(): AuthStatus { return { ...this.status }; }

  restore(): Promise<AuthStatus> {
    return this.run(async (signal) => {
      if (!this.client) return;
      this.token = await this.options.tokens.read(this.context());
      if (this.token) await this.verify(signal);
    });
  }

  login(raw: LoginInput): Promise<AuthStatus> {
    if (this.status.busy || this.disposed || this.isThrottled()) return Promise.resolve(this.getStatus());
    const parsed = loginInputSchema.safeParse(raw);
    if (!parsed.success) {
      this.set({ message: 'Revisa el correo, la contraseña y el nombre del equipo.', errorCode: 'INVALID_INPUT' });
      return Promise.resolve(this.getStatus());
    }
    const generation = this.generation;
    return this.run(async (signal) => {
      if (!this.client || !this.status.apiOrigin) return;
      this.options.tokens.requireEncryption();
      const identity = this.options.device.prepareRegistration(this.status.apiOrigin);
      this.set({ deviceUuid: identity.deviceUuid });
      const result = await this.client.request({ path: '/api/v1/desktop/tokens', method: 'POST', authenticated: false,
        schema: loginResponseSchema, signal, body: { email: parsed.data.email, password: parsed.data.password,
          name: parsed.data.deviceName, deviceUuid: identity.deviceUuid, installationUuid: identity.installationUuid,
          appVersion: identity.appVersion, platform: this.options.platform } });
      // A logout may arrive while login or the durable save is in flight.
      this.token = result.token;
      if (generation !== this.generation || signal.aborted) throw new ApiError('CANCELLED');
      try {
        this.acceptDevice(result.device);
        await this.options.tokens.save(result.token, this.context());
      } catch (error) {
        await this.revokeCurrent();
        this.token = null;
        await this.options.tokens.clear();
        throw error;
      }
      if (generation !== this.generation || signal.aborted) throw new ApiError('CANCELLED');
      this.set({ state: 'AUTHENTICATED', message: 'Equipo vinculado. La sincronización se incorporará en la siguiente fase.', errorCode: null });
    }, true).finally(() => { parsed.data.password = ''; });
  }

  check(): Promise<AuthStatus> {
    if (this.status.busy || this.isThrottled()) return Promise.resolve(this.getStatus());
    return this.run(async (signal) => { if (this.token) await this.verify(signal); });
  }

  logout(): Promise<AuthStatus> {
    ++this.generation;
    this.controller?.abort();
    // Durable local logout must not wait for the network. The store serializes this
    // marker after any save already in flight; the generation blocks later saves.
    const localClear = this.options.tokens.clear();
    void localClear.catch(() => undefined);
    this.set({ state: this.client ? 'AUTH_REQUIRED' : 'UNCONFIGURED' });
    return this.run(async () => {
      let storageError: unknown;
      try { await localClear; } catch (error) { storageError = error; }
      let revoked: boolean;
      try { revoked = await this.revokeCurrent(); } finally { this.token = null; }
      if (storageError) throw storageError;
      this.set({ message: revoked ? 'Sesión cerrada. Los datos y reportes locales se conservan.'
        : 'Sesión cerrada en este equipo. No se confirmó el cierre remoto; vuelve a autenticarte para invalidar el token anterior.',
      errorCode: revoked ? null : 'REMOTE_LOGOUT_UNCONFIRMED' });
    });
  }

  dispose(): void { this.disposed = true; ++this.generation; this.controller?.abort(); this.token = null; }

  private async verify(signal: AbortSignal): Promise<void> {
    if (!this.client) return;
    try {
      const device = await this.client.request({ path: '/api/v1/desktop/me', schema: deviceResponseSchema, signal });
      if (signal.aborted || this.disposed) throw new ApiError('CANCELLED');
      this.acceptDevice(device);
    } catch (error) {
      if (error instanceof ApiError && ['AUTH_REQUIRED', 'FORBIDDEN', 'CONFLICT'].includes(error.code)) {
        this.token = null;
        this.set({ state: 'AUTH_REQUIRED' });
        await this.options.tokens.clear();
      }
      throw error;
    }
    this.set({ state: 'AUTHENTICATED', message: null, errorCode: null });
    // Heartbeat has its own ability. Its 403 does not prove the token is revoked.
    try {
      await this.client.request({ path: '/api/v1/desktop/heartbeat', method: 'POST', schema: heartbeatResponseSchema, signal });
    } catch (error) {
      if (error instanceof ApiError && error.httpStatus === 401) {
        this.token = null;
        this.set({ state: 'AUTH_REQUIRED' });
        await this.options.tokens.clear();
      }
      throw error;
    }
    this.options.device.recordHeartbeat(this.status.deviceUuid!);
    this.set({ lastSeenAt: this.options.device.getIdentity().lastSeenAt });
  }

  private acceptDevice(device: typeof deviceResponseSchema._output): void {
    const identity = this.options.device.getIdentity();
    if (device.revokedAt !== null) throw new ApiError('FORBIDDEN', 403);
    if (device.uuid !== identity.deviceUuid || device.installationUuid !== identity.installationUuid) throw new ApiError('CONFLICT');
    const registered = this.options.device.acceptRegistration({ installationUuid: device.installationUuid,
      deviceUuid: device.uuid, deviceName: device.name, apiOrigin: this.status.apiOrigin! });
    this.set({ deviceName: registered.deviceName, deviceUuid: registered.deviceUuid, lastSeenAt: registered.lastSeenAt });
  }

  private async revokeCurrent(): Promise<boolean> {
    if (!this.token || !this.client) return true;
    try { await this.client.request({ path: '/api/v1/desktop/logout', method: 'POST', schema: logoutResponseSchema }); return true; }
    catch (error) { return error instanceof ApiError && error.httpStatus === 401; }
  }

  private context(): { apiOrigin: string; installationUuid: string } {
    return { apiOrigin: this.status.apiOrigin!, installationUuid: this.status.installationUuid };
  }

  private isThrottled(): boolean { return this.status.retryAt !== null && this.status.retryAt > Date.now(); }

  private run(action: (signal: AbortSignal) => Promise<void>, login = false): Promise<AuthStatus> {
    if (this.disposed) return Promise.resolve(this.getStatus());
    this.set({ busy: true });
    const task = this.pending.then(async () => {
      if (this.disposed) return this.getStatus();
      this.controller = new AbortController();
      if (this.client) this.set({ message: null, errorCode: null });
      try { await action(this.controller.signal); }
      catch (error) {
        if (error instanceof ApiError && error.code === 'CANCELLED') return this.getStatus();
        const known = error instanceof ApiError || error instanceof SecureTokenError;
        const invalidCredentials = login && error instanceof ApiError && error.httpStatus === 422;
        const retryAt = error instanceof ApiError && error.httpStatus === 429 ? Date.now() + (error.retryAfterMs ?? 60_000) : this.status.retryAt;
        this.set({ state: !this.client ? 'UNCONFIGURED' : !this.token ? 'AUTH_REQUIRED'
          : error instanceof ApiError && ['NETWORK_ERROR', 'TIMEOUT'].includes(error.code) ? 'OFFLINE' : 'UNVERIFIED',
        errorCode: invalidCredentials ? 'LOGIN_REJECTED' : known ? error.code : 'SESSION_ERROR', retryAt,
        message: invalidCredentials ? 'No se pudo iniciar sesión. Revisa las credenciales y los datos del equipo.'
          : error instanceof ApiError && error.httpStatus === 429 ? 'Demasiados intentos. Espera antes de volver a intentarlo.'
            : known ? error.message : 'No se pudo completar la sesión del dispositivo.' });
      } finally { this.controller = null; this.set({ busy: false }); }
      return this.getStatus();
    });
    this.pending = task.catch(() => undefined);
    return task;
  }

  private set(update: Partial<AuthStatus>): void {
    this.status = { ...this.status, ...update };
    if (!this.disposed) this.options.onChanged?.(this.getStatus());
  }
}
