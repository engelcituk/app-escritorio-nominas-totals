import { contextBridge, ipcRenderer } from 'electron';
import type { SefiplanApi } from '../shared/types/api.js';
import type { ProcessingProgress, ProcessResult } from '../shared/types/payroll.js';

const api: SefiplanApi = {
  selectTxtFile: () => ipcRenderer.invoke('file:select-txt'),
  inspectTxtFile: (payload) => ipcRenderer.invoke('file:inspect', payload),
  selectExportDirectory: () => ipcRenderer.invoke('directory:select-export'),
  processPayrollFile: (payload) => ipcRenderer.invoke('payroll:process', payload),
  cancelProcessing: (processId) => ipcRenderer.invoke('payroll:cancel', processId),
  subscribeToProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ProcessingProgress) => callback(progress);
    ipcRenderer.on('payroll:progress', listener);
    return () => ipcRenderer.removeListener('payroll:progress', listener);
  },
  subscribeToCompletion: (callback) => {
    const completed = (_event: Electron.IpcRendererEvent, result: ProcessResult) => callback(result);
    const failed = (_event: Electron.IpcRendererEvent, failure: { processId: string; batchId: number | null; message: string }) =>
      callback({ processId: failure.processId, batchId: failure.batchId ?? 0, status: 'FAILED' as ProcessResult['status'],
        totalAmountCents: 0, totalLines: 0, validLines: 0, excludedLines: 0, invalidLines: 0, errorMessage: failure.message });
    ipcRenderer.on('payroll:completed', completed);
    ipcRenderer.on('payroll:failed', failed);
    return () => { ipcRenderer.removeListener('payroll:completed', completed); ipcRenderer.removeListener('payroll:failed', failed); };
  },
  getBatchHistory: (filters) => ipcRenderer.invoke('history:list', filters),
  openReportFolder: (batchId) => ipcRenderer.invoke('report:open-folder', batchId),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (payload) => ipcRenderer.invoke('settings:update', payload),
};

contextBridge.exposeInMainWorld('sefiplanApi', api);
