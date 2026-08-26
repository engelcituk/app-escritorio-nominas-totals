import { contextBridge, ipcRenderer } from 'electron';
import type { SefiplanApi } from '../shared/types/api.js';
import type { AuthStatus } from '../shared/types/auth.js';
import type { CatalogStatus } from '../shared/types/catalog.js';
import type { SyncStatus } from '../shared/types/sync.js';
import type { MonthlyReconciliationResult, ProcessingProgress } from '../shared/types/payroll.js';

const api: SefiplanApi = {
  sync: {
    remoteHistory: query => ipcRenderer.invoke('sync:history', query),
    status: () => ipcRenderer.invoke('sync:status'), run: () => ipcRenderer.invoke('sync:run'), checkConnection: () => ipcRenderer.invoke('sync:check'),
    list: query => ipcRenderer.invoke('sync:list', query), detail: query => ipcRenderer.invoke('sync:detail', query), retry: query => ipcRenderer.invoke('sync:retry', query),
    onChanged: callback => { const listener = (_event: Electron.IpcRendererEvent, status: SyncStatus) => callback(status);
      ipcRenderer.on('sync:changed', listener); return () => ipcRenderer.removeListener('sync:changed', listener); },
  },
  auth: {
    login: (input) => ipcRenderer.invoke('auth:login', input), logout: () => ipcRenderer.invoke('auth:logout'),
    status: () => ipcRenderer.invoke('auth:status'), check: () => ipcRenderer.invoke('auth:check'),
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, status: AuthStatus) => callback(status);
      ipcRenderer.on('auth:changed', listener);
      return () => ipcRenderer.removeListener('auth:changed', listener);
    },
  },
  openBackoffice: () => ipcRenderer.invoke('central:open-backoffice'),
  catalog: {
    status: () => ipcRenderer.invoke('catalog:status'), synchronize: () => ipcRenderer.invoke('catalog:synchronize'),
    list: (query) => ipcRenderer.invoke('catalog:list', query), aliases: (query) => ipcRenderer.invoke('catalog:aliases', query),
    conflicts: (query) => ipcRenderer.invoke('catalog:conflicts', query),
    exportConflicts: () => ipcRenderer.invoke('catalog:export-conflicts'),
    onChanged: (callback) => { const listener = (_event: Electron.IpcRendererEvent, status: CatalogStatus) => callback(status);
      ipcRenderer.on('catalog:changed', listener); return () => ipcRenderer.removeListener('catalog:changed', listener); },
  },
  selectTxtFiles: () => ipcRenderer.invoke('file:select-txts'), inspectTxtFile: (payload) => ipcRenderer.invoke('file:inspect', payload),
  selectExportDirectory: () => ipcRenderer.invoke('directory:select-export'), processMonthlyImport: (payload) => ipcRenderer.invoke('payroll:process-month', payload),
  validateRetainedEmployees: (payload) => ipcRenderer.invoke('payroll:validate-retained', payload),
  cancelProcessing: (id) => ipcRenderer.invoke('payroll:cancel', id),
  subscribeToProgress: (callback) => { const listener = (_event: Electron.IpcRendererEvent, value: ProcessingProgress) => callback(value);
    ipcRenderer.on('payroll:progress', listener); return () => ipcRenderer.removeListener('payroll:progress', listener); },
  subscribeToCompletion: (callback) => { const completed = (_event: Electron.IpcRendererEvent, value: MonthlyReconciliationResult) => callback(value);
    const failed = (_event: Electron.IpcRendererEvent, failure: { processId: string; reconciliationId?: number; batchId: number | null; message: string }) => callback({
      processId: failure.processId, batchId: failure.batchId ?? 0, status: 'FAILED' as MonthlyReconciliationResult['status'], ...(failure.reconciliationId ? { reconciliationId: failure.reconciliationId } : {}),
      totalAmountCents: 0, totalLines: 0, validLines: 0, excludedLines: 0, invalidLines: 0, errorMessage: failure.message });
    ipcRenderer.on('payroll:completed', completed); ipcRenderer.on('payroll:failed', failed);
    return () => { ipcRenderer.removeListener('payroll:completed', completed); ipcRenderer.removeListener('payroll:failed', failed); }; },
  getBatchHistory: (filters) => ipcRenderer.invoke('history:list', filters), getMonthlyHistory: (filters) => ipcRenderer.invoke('history:monthly', filters),
  getOrCreateMonthlyReconciliation: (payload) => ipcRenderer.invoke('monthly:get-or-create', payload),
  openReportFolder: (id) => ipcRenderer.invoke('report:open-folder', id), openMonthlyReportFolder: (id) => ipcRenderer.invoke('report:open-month-folder', id),
  getPayrollTypes: (includeInactive) => ipcRenderer.invoke('payroll-types:list', includeInactive),
  getConceptGroups: () => ipcRenderer.invoke('concepts:groups'), createBackup: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'), getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (payload) => ipcRenderer.invoke('settings:update', payload),
};
contextBridge.exposeInMainWorld('sefiplanApi', api);
