import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { DatabaseService } from './database/DatabaseService.js';
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

  app.whenReady().then(() => {
    const databasePath = join(app.getPath('userData'), 'sefiplan-nomina.sqlite');
    const db = new DatabaseService(databasePath);
    new RecoveryService(db.connection).recoverInterruptedBatches();
    db.close();
    mainWindow = createMainWindow();
    registerIpcHandlers(() => mainWindow, databasePath);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(); });
  });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
