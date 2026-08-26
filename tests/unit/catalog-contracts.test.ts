import { describe, expect, it } from 'vitest';
import { catalogChecksum, validateCatalogSnapshot } from '../../src/main/services/central/catalogContracts.js';
import { snapshot } from '../fixtures/central-catalog.js';

describe('contrato de catálogo', () => {
  it('checksum estable con Unicode, slash y claves ordenadas; excluye metadata', () => {
    const value = snapshot();
    // Independent Python json.dumps(sort_keys=True,ensure_ascii=False,separators=(',',':')) + hashlib.sha256.
    expect(catalogChecksum(value)).toBe('73437e2c851275ec6403ddba48a88f6aecd2954b97a3cce2457ae0d154d78326');
    expect(catalogChecksum({ ...value, revision: 99 } as typeof value)).toBe(value.checksumSha256);
    expect(validateCatalogSnapshot(value)).toEqual(value);
  });
  it('conserva conceptos sin grupo en el checksum y exige una relación explícita', () => {
    const value = snapshot();
    const groupedChecksum = value.checksumSha256;
    value.payrollConcepts[0]!.conceptGroupUuid = null;
    value.checksumSha256 = catalogChecksum(value);
    expect(value.checksumSha256).not.toBe(groupedChecksum);
    expect(validateCatalogSnapshot(value).payrollConcepts[0]!.conceptGroupUuid).toBeNull();
    expect(() => validateCatalogSnapshot({ ...value, payrollConcepts: [{ ...value.payrollConcepts[0], conceptGroupUuid: undefined }] })).toThrowError(/contrato/);
    value.payrollConcepts[0]!.conceptGroupUuid = '55555555-5555-4555-8555-555555555555';
    value.checksumSha256 = catalogChecksum(value);
    expect(() => validateCatalogSnapshot(value)).toThrowError(/relaciones/);
  });
  it('rechaza corrupción, extensiones desconocidas, factores y referencias inválidas', () => {
    const value = snapshot(); value.payrollConcepts[0]!.name += ' modificado';
    expect(() => validateCatalogSnapshot(value)).toThrowError(/checksum/);
    expect(() => validateCatalogSnapshot({ ...snapshot(), unexpected: true })).toThrowError(/contrato/);
    const factor = snapshot(); factor.payrollConcepts[0]!.operationFactor = 0 as 1;
    expect(() => validateCatalogSnapshot(factor)).toThrowError(/contrato/);
    const relation = snapshot(); relation.conceptGroups = [];
    expect(() => validateCatalogSnapshot(relation)).toThrowError(/relaciones/);
  });
  it('rechaza UUID/códigos y alias activos duplicados, y normalización incompatible', () => {
    const duplicate = snapshot(); duplicate.payrollConcepts.push({ ...duplicate.payrollConcepts[0]! });
    expect(() => validateCatalogSnapshot(duplicate)).toThrowError(/identidades/);
    const alias = snapshot(); alias.conceptAliases.push({ ...alias.conceptAliases[0]!, uuid: '55555555-5555-4555-8555-555555555555' });
    expect(() => validateCatalogSnapshot(alias)).toThrowError(/identidades/);
    const normalization = snapshot(); normalization.conceptAliases[0]!.normalizedDescription = 'I S R POR SALARIOS';
    expect(() => validateCatalogSnapshot(normalization)).toThrowError(/normalización/);
  });
  it('no exige sortOrder único ni códigos restringidos que el contrato no declara', () => {
    const value = snapshot(); value.payrollTypes.push({ ...value.payrollTypes[0]!, code: 'other-code', uuid: '55555555-5555-4555-8555-555555555555' });
    value.checksumSha256 = catalogChecksum(value); expect(validateCatalogSnapshot(value).payrollTypes).toHaveLength(2);
    const reordered = { ...value, payrollTypes: [...value.payrollTypes].reverse() }; expect(catalogChecksum(reordered)).toBe(value.checksumSha256);
  });
});
