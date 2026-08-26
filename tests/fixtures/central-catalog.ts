import { catalogChecksum, type CatalogSnapshot } from '../../src/main/services/central/catalogContracts.js';
export const groupUuid = '11111111-1111-4111-8111-111111111111';
export const conceptUuid = '22222222-2222-4222-8222-222222222222';
export function snapshot(): CatalogSnapshot {
  const result: CatalogSnapshot = {
    revision: 1, publishedAt: '2026-08-26T00:00:00Z', checksumSha256: '',
    conceptGroups: [{ uuid: groupUuid, code: 'ISR', name: 'Impuesto sobre la Renta', active: true }],
    payrollConcepts: [{ uuid: conceptUuid, code: 'ISR_SALARIOS', name: 'ISR por salarios', conceptGroupUuid: groupUuid, operationFactor: 1, active: true }],
    conceptAliases: [{ uuid: '33333333-3333-4333-8333-333333333333', payrollConceptUuid: conceptUuid, sourceDescription: 'I S R por salarios', normalizedDescription: 'ISR POR SALARIOS', active: true }],
    payrollTypes: [{ uuid: '44444444-4444-4444-8444-444444444444', code: 'SUELDOS', name: 'Nómina ordinaria / básica', sortOrder: 1, active: true }],
  };
  result.checksumSha256 = catalogChecksum(result); return result;
}
