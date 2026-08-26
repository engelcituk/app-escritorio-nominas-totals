import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import { reportFilePath, verifyReportFile } from './central/ResultPublicationService.js';

export class BackupService {
  async create(databasePath: string, destinationPath: string, reportDatabasePath = databasePath): Promise<void> {
    const zip = new AdmZip();
    const source = new Database(databasePath, { readonly: true, fileMustExist: true });
    let files: Array<{ sha256: string; size_bytes: number }> = [];
    try { if (source.prepare("SELECT 1 FROM sqlite_master WHERE name='sync_report_files'").get()) files = source.prepare('SELECT DISTINCT sha256,size_bytes FROM sync_report_files').all() as typeof files; }
    finally { source.close(); }
    const total = (await fs.stat(databasePath)).size + files.reduce((sum, file) => sum + file.size_bytes, 0);
    if (total > 256 * 1024 * 1024) throw new Error('El respaldo ZIP supera 256 MiB sin comprimir. Requiere un respaldo administrado de la base y sync-files.');
    for (const file of files) {
      const path = reportFilePath(reportDatabasePath, file.sha256); await verifyReportFile(path, file.sha256, file.size_bytes);
      zip.addLocalFile(path, 'sync-files', `${file.sha256}.xlsx`);
    }
    zip.addLocalFile(databasePath, 'data', 'sefiplan-nomina.sqlite');
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({
      product: 'SEFIPLAN Nómina', version: '0.1.0', database: basename(databasePath), createdAt: new Date().toISOString(),
    }, null, 2), 'utf8'));
    zip.writeZip(destinationPath);
  }

  async extractValidated(archivePath: string, temporaryDirectory: string): Promise<string> {
    if ((await fs.stat(archivePath)).size > 300 * 1024 * 1024) throw new Error('El archivo excede el límite de restauración ZIP.');
    const zip = new AdmZip(archivePath);
    if (zip.getEntries().reduce((sum, entry) => sum + entry.header.size, 0) > 256 * 1024 * 1024) throw new Error('El respaldo excede el límite de restauración ZIP.');
    const manifestEntry = zip.getEntry('manifest.json');
    const databaseEntry = zip.getEntry('data/sefiplan-nomina.sqlite');
    if (!manifestEntry || !databaseEntry) throw new Error('El respaldo no contiene la estructura esperada.');
    let manifest: unknown;
    try { manifest = JSON.parse(manifestEntry.getData().toString('utf8')); } catch { throw new Error('El manifiesto del respaldo no es válido.'); }
    if (!manifest || typeof manifest !== 'object' || (manifest as { product?: string }).product !== 'SEFIPLAN Nómina') {
      throw new Error('El archivo seleccionado no es un respaldo de SEFIPLAN Nómina.');
    }
    const databasePath = join(temporaryDirectory, 'restored.sqlite');
    await fs.writeFile(databasePath, databaseEntry.getData(), { flag: 'wx' });
    for (const entry of zip.getEntries().filter(item => item.entryName.startsWith('sync-files/'))) {
      const match = /^sync-files\/([a-f0-9]{64})\.xlsx$/.exec(entry.entryName);
      if (!match) throw new Error('El respaldo contiene una ruta de reporte inválida.');
      const path = reportFilePath(databasePath, match[1]!); await fs.mkdir(join(temporaryDirectory, 'sync-files'), { recursive: true });
      await fs.writeFile(path, entry.getData(), { flag: 'wx' }); await verifyReportFile(path, match[1]!);
    }
    return databasePath;
  }

  async restoreReportFiles(restoredDatabasePath: string, targetDatabasePath: string): Promise<void> {
    const source = new Database(restoredDatabasePath, { readonly: true, fileMustExist: true });
    try {
      if (!source.prepare("SELECT 1 FROM sqlite_master WHERE name='sync_report_files'").get()) return;
      const files = source.prepare('SELECT DISTINCT sha256,size_bytes FROM sync_report_files').all() as Array<{ sha256: string; size_bytes: number }>;
      for (const file of files) {
        const path = reportFilePath(restoredDatabasePath, file.sha256); await verifyReportFile(path, file.sha256, file.size_bytes);
        const target = reportFilePath(targetDatabasePath, file.sha256); await fs.mkdir(dirname(target), { recursive: true });
        await fs.copyFile(path, target); await verifyReportFile(target, file.sha256, file.size_bytes);
      }
    } finally { source.close(); }
  }
}
