import { promises as fs } from 'node:fs';
import { extname } from 'node:path';
import { UNIFORM_PAYROLL_LAYOUT } from '../../shared/payroll-layouts/uniformPayrollLayout.js';
import type { DetectedConcept, PreflightResult, PreviewRecord, SelectedFile } from '../../shared/types/payroll.js';
import { parseAmountToCents } from '../../shared/utils/money.js';
import { parsePayrollFilename } from '../../shared/utils/payrollPeriod.js';
import { ConceptMatcher, type ConceptMatchRule } from './ConceptMatcher.js';
import { calculateFileSha256 } from './FileHashService.js';
import { TxtStreamParser } from './TxtStreamParser.js';

interface InventoryItem {
  sourceDescription: string; normalizedDescription: string; conceptCodes: Set<string>; movementTypes: Set<string>;
  recordCount: number; originalAmountCents: number; rule: ConceptMatchRule | null;
}

export async function inspectPayrollFile(filePath: string, selected: SelectedFile, includePreview = true,
  rules: readonly ConceptMatchRule[] = [], historicalDuplicateBatchId: number | null = null): Promise<PreflightResult> {
  const stat = await fs.stat(filePath);
  const errors: string[] = [];
  const warnings: string[] = [];
  const preview: PreviewRecord[] = [];
  const inventory = new Map<string, InventoryItem>();
  const matcher = new ConceptMatcher(rules);
  let dominantColumns = 0; let totalLines = 0; let validCount = 0;

  if (extname(filePath).toLowerCase() !== '.txt') errors.push('Selecciona un archivo con extensión .txt.');
  if (stat.size === 0) errors.push('El archivo seleccionado está vacío.');
  const fileHashSha256 = stat.size ? await calculateFileSha256(filePath) : '';

  for await (const item of new TxtStreamParser().parse(filePath)) {
    totalLines += 1;
    dominantColumns ||= item.rawLine.split('|').length;
    if (!item.record) continue;
    const amountCents = parseAmountToCents(item.record.amountRaw);
    const rowErrors: string[] = [];
    if (amountCents === null) rowErrors.push('El importe no es válido.');
    if (!item.record.conceptCode) rowErrors.push('Falta el código de concepto.');
    if (!item.record.movementType) rowErrors.push('Falta el tipo de movimiento.');
    if (!item.error && rowErrors.length === 0) validCount += 1;
    if (includePreview && preview.length < 20) preview.push({ ...item.record, amountCents, valid: rowErrors.length === 0, errors: rowErrors });

    const classification = matcher.classify(item.record);
    const key = classification.normalized;
    const foundRule = classification.matched ? { aliasId: classification.aliasId!, conceptId: classification.conceptId!,
      conceptCode: classification.conceptCode!, conceptName: classification.conceptName!, groupId: classification.groupId ?? null,
      groupCode: classification.groupCode ?? null, groupName: classification.groupName ?? null,
      operationFactor: classification.operationFactor ?? 1, normalizedDescription: classification.normalized } : null;
    const current = inventory.get(key) ?? { sourceDescription: item.record.conceptDescriptionOriginal,
      normalizedDescription: key, conceptCodes: new Set<string>(), movementTypes: new Set<string>(), recordCount: 0,
      originalAmountCents: 0, rule: foundRule };
    current.conceptCodes.add(item.record.conceptCode); current.movementTypes.add(item.record.movementType);
    current.recordCount += 1; current.originalAmountCents += amountCents ?? 0; inventory.set(key, current);
  }

  const validPercentage = totalLines ? Math.round((validCount / totalLines) * 10000) / 100 : 0;
  if (totalLines === 0 && stat.size > 0) errors.push('El archivo no contiene líneas con información.');
  if (validPercentage < 95 && totalLines > 0) errors.push('El archivo no coincide con la estructura esperada. Revisa que corresponda al archivo oficial de nómina.');
  if (preview.some((row) => row.conceptDescriptionOriginal.includes('\uFFFD'))) warnings.push('La muestra contiene caracteres que no pudieron interpretarse como UTF-8.');
  if (historicalDuplicateBatchId) warnings.push(`Este contenido ya fue procesado en el lote ${historicalDuplicateBatchId}.`);

  const detectedConcepts: DetectedConcept[] = [...inventory.entries()].map(([key, item]) => ({ key,
    sourceDescription: item.sourceDescription, normalizedDescription: item.normalizedDescription,
    conceptCodes: [...item.conceptCodes], movementTypes: [...item.movementTypes], recordCount: item.recordCount,
    originalAmountCents: item.originalAmountCents, catalogConcept: item.rule ? { id: item.rule.conceptId, code: item.rule.conceptCode,
      name: item.rule.conceptName, groupId: item.rule.groupId, groupName: item.rule.groupName, operationFactor: item.rule.operationFactor === -1 ? -1 as const : 1 as const,
      active: true } : null })).sort((a, b) => a.sourceDescription.localeCompare(b.sourceDescription, 'es'));

  const filename = parsePayrollFilename(selected.name);
  return { file: selected, fileHashSha256, historicalDuplicateBatchId, delimiter: '|', columnCount: dominantColumns,
    layoutCode: UNIFORM_PAYROLL_LAYOUT.code, layoutVersion: UNIFORM_PAYROLL_LAYOUT.version, encoding: 'UTF-8', totalLines,
    sampleSize: preview.length, validPercentage, canProcess: errors.length === 0 && validPercentage >= 95,
    preview, detectedConcepts, errors, warnings, suggestedYear: filename?.year ?? null,
    suggestedFortnight: filename?.fortnight ?? null, suggestedPayrollTypeCode: filename?.payrollTypeCode ?? null };
}
