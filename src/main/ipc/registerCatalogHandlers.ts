import { dialog, type BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { catalogConflictQuerySchema, catalogDetailSchema, catalogQuerySchema } from '../../shared/schemas/catalog.js';
import type { CatalogRepository } from '../services/central/CatalogRepository.js';
import type { CatalogSyncService } from '../services/central/CatalogSyncService.js';
import { trustedHandler } from './trustedSender.js';

export function registerCatalogHandlers(windowProvider: () => BrowserWindow | null, catalog: CatalogSyncService,
  withRepository: <T>(action: (repository: CatalogRepository) => T) => T): void {
  const handle = trustedHandler(windowProvider);
  handle('catalog:status', () => catalog.getStatus());
  handle('catalog:synchronize', () => catalog.synchronize());
  handle('catalog:list', (_event, raw) => {
    const parsed = catalogQuerySchema.safeParse(raw);
    if (!parsed.success) throw new Error('La consulta de catálogo no es válida.');
    return withRepository((repository) => repository.page(parsed.data));
  });
  handle('catalog:aliases', (_event, raw) => {
    const parsed = catalogDetailSchema.safeParse(raw);
    if (!parsed.success) throw new Error('La consulta de aliases no es válida.');
    return withRepository((repository) => repository.aliases(parsed.data.id, parsed.data.page));
  });
  handle('catalog:conflicts', (_event, raw) => {
    const parsed = catalogConflictQuerySchema.safeParse(raw);
    if (!parsed.success) throw new Error('La consulta de diagnóstico no es válida.');
    return withRepository((repository) => repository.conflicts(parsed.data.page));
  });
  handle('catalog:export-conflicts', async () => {
    const chosen = await dialog.showSaveDialog(windowProvider()!, { title: 'Exportar diagnóstico del catálogo',
      defaultPath: 'diagnostico-catalogo.json', filters: [{ name: 'Diagnóstico JSON', extensions: ['json'] }] });
    if (chosen.canceled || !chosen.filePath) return null;
    const content = withRepository(repository => repository.exportDiagnostics());
    await writeFile(chosen.filePath, content, 'utf8');
    return { path: chosen.filePath };
  });
}
