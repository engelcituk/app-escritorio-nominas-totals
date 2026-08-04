/* global document */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const userDataDirectory = await mkdtemp(join(tmpdir(), 'sefiplan-e2e-'));
const reportDirectory = join(userDataDirectory, 'reportes');
await mkdir(reportDirectory, { recursive: true });
const fixturePath = resolve('tests/fixtures/uniform-isr.txt');
const electronApp = await electron.launch({ args: ['.', `--user-data-dir=${userDataDirectory}`] });

try {
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const preloadReady = await window.evaluate(() => typeof window.sefiplanApi?.selectTxtFile === 'function');
  if (!preloadReady) throw new Error('La API segura del preload no está disponible en el Renderer.');

  await electronApp.evaluate(({ dialog, shell }, paths) => {
    dialog.showOpenDialog = async (...args) => {
      const options = args.at(-1);
      const selectingDirectory = options?.properties?.includes('openDirectory');
      return { canceled: false, filePaths: [selectingDirectory ? paths.reportDirectory : paths.fixturePath] };
    };
    shell.openPath = async () => '';
  }, { fixturePath, reportDirectory });

  await window.getByRole('navigation').getByRole('link', { name: 'Nueva importación', exact: true }).click();
  await window.getByRole('button', { name: 'Seleccionar archivo', exact: true }).click();
  await window.getByText('Archivo listo para procesar', { exact: true }).waitFor();
  if (await window.getByText(/UNIFORM_PAYROLL|UTF-8/).count()) throw new Error('La interfaz todavía expone detalles técnicos del layout.');
  const selectedFilename = await window.getByText('uniform-isr.txt', { exact: true }).textContent();
  const measureLayout = () => window.evaluate(() => {
    const frame = document.querySelector('.table-frame');
    return {
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      tableViewportWidth: frame?.clientWidth ?? 0,
      tableContentWidth: frame?.scrollWidth ?? 0,
    };
  });
  const wideLayout = await measureLayout();
  if (wideLayout.documentWidth > wideLayout.viewportWidth) throw new Error(`La ventana tiene desbordamiento horizontal: ${JSON.stringify(wideLayout)}`);
  await window.setViewportSize({ width: 1024, height: 768 });
  const compactLayout = await measureLayout();
  if (compactLayout.documentWidth > compactLayout.viewportWidth) throw new Error(`La ventana compacta tiene desbordamiento horizontal: ${JSON.stringify(compactLayout)}`);
  if (compactLayout.tableContentWidth <= compactLayout.tableViewportWidth) throw new Error('La tabla no conservó su scroll horizontal local.');

  await window.getByRole('button', { name: 'Carpeta de reportes', exact: true }).click();
  await window.getByText(/Los reportes se guardarán en/).waitFor();
  await window.getByRole('button', { name: 'Procesar archivo', exact: true }).click();
  await window.getByText(/Resultado del lote/).waitFor({ timeout: 60000 });
  await window.getByRole('button', { name: 'Abrir carpeta de reportes', exact: true }).click();

  await window.getByRole('button', { name: 'Cambiar archivo', exact: true }).click();
  await window.getByText('Archivo listo para procesar', { exact: true }).waitFor();
  await window.getByRole('button', { name: 'Procesar archivo', exact: true }).click();
  await window.getByText(/Este archivo ya fue procesado/).waitFor({ timeout: 30000 });
  await window.getByRole('button', { name: 'Crear nueva versión', exact: true }).click();
  await window.getByText(/Resultado del lote/).waitFor({ timeout: 60000 });

  console.log(JSON.stringify({ preloadReady, selectedFilename, nativeDialogContract: 'ok', preflight: 'friendly', processing: 'completed', duplicateFeedback: 'visible', duplicateAction: 'completed', wideLayout, compactLayout }));
} finally {
  await electronApp.close();
  await rm(userDataDirectory, { recursive: true, force: true });
}
