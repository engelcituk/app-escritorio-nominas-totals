import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import { fileTokenSchema, historyQuerySchema, processPayrollRequestSchema } from '../../shared/schemas/ipc.js';
import type { BatchSummary, SelectedFile } from '../../shared/types/payroll.js';
import { DatabaseService } from '../database/DatabaseService.js';
import { BackupService } from '../services/BackupService.js';
import { inspectPayrollFile } from '../services/PreflightService.js';
import { ProcessingService } from '../services/ProcessingService.js';

const fileTokens = new Map<string, string>();
const directoryTokens = new Map<string, string>();

export function registerIpcHandlers(windowProvider: () => BrowserWindow | null, databasePath: string): ProcessingService {
  const processing = new ProcessingService(databasePath, windowProvider);

  ipcMain.handle('file:select-txt', async (): Promise<SelectedFile | null> => {
    const result = await dialog.showOpenDialog(windowProvider()!, { title: 'Seleccionar archivo de nómina', properties: ['openFile'],
      filters: [{ name: 'Archivo de nómina', extensions: ['txt'] }] });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return null;
    const { stat } = await import('node:fs/promises');
    const info = await stat(filePath);
    const token = randomUUID();
    fileTokens.set(token, filePath);
    return { token, name: basename(filePath), size: info.size, modifiedAt: info.mtime.toISOString() };
  });

  ipcMain.handle('file:inspect', async (_event, payload: unknown) => {
    const { fileToken } = fileTokenSchema.parse(payload);
    const filePath = resolveToken(fileTokens, fileToken, 'El archivo seleccionado ya no está disponible.');
    const info = await (await import('node:fs/promises')).stat(filePath);
    return inspectPayrollFile(filePath, { token: fileToken, name: basename(filePath), size: info.size, modifiedAt: info.mtime.toISOString() });
  });

  ipcMain.handle('directory:select-export', async () => {
    const result = await dialog.showOpenDialog(windowProvider()!, { title: 'Seleccionar carpeta de reportes', properties: ['openDirectory', 'createDirectory'] });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    const token = randomUUID();
    directoryTokens.set(token, path);
    return { token, name: path };
  });

  ipcMain.handle('payroll:process', (_event, payload: unknown) => {
    const request = processPayrollRequestSchema.parse(payload);
    const filePath = resolveToken(fileTokens, request.fileToken, 'Selecciona nuevamente el archivo de nómina.');
    const db = new DatabaseService(databasePath);
    const setting = db.connection.prepare(`SELECT value FROM app_settings WHERE key = 'reports_directory'`).get() as { value: string } | undefined;
    db.close();
    const outputDirectory = request.exportDirectoryToken
      ? resolveToken(directoryTokens, request.exportDirectoryToken, 'Selecciona nuevamente la carpeta de reportes.')
      : (setting?.value ?? join(app.getPath('documents'), 'SEFIPLAN_Nomina'));
    const strictRequest = {
      fileToken: request.fileToken,
      year: request.year,
      fortnight: request.fortnight,
      payrollType: request.payrollType,
      conceptFamily: request.conceptFamily,
      exclusions: request.exclusions,
      ...(request.exportDirectoryToken ? { exportDirectoryToken: request.exportDirectoryToken } : {}),
      ...(request.duplicateAction ? { duplicateAction: request.duplicateAction } : {}),
    };
    return { processId: processing.start(strictRequest, { filePath, outputDirectory }) };
  });

  ipcMain.handle('payroll:cancel', (_event, processId: unknown) => processing.cancel(String(processId)));

  ipcMain.handle('history:list', (_event, payload: unknown) => {
    const query = historyQuerySchema.parse(payload);
    const where: string[] = ['1=1'];
    const values: unknown[] = [];
    if (query.year) { where.push('year = ?'); values.push(query.year); }
    if (query.fortnight) { where.push('fortnight = ?'); values.push(query.fortnight); }
    if (query.payrollType) { where.push('payroll_type = ?'); values.push(query.payrollType); }
    if (query.status) { where.push('status = ?'); values.push(query.status); }
    if (query.search) { where.push('original_filename LIKE ?'); values.push(`%${query.search.replace(/[%_]/g, '')}%`); }
    const db = new DatabaseService(databasePath);
    const total = (db.connection.prepare(`SELECT COUNT(*) AS count FROM payroll_batches WHERE ${where.join(' AND ')}`).get(...values) as { count: number }).count;
    const rows = db.connection.prepare(`SELECT id, year, fortnight, payroll_type, version, original_filename, status,
      total_lines, excluded_lines, invalid_lines, total_amount_cents, completed_at FROM payroll_batches
      WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...values, query.pageSize, (query.page - 1) * query.pageSize) as Array<Record<string, string | number | null>>;
    db.close();
    const items: BatchSummary[] = rows.map((row) => ({ id: Number(row.id), year: Number(row.year), fortnight: Number(row.fortnight),
      payrollType: row.payroll_type as BatchSummary['payrollType'], version: Number(row.version), originalFilename: String(row.original_filename),
      status: row.status as BatchSummary['status'], totalLines: Number(row.total_lines), excludedLines: Number(row.excluded_lines),
      invalidLines: Number(row.invalid_lines), totalAmountCents: Number(row.total_amount_cents),
      completedAt: row.completed_at === null ? null : String(row.completed_at) }));
    return { items, total };
  });

  ipcMain.handle('report:open-folder', async (_event, batchId: unknown) => {
    const id = Number(batchId);
    if (!Number.isInteger(id) || id < 1) return false;
    const db = new DatabaseService(databasePath);
    const report = db.connection.prepare('SELECT file_path FROM generated_reports WHERE batch_id = ? ORDER BY id DESC LIMIT 1').get(id) as { file_path: string } | undefined;
    db.close();
    if (!report || !existsSync(report.file_path)) return false;
    await shell.openPath(dirname(report.file_path));
    return true;
  });

  ipcMain.handle('settings:get', () => {
    const db = new DatabaseService(databasePath);
    const entries = db.connection.prepare('SELECT key, value FROM app_settings').all() as Array<{ key: string; value: string }>;
    db.close();
    return Object.fromEntries(entries.map((item) => [item.key, item.value]));
  });

  ipcMain.handle('settings:update', (_event, payload: unknown) => {
    const allowed = new Set(['minimum_year', 'maximum_year']);
    if (!payload || typeof payload !== 'object') throw new Error('La configuración no es válida.');
    const db = new DatabaseService(databasePath);
    const upsert = db.connection.prepare(`INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
    db.connection.transaction(() => {
      for (const [key, value] of Object.entries(payload)) {
        if (key === 'reports_directory_token' && typeof value === 'string') {
          upsert.run('reports_directory', resolveToken(directoryTokens, value, 'Selecciona nuevamente la carpeta de reportes.'), new Date().toISOString());
        } else if (allowed.has(key) && typeof value === 'string') upsert.run(key, value, new Date().toISOString());
      }
    })();
    db.close();
  });

  ipcMain.handle('backup:create', async () => {
    const result = await dialog.showSaveDialog(windowProvider()!, { title: 'Crear respaldo', defaultPath: `Respaldo_SEFIPLAN_${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'Respaldo ZIP', extensions: ['zip'] }] });
    if (result.canceled || !result.filePath) return null;
    const snapshot = join(app.getPath('temp'), `sefiplan-backup-${randomUUID()}.sqlite`);
    const source = new DatabaseService(databasePath);
    try { await source.connection.backup(snapshot); } finally { source.close(); }
    try { await new BackupService().create(snapshot, result.filePath); } finally { void (await import('node:fs/promises')).unlink(snapshot).catch(() => undefined); }
    return { path: result.filePath };
  });

  ipcMain.handle('backup:restore', async () => {
    if (processing.hasActiveProcesses()) throw new Error('Espera a que termine o cancela el procesamiento antes de restaurar.');
    const selected = await dialog.showOpenDialog(windowProvider()!, { title: 'Seleccionar respaldo', properties: ['openFile'],
      filters: [{ name: 'Respaldo ZIP', extensions: ['zip'] }] });
    const archivePath = selected.filePaths[0];
    if (selected.canceled || !archivePath) return null;
    const confirmation = await dialog.showMessageBox(windowProvider()!, { type: 'warning', title: 'Restaurar respaldo',
      message: 'La información actual será reemplazada por el respaldo seleccionado.',
      detail: 'Antes de continuar se creará automáticamente un respaldo de la base actual.',
      buttons: ['Cancelar', 'Restaurar respaldo'], defaultId: 0, cancelId: 0, noLink: true });
    if (confirmation.response !== 1) return null;

    const temporaryDirectory = await mkdtemp(join(app.getPath('temp'), 'sefiplan-restore-'));
    const automaticBackupPath = join(app.getPath('userData'), 'backups', `Antes_de_restaurar_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);
    try {
      const backupService = new BackupService();
      const currentSnapshot = join(temporaryDirectory, 'current.sqlite');
      const current = new DatabaseService(databasePath);
      try { await current.connection.backup(currentSnapshot); } finally { current.close(); }
      await (await import('node:fs/promises')).mkdir(dirname(automaticBackupPath), { recursive: true });
      await backupService.create(currentSnapshot, automaticBackupPath);

      const restoredPath = await backupService.extractValidated(archivePath, temporaryDirectory);
      const candidate = new DatabaseService(restoredPath);
      try {
        const latest = candidate.connection.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
        if ((latest.version ?? 0) > 1) throw new Error('El respaldo fue creado con una versión más reciente de la aplicación.');
        candidate.connection.prepare('SELECT 1 FROM payroll_batches LIMIT 1').get();
      } finally { candidate.close(); }
      await rm(`${databasePath}-wal`, { force: true });
      await rm(`${databasePath}-shm`, { force: true });
      await copyFile(restoredPath, databasePath);
      const restored = new DatabaseService(databasePath);
      try { restored.connection.prepare(`INSERT INTO audit_logs(action, entity_type, description, metadata_json, created_at)
        VALUES ('RESTORE', 'DATABASE', 'Se restauró un respaldo validado.', ?, ?)`).run(JSON.stringify({ archive: basename(archivePath), automaticBackupPath }), new Date().toISOString()); }
      finally { restored.close(); }
      return { restored: true, automaticBackupPath };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  return processing;
}

function resolveToken(registry: Map<string, string>, token: string, message: string): string {
  const path = registry.get(token);
  if (!path) throw new Error(message);
  return path;
}
