import { app, safeStorage, session } from 'electron';
import { join } from 'node:path';
import type { AuthStatus } from '../../../shared/types/auth.js';
import { loadCentralConfig } from '../../config/central.js';
import { DatabaseService } from '../../database/DatabaseService.js';
import { AuthService } from './AuthService.js';
import { DeviceService } from './DeviceService.js';
import { SecureTokenStore } from './SecureTokenStore.js';
import type { CatalogStatus } from '../../../shared/types/catalog.js';
import { CatalogRepository } from './CatalogRepository.js';
import { CatalogSyncService } from './CatalogSyncService.js';
import { backupCatalogDatabase } from '../../database/initializeDatabase.js';
import { SyncOutboxService } from './SyncOutboxService.js';
import { SyncOrchestrator } from './SyncOrchestrator.js';
import type { SyncStatus } from '../../../shared/types/sync.js';
import { createUploadTransport } from './uploadTransport.js';
import { createResultAdapters } from './ResultSyncAdapters.js';
import { ResultPublicationService } from './ResultPublicationService.js';

export async function createCentralServices(databasePath: string, onChanged: (status: AuthStatus) => void,
  onCatalogChanged: (status: CatalogStatus) => void, isProcessing: () => boolean, onSyncChanged: (status: SyncStatus) => void) {
  const configuration = await loadCentralConfig({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath,
    developmentConfigPath: join(app.getAppPath(), 'config/central.development.json') });
  // Short connections also permit restoring the work database without a stale handle.
  function withDevice<T>(action: (device: DeviceService) => T): T {
    const db = new DatabaseService(databasePath);
    try { return action(new DeviceService(db.connection, app.getVersion())); } finally { db.close(); }
  }
  const apiSession = session.fromPartition('central-api'); // memory only, separate from renderer/browser cookies
  const auth = new AuthService({ configuration, isPackaged: app.isPackaged, platform: process.platform,
    device: {
      getIdentity: () => withDevice((device) => device.getIdentity()),
      prepareRegistration: (origin) => withDevice((device) => device.prepareRegistration(origin)),
      acceptRegistration: (value) => withDevice((device) => device.acceptRegistration(value)),
      recordHeartbeat: (uuid) => withDevice((device) => device.recordHeartbeat(uuid)),
    },
    tokens: new SecureTokenStore(app.getPath('userData'), safeStorage),
    transport: (input, init) => apiSession.fetch(input instanceof URL ? input.href : input, init),
    uploadTransport: createUploadTransport(apiSession),
    onChanged: (status) => {
      onChanged(status); catalog?.sessionChanged(); sync?.sessionChanged();
      if (!status.busy && status.state === 'AUTHENTICATED') void catalog?.synchronize();
    },
  });
  function withRepository<T>(action: (repository: CatalogRepository) => T): T {
    const db = new DatabaseService(databasePath);
    try { return action(new CatalogRepository(db.connection)); } finally { db.close(); }
  }
  const catalog = new CatalogSyncService({ configuration, auth, withRepository, backup: () => backupCatalogDatabase(databasePath),
    isProcessing, onChanged: onCatalogChanged });
  function withOutbox<T>(action: (queue: SyncOutboxService) => T): T {
    const db = new DatabaseService(databasePath);
    try { return action(new SyncOutboxService(db.connection)); } finally { db.close(); }
  }
  const adapters = createResultAdapters({ auth, databasePath, withOutbox, progress: value => sync.setProgress(value) });
  const sync = new SyncOrchestrator({ configuration, auth, withOutbox, adapters,
    prepareLocal: async () => {
      const db = new DatabaseService(databasePath);
      try { await new ResultPublicationService(db.connection, databasePath).prepare(); } finally { db.close(); }
    },
    isBlocked: () => isProcessing() || catalog.getStatus().busy, onChanged: onSyncChanged });
  return { auth, configuration, catalog, withRepository, sync };
}
