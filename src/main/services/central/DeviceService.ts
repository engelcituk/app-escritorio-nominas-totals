import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';

const identityRowSchema = z.object({
  installation_uuid: z.string().uuid(),
  central_device_uuid: z.string().uuid().nullable(),
  device_name: z.string().min(1).max(255),
  registered_at: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  last_app_version: z.string(),
  api_origin: z.string().nullable(),
});
const registrationSchema = z.strictObject({
  installationUuid: z.string().uuid(),
  deviceUuid: z.string().uuid(),
  deviceName: z.string().trim().min(1).max(255),
  apiOrigin: z.string().url(),
});

export interface InstallationIdentity {
  installationUuid: string;
  deviceUuid: string | null;
  deviceName: string;
  registeredAt: string | null;
  lastSeenAt: string | null;
  appVersion: string;
  apiOrigin: string | null;
}

/** Local device identity. Wire responses must be validated/mapped by the API adapter. */
export class DeviceService {
  constructor(private readonly database: Database.Database, private readonly appVersion: string) {}

  ensureIdentity(): InstallationIdentity {
    return this.database.transaction(() => {
      const now = new Date().toISOString();
      this.database.prepare(`INSERT INTO app_identity(id, installation_uuid, device_name, last_app_version, created_at, updated_at)
        VALUES (1, ?, 'Equipo de nóminas', ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
        .run(randomUUID(), this.appVersion, now, now);
      this.database.prepare('UPDATE app_identity SET last_app_version=?, updated_at=? WHERE id=1').run(this.appVersion, now);
      return this.getIdentity();
    })();
  }

  getIdentity(): InstallationIdentity {
    const result = identityRowSchema.safeParse(this.database.prepare('SELECT * FROM app_identity WHERE id=1').get());
    if (!result.success) throw new Error('La identidad local del equipo no es válida.');
    const row = result.data;
    return { installationUuid: row.installation_uuid, deviceUuid: row.central_device_uuid, deviceName: row.device_name,
      registeredAt: row.registered_at, lastSeenAt: row.last_seen_at, appVersion: row.last_app_version, apiOrigin: row.api_origin };
  }

  prepareRegistration(apiOrigin: string): InstallationIdentity {
    const url = new URL(apiOrigin);
    if (url.origin !== apiOrigin || !['http:', 'https:'].includes(url.protocol)) throw new Error('El origen del servidor no es válido.');
    return this.database.transaction(() => {
      const current = this.getIdentity();
      if (current.apiOrigin && current.apiOrigin !== apiOrigin) throw new Error('El equipo está vinculado a otro servidor.');
      // Laravel requires BOTH UUIDs before issuing a token. Reserve even on timeout;
      // a retry must refer to the same device, including after a restart.
      this.database.prepare(`UPDATE app_identity SET central_device_uuid=COALESCE(central_device_uuid, ?),
        api_origin=COALESCE(api_origin, ?), updated_at=? WHERE id=1`).run(randomUUID(), apiOrigin, new Date().toISOString());
      return this.getIdentity();
    })();
  }

  acceptRegistration(input: z.infer<typeof registrationSchema>): InstallationIdentity {
    const parsed = registrationSchema.safeParse(input);
    if (!parsed.success) throw new Error('La identidad recibida del servidor no es válida.');
    const value = parsed.data;
    const url = new URL(value.apiOrigin);
    if (url.origin !== value.apiOrigin || !['http:', 'https:'].includes(url.protocol)) throw new Error('El origen del servidor no es válido.');
    return this.database.transaction(() => {
      const current = this.getIdentity();
      if (current.installationUuid !== value.installationUuid) throw new Error('El servidor respondió para otra instalación.');
      if (current.apiOrigin && current.apiOrigin !== value.apiOrigin) throw new Error('El equipo ya está vinculado a otro servidor.');
      if (current.deviceUuid && current.deviceUuid !== value.deviceUuid) throw new Error('El servidor devolvió otra identidad de dispositivo.');
      const now = new Date().toISOString();
      this.database.prepare(`UPDATE app_identity SET central_device_uuid=?, device_name=?, api_origin=?,
        registered_at=COALESCE(registered_at, ?), last_seen_at=?, last_app_version=?, updated_at=? WHERE id=1`)
        .run(value.deviceUuid, value.deviceName, value.apiOrigin, now, now, this.appVersion, now);
      return this.getIdentity();
    })();
  }

  recordHeartbeat(deviceUuid: string): void {
    const current = this.getIdentity();
    if (!current.deviceUuid || deviceUuid !== current.deviceUuid) throw new Error('El heartbeat corresponde a otro dispositivo.');
    const now = new Date().toISOString();
    this.database.prepare('UPDATE app_identity SET last_seen_at=?, last_app_version=?, updated_at=? WHERE id=1')
      .run(now, this.appVersion, now);
  }

  preserveInRestoredDatabase(target: Database.Database): void {
    // A backup restores work data, not the installation that owns this computer.
    this.getIdentity();
    const row = this.database.prepare(`SELECT installation_uuid, central_device_uuid, device_name,
      registered_at, last_seen_at, last_app_version, api_origin, created_at, updated_at FROM app_identity WHERE id=1`).get() as Record<string, string | null>;
    target.transaction(() => {
      target.prepare('DELETE FROM app_identity WHERE id=1').run();
      target.prepare(`INSERT INTO app_identity(id, installation_uuid, central_device_uuid, device_name,
        registered_at, last_seen_at, last_app_version, api_origin, created_at, updated_at)
        VALUES(1, @installation_uuid, @central_device_uuid, @device_name, @registered_at,
          @last_seen_at, @last_app_version, @api_origin, @created_at, @updated_at)`).run(row);
    })();
  }
}
