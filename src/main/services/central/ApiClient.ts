import type { z } from 'zod';
import { validateCentralUrl } from '../../config/central.js';

export type ApiErrorCode = 'AUTH_REQUIRED' | 'FORBIDDEN' | 'CONFLICT' | 'HTTP_ERROR' | 'NETWORK_ERROR'
  | 'TLS_ERROR' | 'TIMEOUT' | 'CANCELLED' | 'INVALID_RESPONSE' | 'RESPONSE_TOO_LARGE' | 'INVALID_ENDPOINT' | 'REDIRECT_REJECTED';

const messages: Record<ApiErrorCode, string> = {
  AUTH_REQUIRED: 'Inicia sesión para comunicarte con el servidor.',
  FORBIDDEN: 'El servidor no autorizó esta operación.',
  CONFLICT: 'La información entró en conflicto con el servidor.',
  HTTP_ERROR: 'El servidor no pudo completar la solicitud.',
  NETWORK_ERROR: 'No se pudo conectar con el servidor institucional.',
  TLS_ERROR: 'No se pudo verificar el certificado del servidor institucional.',
  TIMEOUT: 'El servidor no respondió dentro del tiempo permitido.',
  CANCELLED: 'La solicitud fue cancelada.',
  INVALID_RESPONSE: 'La respuesta del servidor no cumple el contrato esperado.',
  RESPONSE_TOO_LARGE: 'La respuesta del servidor excede el tamaño permitido.',
  INVALID_ENDPOINT: 'La dirección de la operación no está permitida.',
  REDIRECT_REJECTED: 'El servidor intentó redirigir la solicitud a otra dirección.',
};

export class ApiError extends Error {
  constructor(readonly code: ApiErrorCode, readonly httpStatus: number | null = null, readonly retryAfterMs: number | null = null) {
    super(messages[code]);
    this.name = 'ApiError';
  }

  get retryable(): boolean {
    return this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT'
      || (this.httpStatus !== null && [408, 429, 500, 502, 503, 504].includes(this.httpStatus));
  }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const milliseconds = Number(trimmed) * 1000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : null;
  }
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed)) return null;
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export interface ApiRequest<T> {
  method?: 'GET' | 'POST' | 'DELETE';
  path: string;
  schema: z.ZodType<T>;
  body?: unknown;
  authenticated?: boolean;
  signal?: AbortSignal;
}

/** Transport only: no application retries, SQL, UI, or body/header logging. */
export class ApiClient {
  private readonly origin: string;
  private readonly timeoutMs: number;
  private readonly maximumResponseBytes: number;
  private readonly transport: typeof fetch;

  constructor(private readonly options: {
    apiBaseUrl: string;
    isPackaged: boolean;
    requestTimeoutMs: number;
    getToken: () => Promise<string | null>;
    maximumResponseBytes?: number;
    transport?: typeof fetch;
  }) {
    this.origin = validateCentralUrl(options.apiBaseUrl, options.isPackaged, true);
    if (!Number.isInteger(options.requestTimeoutMs) || options.requestTimeoutMs < 1) throw new Error('Timeout inválido.');
    this.timeoutMs = options.requestTimeoutMs;
    this.maximumResponseBytes = options.maximumResponseBytes ?? 1_048_576;
    if (!Number.isSafeInteger(this.maximumResponseBytes) || this.maximumResponseBytes < 1) throw new Error('Límite de respuesta inválido.');
    this.transport = options.transport ?? fetch;
  }

  async request<T>(request: ApiRequest<T>): Promise<T> {
    // Callers supply fixed service paths, never an arbitrary renderer URL.
    if (!/^\/api\/v1\/[a-zA-Z0-9/_-]+$/.test(request.path)) throw new ApiError('INVALID_ENDPOINT');
    const url = new URL(request.path, this.origin);
    if (url.origin !== this.origin) throw new ApiError('INVALID_ENDPOINT');
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    request.signal?.addEventListener('abort', cancel, { once: true });
    if (request.signal?.aborted) controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      if (controller.signal.aborted) throw new ApiError('CANCELLED');
      const token = request.authenticated === false ? null : await this.options.getToken();
      if (request.authenticated !== false && !token) throw new ApiError('AUTH_REQUIRED');
      if (controller.signal.aborted) throw new ApiError(timedOut ? 'TIMEOUT' : 'CANCELLED');
      const response = await this.transport(url, {
        method: request.method ?? 'GET',
        headers: { Accept: 'application/json', ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal: controller.signal,
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
      });
      if (response.redirected || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel();
        throw new ApiError('REDIRECT_REJECTED', response.status);
      }
      if (!response.ok) {
        await response.body?.cancel();
        const code = response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'FORBIDDEN'
          : response.status === 409 ? 'CONFLICT' : 'HTTP_ERROR';
        throw new ApiError(code, response.status, parseRetryAfter(response.headers.get('retry-after')));
      }
      let value: unknown;
      if (response.status === 204) value = undefined;
      else {
        if (!/^application\/(?:json|[a-z0-9.-]+\+json)(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
          await response.body?.cancel();
          throw new ApiError('INVALID_RESPONSE', response.status);
        }
        value = JSON.parse(await this.readBody(response)) as unknown;
      }
      const parsed = request.schema.safeParse(value);
      if (!parsed.success) throw new ApiError('INVALID_RESPONSE', response.status);
      return parsed.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (timedOut) throw new ApiError('TIMEOUT');
      if (controller.signal.aborted) throw new ApiError('CANCELLED');
      if (error instanceof SyntaxError) throw new ApiError('INVALID_RESPONSE');
      throw new ApiError(isTlsError(error) ? 'TLS_ERROR' : 'NETWORK_ERROR');
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', cancel);
    }
  }

  private async readBody(response: Response): Promise<string> {
    const announcedLength = Number(response.headers.get('content-length'));
    if (announcedLength > this.maximumResponseBytes) {
      await response.body?.cancel();
      throw new ApiError('RESPONSE_TOO_LARGE', response.status);
    }
    if (!response.body) throw new ApiError('INVALID_RESPONSE', response.status);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > this.maximumResponseBytes) {
          await reader.cancel();
          throw new ApiError('RESPONSE_TOO_LARGE', response.status);
        }
        chunks.push(next.value);
      }
      return Buffer.concat(chunks, length).toString('utf8');
    } finally { reader.releaseLock(); }
  }
}

function isTlsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  // Chromium's network errors use a message instead of Node's `cause.code`.
  if (error instanceof Error && /net::ERR_CERT_|net::ERR_SSL_/.test(error.message)) return true;
  const cause = 'cause' in error ? error.cause : error;
  if (!cause || typeof cause !== 'object' || !('code' in cause)) return false;
  return ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(String(cause.code));
}
