import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { mkdir, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from './DatabaseService.js';

/** SQLite online backup includes WAL data; never copy a live .sqlite alone. */
export async function backupCatalogDatabase(path: string, label = 'before-catalog'): Promise<void> {
  const source = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const pages = Number(source.pragma('page_count', { simple: true }));
    const size = pages * Number(source.pragma('page_size', { simple: true }));
    const space = await statfs(dirname(path));
    if (space.bavail * space.bsize < size * 2 + 10 * 1024 * 1024) throw new Error('No hay espacio suficiente para respaldar el catálogo.');
    const directory = join(dirname(path), 'catalog-backups');
    await mkdir(directory, { recursive: true });
    const destination = join(directory, `${label}-${randomUUID()}.sqlite`);
    await source.backup(destination);
    const backup = new Database(destination, { readonly: true, fileMustExist: true });
    try {
      if (backup.pragma('integrity_check', { simple: true }) !== 'ok' || (backup.pragma('foreign_key_check') as unknown[]).length) throw new Error('No se pudo verificar el respaldo previo.');
    } finally { backup.close(); }
  } finally { source.close(); }
}

export async function initializeDatabase(path: string): Promise<DatabaseService> {
  if (existsSync(path)) {
    const current = new Database(path, { readonly: true, fileMustExist: true });
    let backupLabel: string | null;
    try {
      const migrations = current.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
      backupLabel = !migrations ? null : !current.prepare('SELECT 1 FROM schema_migrations WHERE version=3').get() ? 'before-v3'
        : !current.prepare('SELECT 1 FROM schema_migrations WHERE version=4').get() ? 'before-v4'
          : !current.prepare('SELECT 1 FROM schema_migrations WHERE version=5').get() ? 'before-v5' : null;
    } finally { current.close(); }
    if (backupLabel) await backupCatalogDatabase(path, backupLabel);
  }
  return new DatabaseService(path, { initialize: true });
}
