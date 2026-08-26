import { app, safeStorage, session } from 'electron';
import { join } from 'node:path';
import type { AuthStatus } from '../../../shared/types/auth.js';
import { loadCentralConfig } from '../../config/central.js';
import { DatabaseService } from '../../database/DatabaseService.js';
import { AuthService } from './AuthService.js';
import { DeviceService } from './DeviceService.js';
import { SecureTokenStore } from './SecureTokenStore.js';

export async function createCentralServices(databasePath: string, onChanged: (status: AuthStatus) => void) {
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
    transport: (input, init) => apiSession.fetch(input instanceof URL ? input.href : input, init), onChanged,
  });
  return { auth, configuration };
}
