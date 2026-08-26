import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCentralConfig, parseCentralConfig } from '../../src/main/config/central.js';

const config = { apiBaseUrl: 'https://nomina.example', backofficeUrl: 'https://nomina.example/admin' };

describe('configuración central en main', () => {
  it('normaliza el origen y aplica límites por defecto sin credenciales', () => {
    expect(parseCentralConfig({ ...config, apiBaseUrl: 'https://nomina.example/' }, true)).toMatchObject({
      configured: true, config: { apiBaseUrl: config.apiBaseUrl, requestTimeoutMs: 15000, catalogMaximumOfflineAge: 604800 },
    });
  });

  it.each(['http://nomina.example', 'https://user:secret@nomina.example', 'https://nomina.example?token=secret',
    'https://nomina.example#secret', 'file:///C:/data', 'https://nomina.example/api'])('rechaza servidor productivo inseguro: %s', (apiBaseUrl) => {
    expect(parseCentralConfig({ ...config, apiBaseUrl }, true)).toEqual({ configured: false, reason: 'INVALID_CONFIGURATION' });
  });

  it.each(['http://localhost:8000', 'http://127.0.0.1:8000', 'http://[::1]:8000'])('permite HTTP únicamente loopback en desarrollo: %s', (apiBaseUrl) => {
    expect(parseCentralConfig({ apiBaseUrl, backofficeUrl: apiBaseUrl }, false).configured).toBe(true);
    expect(parseCentralConfig({ apiBaseUrl, backofficeUrl: apiBaseUrl }, true).configured).toBe(false);
  });

  it('no permite HTTP LAN, opciones desconocidas, TLS desactivado ni política inversa', () => {
    expect(parseCentralConfig({ ...config, apiBaseUrl: 'http://192.168.1.10:8000' }, false).configured).toBe(false);
    expect(parseCentralConfig({ ...config, rejectUnauthorized: false }, true).configured).toBe(false);
    expect(parseCentralConfig({ ...config, syncRetryPolicy: { baseDelayMs: 5000, maxDelayMs: 1000 } }, true).configured).toBe(false);
  });

  it('lee variables de desarrollo sin exponer valores inválidos en el error', async () => {
    expect(await loadCentralConfig({ isPackaged: false, resourcesPath: '', environment: {} })).toMatchObject({ configured: false });
    const result = await loadCentralConfig({ isPackaged: false, resourcesPath: '', environment: {
      SEFIPLAN_API_BASE_URL: 'http://localhost:8000', SEFIPLAN_REQUEST_TIMEOUT_MS: '5000',
    } });
    expect(result).toMatchObject({ configured: true, config: { requestTimeoutMs: 5000 } });
    const invalid = await loadCentralConfig({ isPackaged: false, resourcesPath: '', environment: { SEFIPLAN_API_BASE_URL: 'secret' } });
    expect(JSON.stringify(invalid)).not.toContain('secret');
  });

  it('en paquete ignora el entorno y usa exclusivamente el archivo administrado', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sefiplan-config-test-'));
    try {
      const options = { isPackaged: true, resourcesPath: directory, environment: { SEFIPLAN_API_BASE_URL: 'http://localhost:8000' } };
      expect(await loadCentralConfig(options)).toEqual({ configured: false, reason: 'MISSING_CONFIGURATION' });
      await writeFile(join(directory, 'central.config.json'), JSON.stringify(config));
      expect(await loadCentralConfig(options)).toMatchObject({ configured: true, config: { apiBaseUrl: config.apiBaseUrl } });
      await writeFile(join(directory, 'central.config.json'), 'not json with secret');
      expect(await loadCentralConfig(options)).toEqual({ configured: false, reason: 'INVALID_CONFIGURATION' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('lee archivo de desarrollo explícito, prioriza entorno y lo ignora en paquete', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sefiplan-config-test-'));
    try {
      const path = join(directory, 'development.json');
      await writeFile(path, JSON.stringify(config));
      const options = { isPackaged: false, resourcesPath: directory, developmentConfigPath: path, environment: {} };
      expect(await loadCentralConfig(options)).toMatchObject({ configured: true, config: { apiBaseUrl: config.apiBaseUrl } });
      expect(await loadCentralConfig({ ...options, environment: { SEFIPLAN_API_BASE_URL: 'https://override.example' } }))
        .toMatchObject({ configured: true, config: { apiBaseUrl: 'https://override.example' } });
      expect(await loadCentralConfig({ ...options, isPackaged: true })).toMatchObject({ configured: false });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
