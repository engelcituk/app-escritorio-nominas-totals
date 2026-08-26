import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { DatabaseService, IncompatibleSchemaError } from './database/DatabaseService.js';
import { registerIpcHandlers } from './ipc/registerIpcHandlers.js';
import { RecoveryService } from './services/RecoveryService.js';
import { createMainWindow } from './window.js';
import { DeviceService } from './services/central/DeviceService.js';
import { createCentralServices } from './services/central/bootstrap.js';
import { registerAuthHandlers } from './ipc/registerAuthHandlers.js';
import { initializeDatabase } from './database/initializeDatabase.js';
import { registerCatalogHandlers } from './ipc/registerCatalogHandlers.js';
import { registerSyncHandlers } from './ipc/registerSyncHandlers.js';
import { SyncOutboxService } from './services/central/SyncOutboxService.js';

let mainWindow: BrowserWindow | null = null;

const isIsolatedE2e = process.argv.includes('--isolated-e2e');
if (isIsolatedE2e) app.disableHardwareAcceleration();
const hasSingleInstanceLock = isIsolatedE2e || app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const databasePath = join(app.getPath('userData'), 'sefiplan-nomina.sqlite');
    const db = await openDevelopmentDatabase(databasePath);
    try {
      new DeviceService(db.connection, app.getVersion()).ensureIdentity();
      new RecoveryService(db.connection).recoverInterruptedBatches();
      new SyncOutboxService(db.connection).recoverInterrupted();
    } finally { db.close(); }
    const { auth, configuration, catalog, withRepository, sync } = await createCentralServices(databasePath, (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('auth:changed', status);
    }, (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('catalog:changed', status);
    }, () => processing?.hasActiveProcesses() ?? false, (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sync:changed', status);
    });
    mainWindow = createMainWindow();
    const processing = registerIpcHandlers(() => mainWindow, databasePath, catalog, sync);
    registerAuthHandlers(() => mainWindow, auth, configuration);
    registerCatalogHandlers(() => mainWindow, catalog, withRepository);
    registerSyncHandlers(() => mainWindow, sync);
    sync.start();
    void auth.restore();
    const heartbeat = setInterval(() => { void auth.check(); }, 5 * 60_000);
    heartbeat.unref();
    app.once('before-quit', () => { clearInterval(heartbeat); sync.dispose(); catalog.dispose(); auth.dispose(); });
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(); });
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'No se pudo iniciar la aplicación.';
    dialog.showErrorBox('No se pudo iniciar SEFIPLAN Nómina', message);
    app.quit();
  });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

async function openDevelopmentDatabase(databasePath: string): Promise<DatabaseService> {
  try {
    return await initializeDatabase(databasePath);
  } catch (error) {
    if (!(error instanceof IncompatibleSchemaError) || app.isPackaged) {
      if (error instanceof IncompatibleSchemaError) {
        throw new Error(`${error.message} Cierra la aplicación y reinicia su carpeta de datos antes de continuar.`, { cause: error });
      }
      throw error;
    }

    const choice = await dialog.showMessageBox({
      type: 'warning',
      title: 'Base de desarrollo anterior',
      message: 'La base local pertenece al esquema de desarrollo anterior.',
      detail: 'La base se eliminará y se creará nuevamente con el esquema mensual actual.',
      buttons: ['Eliminar y recrear', 'Cerrar aplicación'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (choice.response !== 0) throw new Error('El inicio fue cancelado porque la base local usa un esquema anterior.', { cause: error });

    await removeDevelopmentDatabase(databasePath);
    const database = await initializeDatabase(databasePath);
    database.connection.prepare(`INSERT INTO audit_logs(action, entity_type, description, metadata_json, created_at)
      VALUES ('RESET_SCHEMA', 'DATABASE', 'Se recreó la base de desarrollo por cambio de esquema.', ?, ?)`)
      .run(JSON.stringify({ reset: true }), new Date().toISOString());
    return database;
  }
}

async function removeDevelopmentDatabase(databasePath: string): Promise<void> {
  await Promise.all([databasePath, `${databasePath}-wal`, `${databasePath}-shm`].map((path) => rm(path, { force: true })));
}
