import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SecureTokenStore, type TokenCipher } from '../../src/main/services/central/SecureTokenStore.js';

const context = { apiOrigin: 'https://nomina.example', installationUuid: '11111111-1111-4111-8111-111111111111' };
const token = 'unit-test-token-not-for-real-auth';

// Unit test double only. Production receives Electron safeStorage, never this cipher.
function testCipher(): TokenCipher {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString: (value) => {
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
}

describe('SecureTokenStore', () => {
  let directory: string;
  let cipher: TokenCipher;
  let store: SecureTokenStore;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'sefiplan-token-test-')); cipher = testCipher(); store = new SecureTokenStore(directory, cipher); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('no crea una sesión si nunca existió', async () => {
    expect(await store.read(context)).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });

  it('guarda solo un blob cifrado, restaura tras reinicio y permite reemplazo atómico', async () => {
    await store.save(token, context);
    const raw = await readFile(join(directory, 'secure', 'session.bin'));
    expect(raw.includes(Buffer.from(token))).toBe(false);
    expect(raw.includes(Buffer.from(context.apiOrigin))).toBe(false);
    expect(await new SecureTokenStore(directory, cipher).read(context)).toBe(token);
    await store.save('new-test-token', context);
    expect(await store.read(context)).toBe('new-test-token');
    expect(await readdir(join(directory, 'secure'))).toEqual(['session.bin']);
  });

  it('vincula la sesión cifrada con servidor e instalación', async () => {
    await store.save(token, context);
    await expect(store.read({ ...context, apiOrigin: 'https://other.example' })).rejects.toMatchObject({ code: 'SESSION_CONTEXT_MISMATCH' });
    await expect(store.read({ ...context, installationUuid: '22222222-2222-4222-8222-222222222222' }))
      .rejects.toMatchObject({ code: 'SESSION_CONTEXT_MISMATCH' });
  });

  it('rechaza cifrado no disponible y basic_text sin escribir en claro', async () => {
    for (const unavailable of [{ ...cipher, isEncryptionAvailable: () => false }, { ...cipher, getSelectedStorageBackend: () => 'basic_text' }]) {
      await expect(new SecureTokenStore(directory, unavailable).save(token, context)).rejects.toMatchObject({ code: 'SECURE_STORAGE_UNAVAILABLE' });
    }
    expect(await readdir(directory)).toEqual([]);
  });

  it('sanitiza blobs corruptos y errores del proveedor del SO', async () => {
    await store.save(token, context);
    await writeFile(join(directory, 'secure', 'session.bin'), 'corrupt');
    await expect(store.read(context)).rejects.toMatchObject({ code: 'SESSION_UNREADABLE' });
    const error = await new SecureTokenStore(directory, { ...cipher, encryptString: () => { throw new Error(token); } })
      .save(token, context).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'SESSION_WRITE_FAILED' });
    expect(String(error) + JSON.stringify(error)).not.toContain(token);
  });

  it('serializa guardado/borrado y no restaura una sesión cerrada', async () => {
    await Promise.all([store.save(token, context), store.clear()]);
    expect(await new SecureTokenStore(directory, cipher).read(context)).toBeNull();
    expect(await readdir(join(directory, 'secure'))).toEqual(['session.disabled']);
    await store.save('new-login', context);
    expect(await store.read(context)).toBe('new-login');
  });

  it('bloquea restauración incluso si el sistema no permite eliminar el blob', async () => {
    await mkdir(join(directory, 'secure', 'session.bin'), { recursive: true });
    await expect(store.clear()).rejects.toMatchObject({ code: 'SESSION_DELETE_FAILED' });
    expect(await new SecureTokenStore(directory, cipher).read(context)).toBeNull();
  });

  it('rechaza entrada inválida sin incluirla en errores', async () => {
    const error = await store.save(token, { ...context, installationUuid: token }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'SESSION_WRITE_FAILED' });
    expect(String(error) + JSON.stringify(error)).not.toContain(token);
  });
});
