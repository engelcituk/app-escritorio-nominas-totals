/* global document, window */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

let stage = 'input';
async function run() {
  let inputText = process.env.SEFIPLAN_TEST_INPUT_JSON ?? '';
  delete process.env.SEFIPLAN_TEST_INPUT_JSON;
  if (!inputText) for await (const chunk of process.stdin) { inputText += chunk.toString(); if (inputText.length > 4096) throw new Error('Invalid input'); }
  const input = JSON.parse(inputText.replace(/^\uFEFF/, '')); inputText = '';
  const root = await mkdtemp(join(tmpdir(), 'sefiplan-auth-e2e-'));
  const screenshots = resolve('test-results/auth');
  await mkdir(screenshots, { recursive: true });
  let app;
  let catalogRevision;
  let catalogEvidence;
  const launch = () => electron.launch({ args: ['.', `--user-data-dir=${root}`, '--disable-gpu', '--isolated-e2e'],
    env: { ...process.env, SEFIPLAN_API_BASE_URL: input.apiBaseUrl } });
  try {
    stage = 'launch'; app = await launch();
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
    await page.getByLabel('Nombre del equipo', { exact: true }).fill(input.catalog ? 'Prueba UI · Fase 2' : 'Prueba UI · Fase 1');
    stage = 'login';
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
    if (input.catalog) {
      stage = 'catalog-first-sync';
      await page.waitForFunction(async () => { const status = await window.sefiplanApi.catalog.status(); return status.canProcess && !status.busy; }, null, { timeout: 30000 });
      catalogRevision = (await page.evaluate(() => window.sefiplanApi.catalog.status())).revision;
      assert.equal(await page.evaluate(() => ['savePayrollConcept', 'saveConceptGroup', 'savePayrollType', 'addConceptAlias', 'removeConceptAlias'].some(key => key in window.sefiplanApi)), false);
      const concepts = await page.evaluate(() => window.sefiplanApi.catalog.list({ entity: 'concepts', page: 1, pageSize: 25, search: '', filter: 'active' }));
      assert.ok(concepts.total > 0);
      assert.ok(concepts.items.every(item => item.uuid && item.mappingStatus === 'MAPPED'));
      await page.evaluate(() => { window.location.hash = '#/catalogo-conceptos'; });
      const aliasButton = page.getByRole('button', { name: /^Consultar alias de / }).first();
      await aliasButton.click();
      await page.getByRole('heading', { name: /^Alias de / }).waitFor();
      for (const [width, height] of [[1440, 900], [980, 680]]) {
        await page.setViewportSize({ width, height });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
        await page.screenshot({ path: join(screenshots, `real-catalog-${width}.png`), fullPage: true });
      }
      catalogEvidence = { source: 'real-Laravel', revision: catalogRevision, activeConcepts: concepts.total, readOnly: true };
    }
    stage = 'restart';
    await app.close(); app = undefined;
    app = await launch(); page = await app.firstWindow();
    await page.getByRole('link', { name: 'Sesión central activa', exact: true }).waitFor({ timeout: 25000 });
    const restored = await page.evaluate(() => window.sefiplanApi.auth.status());
    assert.equal(restored.deviceUuid, status.deviceUuid);
    if (input.catalog) {
      stage = 'catalog-restored';
      await page.waitForFunction(async () => { const status = await window.sefiplanApi.catalog.status(); return status.canProcess && !status.busy; }, null, { timeout: 30000 });
      assert.equal((await page.evaluate(() => window.sefiplanApi.catalog.status())).revision, catalogRevision);
      stage = 'catalog-offline-processing';
      const reportDirectory = join(root, 'reports'); await mkdir(reportDirectory);
      await app.evaluate(({ dialog, shell, session }, paths) => {
        dialog.showOpenDialog = async (...args) => ({ canceled: false, filePaths: [args.at(-1)?.properties?.includes('openDirectory') ? paths.reportDirectory : paths.fixturePath] });
        shell.openPath = async () => '';
        // Local request cancellation only; never changes the Laravel server.
        session.fromPartition('central-api').webRequest.onBeforeRequest({ urls: [`${paths.origin}/api/v1/*`] }, (_details, callback) => callback({ cancel: true }));
      }, { reportDirectory, fixturePath: resolve('tests/fixtures/uniform-isr.txt'), origin: new URL(input.apiBaseUrl).origin });
      assert.equal((await page.evaluate(() => window.sefiplanApi.auth.check())).state, 'OFFLINE');
      assert.equal((await page.evaluate(() => window.sefiplanApi.catalog.status())).canProcess, true);
      await page.evaluate(async () => {
        const directory = await window.sefiplanApi.selectExportDirectory();
        await window.sefiplanApi.updateSettings({ reports_directory_token: directory.token });
      });
      assert.equal((await page.evaluate(() => window.sefiplanApi.getSettings())).reports_directory, reportDirectory);
      await page.getByRole('navigation').getByRole('link', { name: 'Expedientes mensuales', exact: true }).click();
      // Dedicated future development period; no current payroll is replaced.
      stage = 'results-select-period';
      await page.locator('.period-workspace input[type=number]').fill('2099');
      await page.locator('.period-workspace select').first().selectOption('12');
      await page.getByRole('button', { name: 'Seleccionar archivos TXT', exact: true }).waitFor();
      stage = 'results-select-file';
      await page.getByRole('button', { name: 'Seleccionar archivos TXT', exact: true }).click();
      await page.getByRole('button', { name: /conceptos seleccionados|Elegir conceptos/ }).click();
      await page.getByRole('button', { name: 'Seleccionar visibles', exact: true }).click();
      stage = 'results-local-process';
      await page.getByRole('button', { name: 'Actualizar expediente', exact: true }).click();
      await page.getByText('Expediente y reporte mensual actualizados. Sincronización pendiente; consulta la cola de sincronización.', { exact: true }).waitFor({ timeout: 60000 });
      const queue = await page.evaluate(() => window.sefiplanApi.sync.list({ page: 1, pageSize: 25, status: 'all', search: '' }));
      stage = 'results-local-capture';
      if (queue.items.some(row => row.status !== 'PENDING')) console.error(JSON.stringify(queue.items.map(row => ({ type: row.operationType, status: row.status, code: row.errorCode }))));
      assert.equal(queue.total, 1); assert.equal(queue.items[0].status, 'PENDING'); assert.equal(queue.items[0].attempts, 0);
      const reports = (await readdir(reportDirectory, { recursive: true })).filter(path => path.endsWith('.xlsx'));
      assert.ok(reports.length >= 2);
      for (const path of reports) assert.ok((await stat(join(reportDirectory, path))).size > 0);
      await page.screenshot({ path: join(screenshots, 'real-catalog-offline-processing.png'), fullPage: true });
      catalogEvidence = { ...catalogEvidence, restored: true, offlineProcessing: true, excelFiles: reports.length, durablePendingIntent: true };
      await app.evaluate(({ session }) => session.fromPartition('central-api').webRequest.onBeforeRequest(null));
      assert.equal((await page.evaluate(() => window.sefiplanApi.auth.check())).state, 'AUTHENTICATED');
      stage = 'results-delivery';
      await waitForDelivery(page, queue.items[0].operationUuid).catch(async () => {
        const rows = await page.evaluate(() => window.sefiplanApi.sync.list({ page: 1, pageSize: 25, status: 'all', search: '' }));
        console.error(JSON.stringify(rows.items.map(row => ({ type: row.operationType, status: row.status, code: row.errorCode }))));
        throw new Error('Result delivery not confirmed');
      });
      const delivered = await page.evaluate(() => window.sefiplanApi.sync.list({ page: 1, pageSize: 25, status: 'all', search: '' }));
      stage = 'results-delivered-counts';
      console.log(JSON.stringify({ deliveryCheck: { total: delivered.total, operations: delivered.items.map(row => ({ type: row.operationType, status: row.status, code: row.errorCode })) } }));
      assert.equal(delivered.total, 5); assert.ok(delivered.items.every(row => row.status === 'SYNCED'));
      const recOperation = delivered.items.find(row => row.operationType === 'reconciliation.upsert');
      stage = 'results-remote-history';
      const remote = await page.evaluate(operationUuid => window.sefiplanApi.sync.remoteHistory({ operationUuid }), recOperation.operationUuid);
      stage = 'results-remote-period';
      assert.equal(remote.year, 2099); assert.equal(remote.month, 12); assert.ok(remote.batches.length >= 1);
      assert.equal(remote.batches.filter(batch => batch.active).length, 1);
      stage = 'results-history-ui';
      await page.evaluate(() => { window.location.hash = '#/sincronizacion'; });
      await page.getByRole('button', { name: 'Consultar expediente central', exact: true }).click();
      await page.getByRole('heading', { name: /Historial central/ }).waitFor();
      for (const [width, height] of [[1440, 900], [980, 680]]) {
        await page.setViewportSize({ width, height });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
        await page.screenshot({ path: join(screenshots, `results-history-${width}.png`), fullPage: true });
      }
      stage = 'outbox-restart';
      const queuedDetail = await page.evaluate(operationUuid => window.sefiplanApi.sync.detail({ operationUuid }), queue.items[0].operationUuid);
      await app.close(); app = undefined; app = await launch(); page = await app.firstWindow();
      await page.getByRole('link', { name: 'Sesión central activa', exact: true }).waitFor({ timeout: 25000 });
      const restoredIntent = await page.evaluate(operationUuid => window.sefiplanApi.sync.detail({ operationUuid }), queuedDetail.operationUuid);
      assert.equal(restoredIntent.payloadHashSha256, queuedDetail.payloadHashSha256); assert.equal(restoredIntent.status, 'SYNCED'); assert.equal(restoredIntent.attempts, 0);
      assert.equal((await page.evaluate(() => window.sefiplanApi.sync.list({ page: 1, pageSize: 25, status: 'all', search: '' }))).total, 5);
      catalogEvidence.results = { published: true, reportsAvailable: 2, remoteHistory: true, noDuplicateOnRestart: true, testPeriod: '2099-12' };
      catalogEvidence.outboxRestartPreservesIdentity = true;
    }
    stage = 'logout';
    await page.getByRole('link', { name: 'Sesión central activa', exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await page.getByRole('button', { name: 'Sí, cerrar sesión', exact: true }).click();
    await page.getByRole('link', { name: 'Sin sesión central', exact: true }).waitFor({ timeout: 25000 });
    const loggedOut = await page.evaluate(() => window.sefiplanApi.auth.status());
    assert.equal(loggedOut.errorCode, null);
    await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
    assert.equal(await page.getByLabel('Contraseña', { exact: true }).inputValue(), '');
    console.log(JSON.stringify({ login: 'real-Laravel', processRestart: 'restored', logout: 'confirmed',
      passwordCleared: true, dtoHasNoSecrets: true, keyboardTab: 'passed', layouts, screenshots, ...(catalogEvidence ? { catalog: catalogEvidence } : {}) }));
  } finally {
    input.password = '';
    if (app) {
      try { await app.evaluate(({ session }) => session.fromPartition('central-api').webRequest.onBeforeRequest(null)); } catch { /* Best effort cleanup only. */ }
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
async function waitForDelivery(page, operationUuid) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await page.evaluate(() => window.sefiplanApi.sync.run());
    const row = await page.evaluate(uuid => window.sefiplanApi.sync.detail({ operationUuid: uuid }), operationUuid);
    if (row.status === 'SYNCED') return;
    const rows = await page.evaluate(() => window.sefiplanApi.sync.list({ page: 1, pageSize: 25, status: 'all', search: '' }));
    if (rows.items.some(item => ['FAILED', 'CONFLICT'].includes(item.status))) throw new Error('Blocked delivery');
    await page.waitForTimeout(250);
  }
  throw new Error('Delivery timeout');
}
// Playwright failures may quote form input. Deliberately never print raw exceptions.
await run().catch(() => { console.error(`Auth UI verification failed at ${stage}; no credentials or raw browser errors were logged.`); process.exitCode = 1; });
