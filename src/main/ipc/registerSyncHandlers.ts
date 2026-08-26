import type { BrowserWindow } from 'electron';
import { syncOperationSchema, syncQuerySchema } from '../../shared/schemas/sync.js';
import type { SyncOrchestrator } from '../services/central/SyncOrchestrator.js';
import { trustedHandler } from './trustedSender.js';

export function registerSyncHandlers(windowProvider: () => BrowserWindow | null, sync: SyncOrchestrator): void {
  const handle = trustedHandler(windowProvider);
  handle('sync:status', () => sync.getStatus());
  handle('sync:run', () => sync.run());
  handle('sync:check', () => sync.checkConnection());
  handle('sync:list', (_event, raw) => {
    const parsed = syncQuerySchema.safeParse(raw); if (!parsed.success) throw new Error('La consulta de sincronización no es válida.');
    return sync.list(parsed.data);
  });
  handle('sync:detail', (_event, raw) => {
    const parsed = syncOperationSchema.safeParse(raw); if (!parsed.success) throw new Error('La operación no es válida.');
    return sync.detail(parsed.data.operationUuid);
  });
  handle('sync:retry', (_event, raw) => {
    const parsed = syncOperationSchema.safeParse(raw); if (!parsed.success) throw new Error('La operación no es válida.');
    return sync.retry(parsed.data.operationUuid);
  });
  handle('sync:history', async (_event, raw) => {
    const parsed = syncOperationSchema.safeParse(raw); if (!parsed.success) throw new Error('La operación no es válida.');
    try { return await sync.remoteHistory(parsed.data.operationUuid); }
    catch { throw new Error('No se pudo consultar el expediente central. Verifica conexión, sesión y permisos.'); }
  });
}
