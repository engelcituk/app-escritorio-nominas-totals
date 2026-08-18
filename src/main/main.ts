import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { DatabaseService, IncompatibleSchemaError } from './database/DatabaseService.js';
import { registerIpcHandlers } from './ipc/registerIpcHandlers.js';
import { RecoveryService } from './services/RecoveryService.js';
import { createMainWindow } from './window.js';

let mainWindow: BrowserWindow | null = null;

const hasSingleInstanceLock = app.requestSingleInstanceLock();

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
    new RecoveryService(db.connection).recoverInterruptedBatches();
    db.close();
    mainWindow = createMainWindow();
    registerIpcHandlers(() => mainWindow, databasePath);
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
    return new DatabaseService(databasePath);
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
      detail: 'Puedes archivarla y crear una base limpia con el esquema actual. Los respaldos anteriores seguirán siendo incompatibles.',
      buttons: ['Archivar y recrear', 'Cerrar aplicación'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (choice.response !== 0) throw new Error('El inicio fue cancelado porque la base local usa un esquema anterior.', { cause: error });

    const archivedPath = await archiveDevelopmentDatabase(databasePath);
    const database = new DatabaseService(databasePath);
    database.connection.prepare(`INSERT INTO audit_logs(action, entity_type, description, metadata_json, created_at)
      VALUES ('RESET_SCHEMA', 'DATABASE', 'Se recreó la base de desarrollo por cambio de esquema.', ?, ?)`)
      .run(JSON.stringify({ archivedPath }), new Date().toISOString());
    return database;
  }
}

async function archiveDevelopmentDatabase(databasePath: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivedPath = databasePath.replace(/\.sqlite$/i, `.esquema-anterior-${timestamp}.sqlite`);
  await renameIfPresent(databasePath, archivedPath);
  await renameIfPresent(`${databasePath}-wal`, `${archivedPath}-wal`);
  await renameIfPresent(`${databasePath}-shm`, `${archivedPath}-shm`);
  return archivedPath;
}

async function renameIfPresent(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
