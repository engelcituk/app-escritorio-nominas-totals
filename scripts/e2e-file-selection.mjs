/* global document */
import assert from 'node:assert/strict';
import { startCatalogServer } from '../tests/fixtures/catalog-server.mjs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const userDataDirectory = await mkdtemp(join(tmpdir(), 'sefiplan-e2e-'));
const reportDirectory = join(userDataDirectory, 'reportes');
await mkdir(reportDirectory, { recursive: true });
const fixturePath = resolve('tests/fixtures/uniform-isr.txt');
const backend = await startCatalogServer();
const electronApp = await electron.launch({ args: ['.', `--user-data-dir=${userDataDirectory}`, '--disable-gpu', '--isolated-e2e'],
  env: { ...process.env, SEFIPLAN_API_BASE_URL: backend.url, SEFIPLAN_BACKOFFICE_URL: backend.url } });
try {
  const window = await electronApp.firstWindow();
  window.setDefaultTimeout(15000);
  await window.waitForLoadState('domcontentloaded');
  const preloadReady = await window.evaluate(() => typeof window.sefiplanApi?.selectTxtFiles === 'function');
  if (!preloadReady) throw new Error('La API segura del preload no está disponible.');
  await window.getByRole('navigation').getByRole('link', { name: 'Expedientes mensuales', exact: true }).click();
  assert.equal(await window.getByRole('button', { name: 'Seleccionar archivos TXT', exact: true }).isDisabled(), true);
  await window.getByRole('link', { name: 'Sin sesión central', exact: true }).click();
  await window.getByLabel('Correo electrónico', { exact: true }).fill('fixture@example.test');
  await window.getByLabel('Contraseña', { exact: true }).fill('fixture-only');
  await window.getByRole('button', { name: 'Iniciar sesión y registrar equipo', exact: true }).click();
  await window.waitForFunction(async () => (await window.sefiplanApi.catalog.status()).canProcess);
  assert.equal(await window.evaluate(() => ['savePayrollConcept', 'saveConceptGroup', 'savePayrollType', 'addConceptAlias', 'removeConceptAlias'].some(key => key in window.sefiplanApi)), false);
  await window.evaluate(() => { window.location.hash = '#/catalogo-conceptos'; });
  await window.getByRole('button', { name: 'Consultar alias de ISR POR SALARIOS', exact: true }).click();
  await window.getByRole('heading', { name: 'Alias de ISR POR SALARIOS', exact: true }).waitFor();
  const screenshots = resolve('test-results/catalog'); await mkdir(screenshots, { recursive: true });
  await window.screenshot({ path: join(screenshots, 'catalog.png'), fullPage: true });
  await window.setViewportSize({ width: 980, height: 680 });
  assert.equal(await window.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await window.screenshot({ path: join(screenshots, 'catalog-980.png'), fullPage: true });
  await window.setViewportSize({ width: 1440, height: 900 });
  await electronApp.evaluate(({ dialog, shell }, paths) => {
    dialog.showOpenDialog = async (...args) => { const options = args.at(-1); const directory = options?.properties?.includes('openDirectory');
      return { canceled: false, filePaths: [directory ? paths.reportDirectory : paths.fixturePath] }; };
    shell.openPath = async () => '';
  }, { fixturePath, reportDirectory });
  await window.evaluate(async () => {
    const directory = await window.sefiplanApi.selectExportDirectory();
    await window.sefiplanApi.updateSettings({ reports_directory_token: directory.token });
  });
  assert.equal((await window.evaluate(() => window.sefiplanApi.getSettings())).reports_directory, reportDirectory);
  await window.getByRole('navigation').getByRole('link', { name: 'Expedientes mensuales', exact: true }).click();
  if (await window.locator('.monthly-status').count()) throw new Error('La matriz mensual no debe ocupar espacio en el flujo.');
  await window.getByRole('button', { name: 'Abrir reporte mensual', exact: true }).waitFor();
  await window.getByRole('button', { name: 'Seleccionar archivos TXT', exact: true }).click();
  const selectedFilename = await window.getByText('uniform-isr.txt', { exact: true }).first().textContent();
  await window.getByText('Vista previa del primer TXT', { exact: true }).click();
  const previewLayout = await window.evaluate(() => {
    const card = document.querySelector('.file-queue__item')?.getBoundingClientRect();
    const preview = document.querySelector('.preview-list')?.getBoundingClientRect();
    return { cardWidth: Math.round(card?.width ?? 0), previewWidth: Math.round(preview?.width ?? 0) };
  });
  if (!previewLayout.previewWidth || previewLayout.previewWidth < previewLayout.cardWidth * 0.9) {
    throw new Error(`La vista previa no ocupa el ancho del archivo: ${JSON.stringify(previewLayout)}`);
  }
  await window.getByRole('button', { name: /conceptos seleccionados|Elegir conceptos/ }).click();
  await window.getByRole('button', { name: 'Seleccionar visibles', exact: true }).click();
  backend.republish();
  await window.evaluate(() => window.sefiplanApi.catalog.synchronize());
  await window.getByRole('button', { name: 'Reanalizar con el catálogo vigente', exact: true }).waitFor();
  assert.equal(await window.getByRole('button', { name: 'Actualizar expediente', exact: true }).isDisabled(), true);
  await window.getByRole('button', { name: 'Reanalizar con el catálogo vigente', exact: true }).click();
  await window.waitForFunction(() => !document.querySelector('.file-queue__item .badge')?.textContent?.includes('Procesando'));
  backend.state.offline = true;
  const offline = await window.evaluate(() => window.sefiplanApi.auth.check());
  assert.equal(offline.state, 'OFFLINE');
  const offlineCatalog = await window.evaluate(() => window.sefiplanApi.catalog.status());
  assert.equal(offlineCatalog.canProcess, true);
  const measure = () => window.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
  const wideLayout = await measure(); if (wideLayout.document > wideLayout.viewport) throw new Error(`Desbordamiento: ${JSON.stringify(wideLayout)}`);
  await window.setViewportSize({ width: 1024, height: 768 }); const compactLayout = await measure();
  if (compactLayout.document > compactLayout.viewport) throw new Error(`Desbordamiento compacto: ${JSON.stringify(compactLayout)}`);
  await window.getByRole('button', { name: 'Abrir carpeta de reportes', exact: true }).click();
  await window.getByRole('button', { name: 'Actualizar expediente', exact: true }).click();
  await window.getByText('Expediente y reporte mensual actualizados. Sincronización pendiente; consulta la cola de sincronización.', { exact: true }).waitFor({ timeout: 60000 });
  const queued = await window.evaluate(() => window.sefiplanApi.sync.list({ page: 1, pageSize: 25, status: 'all', search: '' }));
  assert.equal(queued.total, 1); assert.equal(queued.items[0].status, 'PENDING'); assert.equal(queued.items[0].attempts, 0);
  assert.equal(queued.items[0].operationType, 'local.result.publish');
  assert.equal('payload_json' in queued.items[0], false);
  await window.evaluate(() => { window.location.hash = '#/sincronizacion'; });
  await window.getByRole('heading', { name: 'Sincronización', exact: true }).waitFor();
  await window.getByRole('button', { name: `Diagnóstico de ${queued.items[0].operationUuid}`, exact: true }).click();
  await window.getByRole('heading', { name: 'Diagnóstico de operación', exact: true }).waitFor();
  assert.equal(await window.getByRole('heading', { name: 'Diagnóstico de operación', exact: true }).evaluate(element => element === document.activeElement), true);
  assert.equal(await window.getByRole('button', { name: `Reintentar ${queued.items[0].operationUuid}`, exact: true }).isDisabled(), true);
  assert.equal((await window.evaluate(() => window.sefiplanApi.sync.status())).state, 'OFFLINE');
  for (const [width, height] of [[1440, 900], [980, 680]]) {
    await window.setViewportSize({ width, height });
    assert.equal(await window.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await window.screenshot({ path: join(screenshots, `outbox-${width}.png`), fullPage: true });
  }
  await window.getByRole('button', { name: 'Cerrar diagnóstico', exact: true }).click();
  assert.equal(await window.getByRole('button', { name: `Diagnóstico de ${queued.items[0].operationUuid}`, exact: true }).evaluate(element => element === document.activeElement), true);
  await window.getByLabel('Estado', { exact: true }).selectOption('CONFLICT');
  await window.getByText('No hay operaciones que coincidan con los filtros.', { exact: true }).waitFor();
  await window.getByLabel('Estado', { exact: true }).selectOption('all');
  await window.getByRole('button', { name: `Diagnóstico de ${queued.items[0].operationUuid}`, exact: true }).waitFor();
  // Real ZIP/SQLite restore through the same IPC used by the backup screen.
  backend.state.offline = false;
  await window.evaluate(() => window.sefiplanApi.auth.check());
  await window.waitForFunction(async () => !(await window.sefiplanApi.catalog.status()).busy);
  const identityBefore = await window.evaluate(() => window.sefiplanApi.auth.status());
  const backupPath = join(userDataDirectory, 'restore-test.zip');
  await electronApp.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, backupPath);
  assert.equal((await window.evaluate(() => window.sefiplanApi.createBackup())).path, backupPath);
  backend.republish(); await window.evaluate(() => window.sefiplanApi.catalog.synchronize());
  const selectedBeforeRestore = await window.evaluate(() => window.sefiplanApi.selectTxtFiles());
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  }, backupPath);
  assert.equal((await window.evaluate(() => window.sefiplanApi.restoreBackup())).restored, true);
  const restoredCatalog = await window.evaluate(() => window.sefiplanApi.catalog.status());
  assert.equal(restoredCatalog.canProcess, false); assert.equal(restoredCatalog.state, 'FIRST_SYNC_REQUIRED');
  assert.equal((await window.evaluate(() => window.sefiplanApi.auth.status())).installationUuid, identityBefore.installationUuid);
  assert.equal(await window.evaluate(async token => {
    try { await window.sefiplanApi.inspectTxtFile({ fileToken: token }); return false; } catch { return true; }
  }, selectedBeforeRestore[0].token), true);
  assert.equal((await window.evaluate(() => window.sefiplanApi.catalog.synchronize())).canProcess, true);
  const restoredQueue = await window.evaluate(() => window.sefiplanApi.sync.list({ page: 1, pageSize: 25, status: 'all', search: '' }));
  const restoredIntent = await window.evaluate(operationUuid => window.sefiplanApi.sync.detail({ operationUuid }), queued.items[0].operationUuid);
  assert.ok(restoredQueue.total >= 1); assert.equal(restoredIntent.operationUuid, queued.items[0].operationUuid);
  assert.ok(['PENDING', 'SYNCED'].includes(restoredIntent.status));
  await window.evaluate(() => window.sefiplanApi.sync.checkConnection());
  const deliveryDeadline = Date.now() + 30000;
  let deliveryConfirmed = false;
  while (Date.now() < deliveryDeadline) {
    await window.evaluate(() => window.sefiplanApi.sync.run());
    if ((await window.evaluate(operationUuid => window.sefiplanApi.sync.detail({ operationUuid }), queued.items[0].operationUuid)).status === 'SYNCED') { deliveryConfirmed = true; break; }
    await window.waitForTimeout(200);
  }
  assert.equal(deliveryConfirmed, true);
  await window.getByRole('button', { name: 'Procesar cola disponible', exact: true }).click();
  const historyButton = window.getByRole('button', { name: 'Consultar expediente central', exact: true });
  await historyButton.click();
  await window.getByRole('heading', { name: /Historial central/ }).waitFor();
  assert.equal(await window.getByRole('heading', { name: /Historial central/ }).evaluate(element => element === document.activeElement), true);
  for (const [width, height] of [[1440, 900], [980, 680]]) {
    await window.setViewportSize({ width, height });
    assert.equal(await window.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await window.screenshot({ path: join(screenshots, `results-history-${width}.png`), fullPage: true });
  }
  await window.getByRole('button', { name: 'Cerrar historial', exact: true }).click();
  assert.equal(await historyButton.evaluate(element => element === document.activeElement), true);
  console.log(JSON.stringify({ backend: 'HTTP contract fixture (not Laravel)', catalogReadOnly: true, staleRevisionReanalyzed: true,
    offlineProcessing: true, outboxDurableIntent: true, outboxRestorePreservesUuid: true, restoreRequiresVerification: true, restorePreservesIdentity: true, preloadReady, selectedFilename, processing: 'completed', monthlyMatrixRemoved: true,
    previewLayout, wideLayout, compactLayout }));
} finally { await electronApp.close(); await backend.close(); await cleanup(userDataDirectory); }

async function cleanup(directory) {
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('sefiplan-e2e-')) throw new Error('Ruta de limpieza no permitida.');
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
