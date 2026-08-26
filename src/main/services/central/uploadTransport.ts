import { net, type Session } from 'electron';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ApiError, type UploadTransport } from './ApiClient.js';

/** Streaming multipart through Chromium's TLS/session, no cookies or redirects.
 * write callbacks hand chunks to Chromium, not to the wire; getUploadProgress is
 * informational only (some Chromium builds do not advance it until end()).
 */
export function createUploadTransport(session: Session): UploadTransport {
  return async (url, headers, file, signal) => new Promise<Response>((resolve, reject) => {
    if (signal.aborted) { reject(new ApiError('CANCELLED')); return; }
    const boundary = `sefiplan-${randomUUID()}`;
    // A transport filename is deliberately ASCII; the immutable original name is in metadata.
    const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="report.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`);
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const request = net.request({ url: url.href, method: 'POST', session, credentials: 'omit', redirect: 'manual' });
    request.chunkedEncoding = true;
    for (const [name, value] of Object.entries(headers)) request.setHeader(name, value);
    request.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`);
    const stream = createReadStream(file.path, { highWaterMark: 64 * 1024 });
    let settled = false; let responding = false; let lastProgressAt = 0;
    const progress = () => {
      const state = request.getUploadProgress();
      if (state.started && Date.now() - lastProgressAt >= 200) {
        lastProgressAt = Date.now(); file.onProgress?.(Math.max(0, Math.min(file.sizeBytes, state.current - prefix.length)));
      }
      return state.current;
    };
    const timer = setInterval(progress, 200);
    const cleanup = () => { clearInterval(timer); signal.removeEventListener('abort', cancel); stream.destroy(); };
    const fail = (error: unknown) => { if (settled) return; settled = true; cleanup(); request.abort(); reject(error); };
    const cancel = () => fail(new ApiError('CANCELLED'));
    signal.addEventListener('abort', cancel, { once: true });
    request.on('error', fail);
    stream.on('error', fail);
    request.on('redirect', () => fail(new ApiError('REDIRECT_REJECTED')));
    request.on('response', response => {
      responding = true; stream.destroy();
      const chunks: Buffer[] = []; let length = 0;
      response.on('error', fail);
      response.on('aborted', () => fail(new ApiError('NETWORK_ERROR')));
      response.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > 1024 * 1024) { fail(new ApiError('RESPONSE_TOO_LARGE')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return; settled = true; cleanup();
        const resultHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) resultHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
        resolve(new Response(response.statusCode === 204 ? null : Buffer.concat(chunks), { status: response.statusCode, headers: resultHeaders }));
      });
    });
    if (signal.aborted) { cancel(); return; }
    void (async () => {
      request.write(prefix);
      for await (const chunk of stream) {
        if (settled || responding) return;
        await new Promise<void>(done => request.write(chunk as Buffer, undefined, done));
      }
      if (!settled && !responding) { request.write(suffix); request.end(); }
    })().catch(error => { if (!responding) fail(error); });
  });
}
