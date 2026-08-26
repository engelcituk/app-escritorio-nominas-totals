import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const configSchema = z.strictObject({
  apiBaseUrl: z.string().min(1).max(2048),
  backofficeUrl: z.string().min(1).max(2048),
  updateChannel: z.enum(['stable', 'beta']).default('stable'),
  requestTimeoutMs: z.number().int().min(1000).max(120_000).default(15_000),
  catalogMaximumOfflineAge: z.number().int().min(60).max(31_536_000).default(604_800),
  syncRetryPolicy: z.strictObject({
    baseDelayMs: z.number().int().min(1000).max(60_000).default(2000),
    maxDelayMs: z.number().int().min(1000).max(86_400_000).default(300_000),
    maximumAttempts: z.number().int().min(1).max(100).default(10),
  }).prefault({}),
}).refine((value) => value.syncRetryPolicy.maxDelayMs >= value.syncRetryPolicy.baseDelayMs);

export type CentralConfig = z.infer<typeof configSchema>;
export type CentralConfiguration =
  | { configured: true; config: CentralConfig }
  | { configured: false; reason: 'MISSING_CONFIGURATION' | 'INVALID_CONFIGURATION' };

/** API origins cannot carry paths, credentials, query parameters or fragments. */
export function validateCentralUrl(value: string, isPackaged: boolean, originOnly = false): string {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && !isPackaged && loopback))
    || (originOnly && url.pathname !== '/')) {
    throw new Error('La URL institucional no es válida.');
  }
  return originOnly ? url.origin : url.href;
}

export function parseCentralConfig(input: unknown, isPackaged: boolean): CentralConfiguration {
  try {
    const config = configSchema.parse(input);
    config.apiBaseUrl = validateCentralUrl(config.apiBaseUrl, isPackaged, true);
    config.backofficeUrl = validateCentralUrl(config.backofficeUrl, isPackaged);
    return { configured: true, config };
  } catch {
    // Zod and URL errors can contain the input; never return them to the renderer/logs.
    return { configured: false, reason: 'INVALID_CONFIGURATION' };
  }
}

export async function loadCentralConfig(options: {
  isPackaged: boolean;
  resourcesPath: string;
  environment?: NodeJS.ProcessEnv;
  developmentConfigPath?: string;
}): Promise<CentralConfiguration> {
  if (!options.isPackaged) {
    const environment = options.environment ?? process.env;
    const apiBaseUrl = environment.SEFIPLAN_API_BASE_URL;
    if (!apiBaseUrl) {
      if (!options.developmentConfigPath) return { configured: false, reason: 'MISSING_CONFIGURATION' };
      try {
        const text = await readFile(options.developmentConfigPath, 'utf8');
        if (Buffer.byteLength(text) > 16_384) return { configured: false, reason: 'INVALID_CONFIGURATION' };
        return parseCentralConfig(JSON.parse(text) as unknown, false);
      } catch (error) {
        return { configured: false, reason: isMissingFile(error) ? 'MISSING_CONFIGURATION' : 'INVALID_CONFIGURATION' };
      }
    }
    return parseCentralConfig({
      apiBaseUrl,
      backofficeUrl: environment.SEFIPLAN_BACKOFFICE_URL ?? apiBaseUrl,
      ...(environment.SEFIPLAN_REQUEST_TIMEOUT_MS ? { requestTimeoutMs: Number(environment.SEFIPLAN_REQUEST_TIMEOUT_MS) } : {}),
    }, false);
  }

  try {
    // Only the managed file next to packaged resources is read in production.
    // In particular, SEFIPLAN_* and VITE_* cannot redirect a packaged client.
    const text = await readFile(join(options.resourcesPath, 'central.config.json'), 'utf8');
    if (Buffer.byteLength(text) > 16_384) return { configured: false, reason: 'INVALID_CONFIGURATION' };
    return parseCentralConfig(JSON.parse(text) as unknown, true);
  } catch (error) {
    return { configured: false, reason: isMissingFile(error) ? 'MISSING_CONFIGURATION' : 'INVALID_CONFIGURATION' };
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
