export function fortnightsForMonth(month: number): [number, number] {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('El mes no es válido.');
  return [month * 2 - 1, month * 2];
}

export function monthForFortnight(fortnight: number): number {
  if (!Number.isInteger(fortnight) || fortnight < 1 || fortnight > 24) throw new Error('La quincena no es válida.');
  return Math.ceil(fortnight / 2);
}

export function parsePayrollFilename(filename: string): { year: number; fortnight: number; payrollTypeCode: string } | null {
  const match = /^QNA_(\d{1,2})_(\d{4})_(.+)\.txt$/i.exec(filename.trim());
  if (!match) return null;
  const fortnight = Number(match[1]); const year = Number(match[2]);
  if (fortnight < 1 || fortnight > 24 || year < 2000 || year > 2200) return null;
  const payrollTypeCode = match[3]!.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return payrollTypeCode ? { year, fortnight, payrollTypeCode } : null;
}
