import { describe, expect, it } from 'vitest';
import { canonicalizeConceptDescription, comparisonText } from '../../src/shared/utils/normalization.js';

describe('normalización de conceptos', () => {
  it.each(['I S R POR SALARIOS', 'I  S  R POR SALARIOS', 'ISR POR SALARIOS'])(
    'canoniza %s', (input) => expect(canonicalizeConceptDescription(input)).toBe('ISR POR SALARIOS'),
  );
  it('elimina acentos solo en el texto de comparación', () => expect(comparisonText('Retención')).toBe('RETENCION'));
});
