import { createReadStream, promises as fs } from 'node:fs';
import { createInterface } from 'node:readline';
import { extname } from 'node:path';
import { UNIFORM_PAYROLL_LAYOUT, mapUniformColumns } from '../../shared/payroll-layouts/uniformPayrollLayout.js';
import type { PreflightResult, PreviewRecord, SelectedFile } from '../../shared/types/payroll.js';
import { parseAmountToCents } from '../../shared/utils/money.js';

export async function inspectPayrollFile(filePath: string, selected: SelectedFile, sampleLimit = 20): Promise<PreflightResult> {
  const stat = await fs.stat(filePath);
  const errors: string[] = [];
  const warnings: string[] = [];
  const preview: PreviewRecord[] = [];
  let dominantColumns = 0;

  if (extname(filePath).toLowerCase() !== '.txt') errors.push('Selecciona un archivo con extensión .txt.');
  if (stat.size === 0) errors.push('El archivo seleccionado está vacío.');

  if (stat.size > 0) {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const reader = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const rawLine of reader) {
      lineNumber += 1;
      if (!rawLine.trim()) continue;
      const columns = rawLine.split('|');
      dominantColumns ||= columns.length;
      const rowErrors: string[] = [];
      if (!rawLine.includes('|')) rowErrors.push('No contiene el separador |.');
      if (columns.length !== UNIFORM_PAYROLL_LAYOUT.expectedColumns) rowErrors.push(`Se esperaban ${UNIFORM_PAYROLL_LAYOUT.expectedColumns} columnas.`);
      const mapped = mapUniformColumns(columns);
      const amountCents = parseAmountToCents(mapped.amountRaw);
      if (amountCents === null) rowErrors.push('El importe no es válido.');
      if (!mapped.conceptCode) rowErrors.push('Falta el código de concepto.');
      if (!mapped.accountCode) rowErrors.push('Falta la cuenta contable.');
      if (!mapped.movementType) rowErrors.push('Falta el tipo de movimiento.');
      preview.push({ lineNumber, ...mapped, amountCents, valid: rowErrors.length === 0, errors: rowErrors });
      if (preview.length >= sampleLimit) break;
    }
    reader.close();
    stream.destroy();
  }

  const validCount = preview.filter((row) => row.valid).length;
  const validPercentage = preview.length ? Math.round((validCount / preview.length) * 10000) / 100 : 0;
  if (preview.length === 0 && stat.size > 0) errors.push('El archivo no contiene líneas con información.');
  if (validPercentage < 95 && preview.length > 0) {
    errors.push('El archivo no coincide con la estructura esperada. Revisa que corresponda al archivo oficial de nómina y que no haya sido modificado.');
  }
  if (preview.some((row) => row.conceptDescriptionOriginal.includes('\uFFFD'))) warnings.push('La muestra contiene caracteres que no pudieron interpretarse como UTF-8.');

  return {
    file: selected,
    delimiter: '|',
    columnCount: dominantColumns,
    layoutCode: UNIFORM_PAYROLL_LAYOUT.code,
    layoutVersion: UNIFORM_PAYROLL_LAYOUT.version,
    encoding: 'UTF-8',
    sampleSize: preview.length,
    validPercentage,
    canProcess: errors.length === 0 && validPercentage >= 95,
    preview,
    errors,
    warnings,
  };
}
