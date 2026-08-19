/* global document */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const userDataDirectory = await mkdtemp(join(tmpdir(), 'sefiplan-e2e-'));
const reportDirectory = join(userDataDirectory, 'reportes');
await mkdir(reportDirectory, { recursive: true });
const fixturePath = resolve('tests/fixtures/uniform-isr.txt');
const electronApp = await electron.launch({ args: ['.', `--user-data-dir=${userDataDirectory}`, '--disable-gpu', '--isolated-e2e'] });
try {
  const window = await electronApp.firstWindow();
  window.setDefaultTimeout(15000);
  await window.waitForLoadState('domcontentloaded');
  const preloadReady = await window.evaluate(() => typeof window.sefiplanApi?.selectTxtFiles === 'function');
  if (!preloadReady) throw new Error('La API segura del preload no está disponible.');
  await electronApp.evaluate(({ dialog, shell }, paths) => {
    dialog.showOpenDialog = async (...args) => { const options = args.at(-1); const directory = options?.properties?.includes('openDirectory');
      return { canceled: false, filePaths: [directory ? paths.reportDirectory : paths.fixturePath] }; };
    shell.openPath = async () => '';
  }, { fixturePath, reportDirectory });
  await window.getByRole('navigation').getByRole('link', { name: 'Expedientes mensuales', exact: true }).click();
  const monthlyStatus = window.locator('details.monthly-status');
  await monthlyStatus.waitFor();
  if (await monthlyStatus.evaluate((element) => element.open)) throw new Error('La matriz mensual debe iniciar contraída.');
  await monthlyStatus.locator('summary').click();
  await monthlyStatus.getByRole('table').waitFor();
  await monthlyStatus.locator('summary').click();
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
  await window.getByRole('button', { name: /conceptos seleccionados|Seleccionar conceptos|Seleccionar mientras se analiza/ }).click();
  await window.getByRole('button', { name: 'Seleccionar visibles', exact: true }).click();
  const measure = () => window.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
  const wideLayout = await measure(); if (wideLayout.document > wideLayout.viewport) throw new Error(`Desbordamiento: ${JSON.stringify(wideLayout)}`);
  await window.setViewportSize({ width: 1024, height: 768 }); const compactLayout = await measure();
  if (compactLayout.document > compactLayout.viewport) throw new Error(`Desbordamiento compacto: ${JSON.stringify(compactLayout)}`);
  await window.getByRole('button', { name: 'Carpeta de reportes', exact: true }).click();
  await window.getByRole('button', { name: 'Actualizar expediente', exact: true }).click();
  await window.getByText('Expediente y reporte mensual actualizados.', { exact: true }).waitFor({ timeout: 60000 });
  console.log(JSON.stringify({ preloadReady, selectedFilename, processing: 'completed', monthlyMatrixCollapsed: true,
    previewLayout, wideLayout, compactLayout }));
} finally { await electronApp.close(); await rm(userDataDirectory, { recursive: true, force: true }); }
