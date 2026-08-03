import { describe, expect, it } from 'vitest';
import { formatCentsAsDecimal, parseAmountToCents } from '../../src/shared/utils/money.js';

describe('parseAmountToCents', () => {
  it.each([
    ['790.20', 79020], ['790,20', 79020], ['1,250.35', 125035], [' 184.68 ', 18468], ['-10.50', -1050], ['+10', 1000],
  ])('convierte %s sin usar acumulación flotante', (input, expected) => expect(parseAmountToCents(input)).toBe(expected));
  it.each(['', 'abc', '12.345', '1,2,3', '10-'])('no convierte %s silenciosamente a cero', (input) => expect(parseAmountToCents(input)).toBeNull());
  it('formatea centavos como decimal exacto', () => expect(formatCentsAsDecimal(-1050)).toBe('-10.50'));
});
