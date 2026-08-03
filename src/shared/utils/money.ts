export function parseAmountToCents(input: string): number | null {
  const raw = input.trim().replace(/\s/g, '');
  if (!raw) return null;

  const negative = raw.startsWith('-');
  const unsigned = raw.replace(/^[+-]/, '');
  let integerPart = '';
  let decimalPart = '';
  let match: RegExpMatchArray | null;
  if ((match = unsigned.match(/^(\d+)$/))) {
    integerPart = match[1] ?? '';
  } else if ((match = unsigned.match(/^(\d+)[.,](\d{1,2})$/))) {
    integerPart = match[1] ?? '';
    decimalPart = match[2] ?? '';
  } else if ((match = unsigned.match(/^(\d{1,3}(?:,\d{3})+)\.(\d{1,2})$/))) {
    integerPart = (match[1] ?? '').replace(/,/g, '');
    decimalPart = match[2] ?? '';
  } else if ((match = unsigned.match(/^(\d{1,3}(?:\.\d{3})+),(\d{1,2})$/))) {
    integerPart = (match[1] ?? '').replace(/\./g, '');
    decimalPart = match[2] ?? '';
  } else return null;

  const value = Number.parseInt(integerPart, 10) * 100 + Number.parseInt(decimalPart.padEnd(2, '0') || '0', 10);
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

export function formatCentsAsDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function formatCentsAsCurrency(cents: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(cents / 100);
}
