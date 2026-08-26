import type { SefiplanApi } from '@shared/types/api';

export function installPreviewApi(): void {
  const isElectron = navigator.userAgent.includes('Electron');
  if (window.sefiplanApi || isElectron || !['localhost', '127.0.0.1'].includes(window.location.hostname)) return;
  const desktopOnly = async (): Promise<never> => { throw new Error('Esta operación solo está disponible dentro de la aplicación de escritorio.'); };
  const api: SefiplanApi = {
    sync: {
      remoteHistory: async () => { throw new Error('El historial central requiere la aplicación de escritorio.'); },
      status: async () => ({ state: 'UNCONFIGURED', busy: false, message: 'La cola durable requiere Electron.', canRun: false, canCheckConnection: false,
        pending: 0, inProgress: 0, synced: 0, failed: 0, conflicts: 0, waitingAdapter: 0, lastCompletedAt: null, nextAttemptAt: null }),
      run: desktopOnly, checkConnection: desktopOnly, retry: desktopOnly, list: async () => ({ items: [], total: 0 }), detail: async () => null,
      onChanged: () => () => undefined,
    },
    auth: {
      status: async () => ({ state: 'UNCONFIGURED', busy: false, apiOrigin: null, appVersion: 'Vista previa',
        installationUuid: '', deviceUuid: null, deviceName: '', lastSeenAt: null,
        message: 'La sesión institucional solo está disponible en Electron.', errorCode: 'DESKTOP_ONLY', retryAt: null }),
      login: desktopOnly, logout: desktopOnly, check: desktopOnly, onChanged: () => () => undefined,
    },
    openBackoffice: desktopOnly,
    catalog: {
      status: async () => ({ state: 'UNCONFIGURED', revision: null, checksum: null, syncedAt: null, validUntil: null,
        busy: false, canProcess: false, canSynchronize: false, message: 'La sincronización requiere Electron.',
        errorCode: null, retryAt: null, legacyCount: 0, conflictCount: 0 }),
      synchronize: desktopOnly, onChanged: () => () => undefined,
      exportConflicts: desktopOnly,
      list: async () => ({ items: [], total: 0 }), aliases: async () => ({ items: [], total: 0 }), conflicts: async () => ({ items: [], total: 0 }),
    },
    selectTxtFiles: async () => [], inspectTxtFile: desktopOnly, selectExportDirectory: async () => null,
    processMonthlyImport: desktopOnly, validateRetainedEmployees: async () => ({ matches: [], missingCount: 0 }),
    cancelProcessing: async () => false, subscribeToProgress: () => () => undefined, subscribeToCompletion: () => () => undefined,
    getBatchHistory: async () => ({ items: [], total: 0 }), getMonthlyHistory: async () => ({ items: [], total: 0 }),
    getOrCreateMonthlyReconciliation: desktopOnly, openReportFolder: async () => false, openMonthlyReportFolder: async () => false,
    getPayrollTypes: async () => [], getConceptGroups: async () => [],
    createBackup: async () => null, restoreBackup: async () => null, getSettings: async () => ({}), updateSettings: async () => undefined,
  };
  window.sefiplanApi = api;
}
