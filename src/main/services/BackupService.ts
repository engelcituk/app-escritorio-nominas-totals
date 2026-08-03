import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import AdmZip from 'adm-zip';

export class BackupService {
  async create(databasePath: string, destinationPath: string): Promise<void> {
    const zip = new AdmZip();
    zip.addLocalFile(databasePath, 'data', 'sefiplan-nomina.sqlite');
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({
      product: 'SEFIPLAN Nómina', version: '0.1.0', database: basename(databasePath), createdAt: new Date().toISOString(),
    }, null, 2), 'utf8'));
    zip.writeZip(destinationPath);
  }

  async extractValidated(archivePath: string, temporaryDirectory: string): Promise<string> {
    const zip = new AdmZip(archivePath);
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
    return databasePath;
  }
}
