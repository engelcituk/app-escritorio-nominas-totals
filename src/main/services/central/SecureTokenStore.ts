import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/** Electron 37 compatibility; inject safeStorage from main, never renderer. */
export interface TokenCipher {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

const contextSchema = z.strictObject({ apiOrigin: z.string().url(), installationUuid: z.string().uuid() });
const sessionSchema = contextSchema.extend({ version: z.literal(1), token: z.string().min(1).max(16_384) });
export type TokenContext = z.infer<typeof contextSchema>;
type StorageErrorCode = 'SECURE_STORAGE_UNAVAILABLE' | 'SESSION_UNREADABLE' | 'SESSION_CONTEXT_MISMATCH' | 'SESSION_WRITE_FAILED' | 'SESSION_DELETE_FAILED';

export class SecureTokenError extends Error {
  constructor(readonly code: StorageErrorCode) {
    super({
      SECURE_STORAGE_UNAVAILABLE: 'El sistema operativo no permite guardar la sesión de forma segura.',
      SESSION_UNREADABLE: 'No se pudo recuperar la sesión guardada. Inicia sesión nuevamente.',
      SESSION_CONTEXT_MISMATCH: 'La sesión guardada pertenece a otro servidor o instalación.',
      SESSION_WRITE_FAILED: 'No se pudo guardar la sesión cifrada.',
      SESSION_DELETE_FAILED: 'No se pudo eliminar completamente la sesión local.',
    }[code]);
    this.name = 'SecureTokenError';
  }
}

export class SecureTokenStore {
  private readonly directory: string;
  private readonly sessionPath: string;
  private readonly disabledPath: string;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(userDataPath: string, private readonly cipher: TokenCipher) {
    this.directory = join(userDataPath, 'secure');
    this.sessionPath = join(this.directory, 'session.bin');
    this.disabledPath = join(this.directory, 'session.disabled');
  }

  read(context: TokenContext): Promise<string | null> {
    return this.exclusive(async () => {
      try {
        if (await exists(this.disabledPath)) return null;
        if (!await exists(this.sessionPath)) return null;
        this.requireEncryption();
        if ((await stat(this.sessionPath)).size > 65_536) throw new SecureTokenError('SESSION_UNREADABLE');
        const encrypted = await readFile(this.sessionPath);
        const parsed = sessionSchema.safeParse(JSON.parse(this.cipher.decryptString(encrypted)) as unknown);
        if (!parsed.success) throw new SecureTokenError('SESSION_UNREADABLE');
        if (parsed.data.apiOrigin !== context.apiOrigin || parsed.data.installationUuid !== context.installationUuid) {
          throw new SecureTokenError('SESSION_CONTEXT_MISMATCH');
        }
        return parsed.data.token;
      } catch (error) {
        if (error instanceof SecureTokenError) throw error;
        throw new SecureTokenError('SESSION_UNREADABLE');
      }
    });
  }

  save(token: string, context: TokenContext): Promise<void> {
    return this.exclusive(async () => {
      const temporary = join(this.directory, `session-${randomUUID()}.tmp`);
      try {
        this.requireEncryption();
        const session = sessionSchema.safeParse({ version: 1, token, ...context });
        if (!session.success) throw new SecureTokenError('SESSION_WRITE_FAILED');
        // No plaintext is ever written, including the server/installation binding.
        const encrypted = this.cipher.encryptString(JSON.stringify(session.data));
        if (!encrypted.length || encrypted.length > 65_536) throw new SecureTokenError('SESSION_WRITE_FAILED');
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(encrypted); await file.sync(); } finally { await file.close(); }
        await rename(temporary, this.sessionPath);
        await removeIfPresent(this.disabledPath);
      } catch (error) {
        if (error instanceof SecureTokenError) throw error;
        throw new SecureTokenError('SESSION_WRITE_FAILED');
      } finally {
        await removeIfPresent(temporary).catch(() => undefined);
      }
    });
  }

  clear(): Promise<void> {
    return this.exclusive(async () => {
      try {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        // Fail closed on the next launch if Windows refuses deletion of the blob.
        const marker = await open(this.disabledPath, 'w', 0o600);
        try { await marker.writeFile('logged-out\n'); await marker.sync(); } finally { await marker.close(); }
        await removeIfPresent(this.sessionPath);
      } catch { throw new SecureTokenError('SESSION_DELETE_FAILED'); }
    });
  }

  requireEncryption(): void {
    if (!this.cipher.isEncryptionAvailable() || this.cipher.getSelectedStorageBackend?.() === 'basic_text') {
      throw new SecureTokenError('SECURE_STORAGE_UNAVAILABLE');
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if (isMissingFile(error)) return false; throw error; }
}
async function removeIfPresent(path: string): Promise<void> {
  try { await unlink(path); }
  catch (error) { if (!isMissingFile(error)) throw error; }
}
function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
