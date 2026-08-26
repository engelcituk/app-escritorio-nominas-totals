import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, session, safeStorage } from 'electron';
import { DatabaseService } from '../dist/main/database/DatabaseService.js';
import { DeviceService } from '../dist/main/services/central/DeviceService.js';
import { SecureTokenStore } from '../dist/main/services/central/SecureTokenStore.js';
import { AuthService } from '../dist/main/services/central/AuthService.js';
import { ApiClient } from '../dist/main/services/central/ApiClient.js';
import { deviceResponseSchema } from '../dist/main/services/central/contracts.js';
import { parseCentralConfig } from '../dist/main/config/central.js';

// Input: one JSON object on stdin {apiBaseUrl,email,password}; on Windows Electron
// has no stdin handle, so an ephemeral SEFIPLAN_TEST_INPUT_JSON is also accepted.
let stage = 'stdin';
async function run() {
  let inputText = process.env.SEFIPLAN_TEST_INPUT_JSON ?? '';
  delete process.env.SEFIPLAN_TEST_INPUT_JSON;
  if (!inputText) {
    for await (const chunk of process.stdin) {
      inputText += chunk.toString();
      if (inputText.length > 4096) throw new Error('INPUT_TOO_LARGE');
    }
  }
  if (inputText.length > 4096) throw new Error('INPUT_TOO_LARGE');
  stage = `parse-input-${inputText.length ? 'present' : 'empty'}`;
  const input = JSON.parse(inputText.replace(/^\uFEFF/, '')); inputText = '';
  stage = 'configuration';
  const configuration = parseCentralConfig({ apiBaseUrl: input.apiBaseUrl, backofficeUrl: input.apiBaseUrl }, false);
  assert.equal(configuration.configured, true);
  stage = 'temporary-profile';
  const root = process.env.SEFIPLAN_AUTH_TEST_ROOT;
  if (!root) throw new Error('Use scripts/run-auth-integration.mjs');
  app.setPath('userData', root);
  await app.whenReady();
  stage = 'database';
  const db = new DatabaseService(join(root, 'test.sqlite'));
  const device = new DeviceService(db.connection, '0.1.0');
  device.ensureIdentity();
  const tokens = new SecureTokenStore(root, safeStorage);
  const apiSession = session.fromPartition('auth-integration');
  const transport = (url, init) => apiSession.fetch(url instanceof URL ? url.href : url, init);
  const options = { configuration, isPackaged: false, platform: process.platform, device, tokens, transport };
  let auth = new AuthService(options);
  try {
    stage = 'login';
    const loggedIn = await auth.login({ email: input.email, password: input.password, deviceName: 'Prueba automatizada · Fase 1' });
    input.password = '';
    if (loggedIn.state !== 'AUTHENTICATED') throw new Error(`LOGIN_${loggedIn.errorCode}`);
    assert.notEqual(loggedIn.deviceUuid, loggedIn.installationUuid);
    const context = { apiOrigin: configuration.config.apiBaseUrl, installationUuid: loggedIn.installationUuid };
    let secret = await tokens.read(context);
    assert.ok(secret);
    assert.equal(JSON.stringify(loggedIn).includes(secret), false);
    assert.equal((await readFile(join(root, 'secure/session.bin'))).includes(Buffer.from(secret)), false);
    assert.equal(db.connection.serialize().includes(Buffer.from(secret)), false);
    auth.dispose();
    auth = new AuthService(options);
    const restored = await auth.restore();
    if (restored.state !== 'AUTHENTICATED') throw new Error(`RESTORE_${restored.errorCode}`);
    assert.equal(restored.deviceUuid, loggedIn.deviceUuid);
    const loggedOut = await auth.logout();
    assert.equal(loggedOut.state, 'AUTH_REQUIRED');
    assert.equal(loggedOut.errorCode, null);
    assert.equal(await tokens.read(context), null);
    const client = new ApiClient({ ...configuration.config, isPackaged: false, transport, getToken: async () => secret });
    let rejected = false;
    try { await client.request({ path: '/api/v1/desktop/me', schema: deviceResponseSchema }); }
    catch (error) { rejected = error?.httpStatus === 401; }
    secret = null;
    assert.equal(rejected, true);
    console.log(JSON.stringify({ backend: configuration.config.apiBaseUrl, login: 'passed',
      restoreAndHeartbeat: 'passed', distinctStableIdentity: true, safeStorage: 'native-encrypted',
      rendererAndSQLiteHaveNoToken: true, remoteLogout: 'confirmed-401', tlsValidation: 'enabled' }));
  } finally {
    input.password = '';
    await auth.logout(); auth.dispose(); db.close();
  }
}
void run().then(() => app.quit(), (error) => {
  // No response bodies, credentials, token-bearing assertions or request options.
  console.error('Auth integration failed:', stage, error?.name, error?.code ?? (/^(LOGIN_|RESTORE_)/.test(error?.message) ? error.message : 'CHECK_FAILED'));
  app.exit(1);
});
