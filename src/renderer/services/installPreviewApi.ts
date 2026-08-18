import type { SefiplanApi } from '@shared/types/api';

export function installPreviewApi(): void {
  const isElectron = navigator.userAgent.includes('Electron');
  if (window.sefiplanApi || isElectron || !['localhost', '127.0.0.1'].includes(window.location.hostname)) return;
  const desktopOnly = async (): Promise<never> => { throw new Error('Esta operación solo está disponible dentro de la aplicación de escritorio.'); };
  const api: SefiplanApi = {
    selectTxtFiles: async () => [], inspectTxtFile: desktopOnly, selectExportDirectory: async () => null,
    processImportGroup: desktopOnly, resumeImportGroup: desktopOnly, validateRetainedEmployees: async () => ({ matches: [], missingCount: 0 }),
    cancelProcessing: async () => false, subscribeToProgress: () => () => undefined, subscribeToCompletion: () => () => undefined,
    getBatchHistory: async () => ({ items: [], total: 0 }), getImportGroupHistory: async () => ({ items: [], total: 0 }),
    openReportFolder: async () => false, openGroupReportFolder: async () => false,
    getConceptCatalog: async () => ({ groups: [], concepts: [] }), saveConceptGroup: async () => 0, savePayrollConcept: async () => 0,
    addConceptAlias: async () => 0, removeConceptAlias: async () => undefined,
    createBackup: async () => null, restoreBackup: async () => null, getSettings: async () => ({}), updateSettings: async () => undefined,
  };
  window.sefiplanApi = api;
}
