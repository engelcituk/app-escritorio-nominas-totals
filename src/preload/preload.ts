import { contextBridge, ipcRenderer } from 'electron';
import type { SefiplanApi } from '../shared/types/api.js';
import type { AuthStatus } from '../shared/types/auth.js';
import type { MonthlyReconciliationResult, ProcessingProgress } from '../shared/types/payroll.js';

const api: SefiplanApi = {
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
  getPayrollTypes: (includeInactive) => ipcRenderer.invoke('payroll-types:list', includeInactive), savePayrollType: (payload) => ipcRenderer.invoke('payroll-types:save', payload),
  getConceptCatalog: () => ipcRenderer.invoke('concepts:list'), saveConceptGroup: (payload) => ipcRenderer.invoke('concepts:save-group', payload),
  savePayrollConcept: (payload) => ipcRenderer.invoke('concepts:save-concept', payload), addConceptAlias: (payload) => ipcRenderer.invoke('concepts:add-alias', payload),
  removeConceptAlias: (id) => ipcRenderer.invoke('concepts:remove-alias', id), createBackup: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'), getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (payload) => ipcRenderer.invoke('settings:update', payload),
};
contextBridge.exposeInMainWorld('sefiplanApi', api);
