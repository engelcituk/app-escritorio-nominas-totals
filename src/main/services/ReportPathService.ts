import { join } from 'node:path';

export function getPeriodReportDirectory(rootDirectory: string, year: number, fortnight: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error('El año del reporte no es válido.');
  if (!Number.isInteger(fortnight) || fortnight < 1 || fortnight > 24) throw new Error('La quincena del reporte no es válida.');
  return join(rootDirectory, String(year), `Q${String(fortnight).padStart(2, '0')}`);
}
