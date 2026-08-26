/* global document, window */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

async function run() {
  let inputText = process.env.SEFIPLAN_TEST_INPUT_JSON ?? '';
  delete process.env.SEFIPLAN_TEST_INPUT_JSON;
  if (!inputText) for await (const chunk of process.stdin) { inputText += chunk.toString(); if (inputText.length > 4096) throw new Error('Invalid input'); }
  const input = JSON.parse(inputText.replace(/^\uFEFF/, '')); inputText = '';
  const root = await mkdtemp(join(tmpdir(), 'sefiplan-auth-e2e-'));
  const screenshots = resolve('test-results/auth');
  await mkdir(screenshots, { recursive: true });
  let app;
  const launch = () => electron.launch({ args: ['.', `--user-data-dir=${root}`, '--disable-gpu', '--isolated-e2e'],
    env: { ...process.env, SEFIPLAN_API_BASE_URL: input.apiBaseUrl } });
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.getByRole('link', { name: 'Sin sesión central', exact: true }).click();
    await page.getByLabel('Correo electrónico', { exact: true }).waitFor();
    await page.screenshot({ path: join(screenshots, 'login.png'), fullPage: true });
    const layouts = [];
    for (const [width, height] of [[1440, 900], [980, 680]]) {
      await page.setViewportSize({ width, height });
      layouts.push(await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth })));
    }
    assert.ok(layouts.every((item) => item.content <= item.viewport));
    await page.getByLabel('Correo electrónico', { exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.getByLabel('Contraseña', { exact: true }).evaluate((element) => element === document.activeElement), true);
    await page.getByLabel('Correo electrónico', { exact: true }).fill(input.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(input.password);
    await page.getByLabel('Nombre del equipo', { exact: true }).fill('Prueba UI · Fase 1');
    await page.getByRole('button', { name: 'Iniciar sesión y registrar equipo', exact: true }).click();
    input.password = '';
    await page.getByRole('heading', { name: 'Sesión institucional', exact: true }).waitFor({ timeout: 25000 });
    assert.equal(await page.locator('input[type=password]').count(), 0);
    const status = await page.evaluate(() => window.sefiplanApi.auth.status());
    assert.equal(status.state, 'AUTHENTICATED');
    assert.equal(Object.keys(status).some((key) => /token|password|abilities/i.test(key)), false);
    await page.screenshot({ path: join(screenshots, 'session-980.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: join(screenshots, 'session.png'), fullPage: true });
    await app.close(); app = undefined;
    app = await launch(); page = await app.firstWindow();
    await page.getByRole('link', { name: 'Sesión central activa', exact: true }).waitFor({ timeout: 25000 });
    const restored = await page.evaluate(() => window.sefiplanApi.auth.status());
    assert.equal(restored.deviceUuid, status.deviceUuid);
    await page.getByRole('link', { name: 'Sesión central activa', exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await page.getByRole('button', { name: 'Sí, cerrar sesión', exact: true }).click();
    await page.getByRole('link', { name: 'Sin sesión central', exact: true }).waitFor({ timeout: 25000 });
    const loggedOut = await page.evaluate(() => window.sefiplanApi.auth.status());
    assert.equal(loggedOut.errorCode, null);
    await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
    assert.equal(await page.getByLabel('Contraseña', { exact: true }).inputValue(), '');
    console.log(JSON.stringify({ login: 'real-Laravel', processRestart: 'restored', logout: 'confirmed',
      passwordCleared: true, dtoHasNoSecrets: true, keyboardTab: 'passed', layouts, screenshots }));
  } finally {
    input.password = '';
    if (app) {
      try { const page = await app.firstWindow(); await page.evaluate(() => window.sefiplanApi.auth.logout()); } catch { /* Best effort cleanup only. */ }
      await app.close();
    }
    await cleanup(root);
  }
}
async function cleanup(root) {
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('sefiplan-auth-e2e-')) throw new Error('Unsafe cleanup');
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
// Playwright failures may quote form input. Deliberately never print raw exceptions.
await run().catch(() => { console.error('Auth UI verification failed; no credentials or raw browser errors were logged.'); process.exitCode = 1; });
