/* global document */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const userDataDirectory = await mkdtemp(join(tmpdir(), 'sefiplan-e2e-'));
const reportDirectory = join(userDataDirectory, 'reportes');
await mkdir(reportDirectory, { recursive: true });
const fixturePath = resolve('tests/fixtures/uniform-isr.txt');
const electronApp = await electron.launch({ args: ['.', `--user-data-dir=${userDataDirectory}`, '--disable-gpu'] });
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
  await window.getByRole('navigation').getByRole('link', { name: 'Nueva importación', exact: true }).click();
  await window.getByRole('button', { name: 'Seleccionar archivos TXT', exact: true }).click();
  const selectedFilename = await window.getByText('uniform-isr.txt', { exact: true }).first().textContent();
  await window.getByRole('button', { name: /Seleccionar conceptos/ }).click();
  await window.getByRole('button', { name: 'Seleccionar visibles', exact: true }).click();
  const measure = () => window.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
  const wideLayout = await measure(); if (wideLayout.document > wideLayout.viewport) throw new Error(`Desbordamiento: ${JSON.stringify(wideLayout)}`);
  await window.setViewportSize({ width: 1024, height: 768 }); const compactLayout = await measure();
  if (compactLayout.document > compactLayout.viewport) throw new Error(`Desbordamiento compacto: ${JSON.stringify(compactLayout)}`);
  await window.getByRole('button', { name: 'Carpeta de reportes', exact: true }).click();
  await window.getByRole('button', { name: 'Procesar expediente', exact: true }).click();
  await window.getByText(/Expediente \d+/).waitFor({ timeout: 60000 });
  await window.getByRole('button', { name: 'Abrir reportes', exact: true }).click();
  console.log(JSON.stringify({ preloadReady, selectedFilename, processing: 'completed', wideLayout, compactLayout }));
} finally { await electronApp.close(); await rm(userDataDirectory, { recursive: true, force: true }); }
