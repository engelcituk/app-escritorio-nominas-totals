import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiClient, ApiError, parseRetryAfter } from '../../src/main/services/central/ApiClient.js';

const schema = z.strictObject({ accepted: z.boolean() });
const path = '/api/v1/test';
const token = 'unit-test-secret-canary';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function client(transport: typeof fetch, maximumResponseBytes?: number) {
  return new ApiClient({ apiBaseUrl: 'https://nomina.example', isPackaged: true, requestTimeoutMs: 1000,
    getToken: async () => token, transport, ...(maximumResponseBytes ? { maximumResponseBytes } : {}) });
}

describe('ApiClient', () => {
  it('304 solo admite petición condicional con ETag idéntico y no requiere JSON', async () => {
    const etag = `"${'a'.repeat(64)}"`;
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 304, headers: { ETag: etag } }));
    expect(await client(transport).requestWithMetadata({ path, schema, ifNoneMatch: etag })).toEqual({ kind: 'not-modified', etag });
    expect(transport.mock.calls[0]?.[1]?.headers).toHaveProperty('If-None-Match', etag);
    const weak = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 304, headers: { ETag: `W/${etag}` } }));
    expect(await client(weak).requestWithMetadata({ path, schema, ifNoneMatch: etag })).toEqual({ kind: 'not-modified', etag: `W/${etag}` });
    for (const headers of [{}, { ETag: `"${'b'.repeat(64)}"` }]) {
      const mismatch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 304, headers }));
      await expect(client(mismatch).requestWithMetadata({ path, schema, ifNoneMatch: etag })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
    await expect(client(transport).request({ path, schema })).rejects.toBeInstanceOf(ApiError);
  });

  it('agrega bearer solo en main, desactiva redirects/cookies y valida la respuesta', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ accepted: true }));
    expect(await client(transport).request({ path, schema, method: 'POST', body: { value: 1 } })).toEqual({ accepted: true });
    expect(transport.mock.calls[0]?.[0].toString()).toBe('https://nomina.example/api/v1/test');
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', redirect: 'manual', credentials: 'omit',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{"value":1}' });
  });

  it('login no necesita ni envía un token previo', async () => {
    const getToken = vi.fn(async () => token);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ accepted: true }));
    const api = new ApiClient({ apiBaseUrl: 'http://localhost:8000', isPackaged: false, requestTimeoutMs: 1000, getToken, transport });
    await api.request({ path, schema, authenticated: false });
    expect(getToken).not.toHaveBeenCalled();
    expect(transport.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
  });

  it('no inicia transporte sin sesión ni ante cancelación previa', async () => {
    const transport = vi.fn<typeof fetch>();
    const api = new ApiClient({ apiBaseUrl: 'https://nomina.example', isPackaged: true, requestTimeoutMs: 1000,
      getToken: async () => null, transport });
    await expect(api.request({ path, schema })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(client(transport).request({ path, schema, signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(['https://evil.example', '//evil.example/api/v1/test', '/api/v1/../test', '/api/v1/test?token=secret'])('rechaza endpoint no permitido %s', async (invalidPath) => {
    const transport = vi.fn<typeof fetch>();
    await expect(client(transport).request({ path: invalidPath, schema })).rejects.toMatchObject({ code: 'INVALID_ENDPOINT' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('rechaza redirects sin seguirlos', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }));
    await expect(client(transport).request({ path, schema })).rejects.toMatchObject({ code: 'REDIRECT_REJECTED' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 409, 422, 408, 429, 500, 502, 503, 504])('clasifica HTTP %s sin exponer el cuerpo ni reintentar', async (status) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ token, password: token, trace: token }, status));
    const error = await client(transport).request({ path, schema }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).httpStatus).toBe(status);
    expect((error as ApiError).retryable).toBe([408, 429, 500, 502, 503, 504].includes(status));
    expect(String(error) + JSON.stringify(error)).not.toContain(token);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('lee Retry-After en segundos y fecha HTTP sin recortar el plazo', async () => {
    expect(parseRetryAfter('120')).toBe(120000);
    expect(parseRetryAfter('Wed, 26 Aug 2026 01:01:00 GMT', Date.parse('2026-08-26T01:00:00Z'))).toBe(60000);
    expect(parseRetryAfter('invalid')).toBeNull();
    expect(parseRetryAfter('-1')).toBeNull();
    expect(parseRetryAfter('1.5')).toBeNull();
    const response = new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
    await expect(client(vi.fn<typeof fetch>().mockResolvedValue(response)).request({ path, schema })).rejects.toMatchObject({ retryAfterMs: 120000 });
  });

  it('rechaza JSON/schema/content-type inválido sin filtrar valores', async () => {
    for (const response of [json({ accepted: token }), json({ accepted: true, token }),
      new Response(token, { headers: { 'Content-Type': 'application/json' } }), new Response(token)]) {
      const error = await client(vi.fn<typeof fetch>().mockResolvedValue(response)).request({ path, schema }).catch((cause: unknown) => cause);
      expect(error).toMatchObject({ code: 'INVALID_RESPONSE' });
      expect(String(error) + JSON.stringify(error)).not.toContain(token);
    }
  });

  it('limita cuerpos incluso cuando no anuncian Content-Length', async () => {
    await expect(client(vi.fn<typeof fetch>().mockResolvedValue(json({ accepted: true })), 8)
      .request({ path, schema })).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    const response = json({ accepted: true }); response.headers.set('Content-Length', '5000');
    await expect(client(vi.fn<typeof fetch>().mockResolvedValue(response), 100)
      .request({ path, schema })).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });

  it('acepta 204 solo cuando el schema lo admite', async () => {
    expect(await client(vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })))
      .request({ path, schema: z.undefined(), method: 'DELETE' })).toBeUndefined();
  });

  it('aborta por timeout y distingue cancelación sin devolver el error de transporte', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error(token)), { once: true });
    }));
    try {
      const pending = client(transport).request({ path, schema });
      const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(1000); await assertion;
      const controller = new AbortController();
      const cancelled = client(transport).request({ path, schema, signal: controller.signal });
      await Promise.resolve(); controller.abort();
      await expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' });
    } finally { vi.useRealTimers(); }
  });

  it('no omite errores TLS y sanitiza errores de red', async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new TypeError(token, { cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } }));
    await expect(client(transport).request({ path, schema })).rejects.toMatchObject({ code: 'TLS_ERROR', retryable: false });
    transport.mockRejectedValue(new Error(token));
    const error = await client(transport).request({ path, schema }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
    expect(String(error)).not.toContain(token);
  });
});
