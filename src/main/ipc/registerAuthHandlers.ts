import { shell, type BrowserWindow } from 'electron';
import { loginInputSchema } from '../../shared/schemas/auth.js';
import type { CentralConfiguration } from '../config/central.js';
import type { AuthService } from '../services/central/AuthService.js';
import { trustedHandler } from './trustedSender.js';

export function registerAuthHandlers(windowProvider: () => BrowserWindow | null, auth: AuthService, configuration: CentralConfiguration): void {
  const handle = trustedHandler(windowProvider);
  handle('auth:login', (_event, raw) => {
    const parsed = loginInputSchema.safeParse(raw);
    if (!parsed.success) throw new Error('Datos de acceso no válidos.');
    return auth.login(parsed.data);
  });
  for (const [channel, action] of [
    ['auth:status', () => auth.getStatus()], ['auth:logout', () => auth.logout()], ['auth:check', () => auth.check()],
    ['central:open-backoffice', async () => {
      if (!configuration.configured) throw new Error('Servidor no configurado.');
      // Fixed administratively validated URL; never accept a renderer-supplied URL.
      await shell.openExternal(configuration.config.backofficeUrl);
    }],
  ] as const) {
    handle(channel, (_event, ...args) => {
      if (args.length) throw new Error('La operación no admite parámetros.');
      return action();
    });
  }
}
