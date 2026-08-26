import { join } from 'node:path';
import { createHash } from 'node:crypto';

/** Preserve established filenames; never interpolate arbitrary remote codes into paths. */
export function catalogPathSegment(code: string): string {
  if (/^[A-Z0-9_]{1,80}$/.test(code) && !/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/.test(code)) return code;
  // '~' separates this namespace from the legacy uppercase/underscore codes.
  return `central~${createHash('sha256').update(code, 'utf8').digest('hex')}`;
}

export function getMonthlyReportDirectory(rootDirectory: string, year: number, month: number, conceptGroupCode: string): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error('El año del reporte no es válido.');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('El mes del reporte no es válido.');
  return join(rootDirectory, String(year), `M${String(month).padStart(2, '0')}`, catalogPathSegment(conceptGroupCode));
}
