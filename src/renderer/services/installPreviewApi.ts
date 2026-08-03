import type { SefiplanApi } from '@shared/types/api';

export function installPreviewApi(): void {
  if (window.sefiplanApi || !['localhost', '127.0.0.1'].includes(window.location.hostname)) return;
  const api: SefiplanApi = {
    selectTxtFile: async () => null,
    inspectTxtFile: async () => { throw new Error('La inspección de archivos solo está disponible dentro de la aplicación de escritorio.'); },
    selectExportDirectory: async () => null,
    processPayrollFile: async () => { throw new Error('El procesamiento solo está disponible dentro de la aplicación de escritorio.'); },
    cancelProcessing: async () => false,
    subscribeToProgress: () => () => undefined,
    subscribeToCompletion: () => () => undefined,
    getBatchHistory: async () => ({ items: [], total: 0 }),
    openReportFolder: async () => false,
    createBackup: async () => null,
    restoreBackup: async () => null,
    getSettings: async () => ({}),
    updateSettings: async () => undefined,
  };
  window.sefiplanApi = api;
}
