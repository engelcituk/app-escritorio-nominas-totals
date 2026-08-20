import { join } from 'node:path';

export function getMonthlyReportDirectory(rootDirectory: string, year: number, month: number, conceptGroupCode: string): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error('El año del reporte no es válido.');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('El mes del reporte no es válido.');
  if (!/^[A-Z0-9_]+$/.test(conceptGroupCode)) throw new Error('El grupo de conceptos del reporte no es válido.');
  return join(rootDirectory, String(year), `M${String(month).padStart(2, '0')}`, conceptGroupCode);
}
