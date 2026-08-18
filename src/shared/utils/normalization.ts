export function normalizeConceptDescription(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function canonicalConceptName(value: string): string {
  return normalizeConceptDescription(value).replace(/\bI\s+S\s+R\b/g, 'ISR');
}

export function comparisonText(value: string): string {
  return normalizeConceptDescription(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function canonicalizeConceptDescription(value: string): string {
  return comparisonText(canonicalConceptName(value));
}
