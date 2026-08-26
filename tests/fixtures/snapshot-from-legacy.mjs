import { randomUUID } from 'node:crypto';
import { catalogChecksum } from '../../dist/main/services/central/catalogContracts.js';

// Test adapter only: the installed application never synthesizes central UUIDs.
export function snapshotFromLegacy(db) {
  const rows = table => db.prepare(`SELECT * FROM ${table}`).all();
  const groups = rows('concept_groups'); const concepts = rows('payroll_concepts');
  const groupIds = new Map(groups.map(row => [row.id, randomUUID()]));
  const conceptIds = new Map(concepts.map(row => [row.id, randomUUID()]));
  const snapshot = {
    revision: 1, publishedAt: '2026-08-26T00:00:00Z', checksumSha256: '',
    conceptGroups: groups.map(row => ({ uuid: groupIds.get(row.id), code: row.code, name: row.name, active: Boolean(row.active) })),
    payrollConcepts: concepts.map(row => ({ uuid: conceptIds.get(row.id), code: row.code, name: row.name,
      conceptGroupUuid: groupIds.get(row.group_id) ?? null, operationFactor: row.operation_factor, active: Boolean(row.active) })),
    conceptAliases: rows('concept_aliases').map(row => ({ uuid: randomUUID(), payrollConceptUuid: conceptIds.get(row.concept_id),
      sourceDescription: row.source_description, normalizedDescription: row.normalized_description, active: Boolean(row.active) })),
    payrollTypes: rows('payroll_types').map(row => ({ uuid: randomUUID(), code: row.code, name: row.name, sortOrder: row.sort_order, active: Boolean(row.active) })),
  };
  snapshot.checksumSha256 = catalogChecksum(snapshot);
  return snapshot;
}
