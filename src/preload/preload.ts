import { contextBridge, ipcRenderer } from 'electron';
import type { SefiplanApi } from '../shared/types/api.js';
import type { ProcessingProgress, ProcessResult } from '../shared/types/payroll.js';

const api: SefiplanApi = {
  selectTxtFiles: () => ipcRenderer.invoke('file:select-txts'), inspectTxtFile: (payload) => ipcRenderer.invoke('file:inspect', payload),
  selectExportDirectory: () => ipcRenderer.invoke('directory:select-export'), processImportGroup: (payload) => ipcRenderer.invoke('payroll:process-group', payload),
  resumeImportGroup: (id) => ipcRenderer.invoke('payroll:resume-group', id), validateRetainedEmployees: (payload) => ipcRenderer.invoke('payroll:validate-retained', payload),
  cancelProcessing: (id) => ipcRenderer.invoke('payroll:cancel', id),
  subscribeToProgress: (callback) => { const listener = (_event: Electron.IpcRendererEvent, value: ProcessingProgress) => callback(value);
    ipcRenderer.on('payroll:progress', listener); return () => ipcRenderer.removeListener('payroll:progress', listener); },
  subscribeToCompletion: (callback) => { const completed = (_event: Electron.IpcRendererEvent, value: ProcessResult) => callback(value);
    const failed = (_event: Electron.IpcRendererEvent, failure: { processId: string; groupId?: number; batchId: number | null; message: string }) => callback({
      processId: failure.processId, batchId: failure.batchId ?? 0, status: 'FAILED' as ProcessResult['status'], ...(failure.groupId ? { groupId: failure.groupId } : {}),
      totalAmountCents: 0, totalLines: 0, validLines: 0, excludedLines: 0, invalidLines: 0, errorMessage: failure.message });
    ipcRenderer.on('payroll:completed', completed); ipcRenderer.on('payroll:failed', failed);
    return () => { ipcRenderer.removeListener('payroll:completed', completed); ipcRenderer.removeListener('payroll:failed', failed); }; },
  getBatchHistory: (filters) => ipcRenderer.invoke('history:list', filters), getImportGroupHistory: (filters) => ipcRenderer.invoke('history:groups', filters),
  openReportFolder: (id) => ipcRenderer.invoke('report:open-folder', id), openGroupReportFolder: (id) => ipcRenderer.invoke('report:open-group-folder', id),
  getConceptCatalog: () => ipcRenderer.invoke('concepts:list'), saveConceptGroup: (payload) => ipcRenderer.invoke('concepts:save-group', payload),
  savePayrollConcept: (payload) => ipcRenderer.invoke('concepts:save-concept', payload), addConceptAlias: (payload) => ipcRenderer.invoke('concepts:add-alias', payload),
  removeConceptAlias: (id) => ipcRenderer.invoke('concepts:remove-alias', id), createBackup: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'), getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (payload) => ipcRenderer.invoke('settings:update', payload),
};
contextBridge.exposeInMainWorld('sefiplanApi', api);
