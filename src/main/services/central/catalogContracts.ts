import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalizeConceptDescription } from '../../../shared/utils/normalization.js';

const uuid = z.string().uuid().regex(/^[0-9a-f-]+$/);
const code = z.string().min(1).max(120);
const name = z.string().min(1).max(500);
export const SNAPSHOT_SCHEMA_VERSION = 1;
export const catalogManifestSchema = z.strictObject({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
});
export const catalogSnapshotSchema = catalogManifestSchema.extend({
  conceptGroups: z.array(z.strictObject({ uuid, code, name, active: z.boolean() })).max(10_000),
  payrollConcepts: z.array(z.strictObject({ uuid, code, name, conceptGroupUuid: uuid.nullable(),
    operationFactor: z.union([z.literal(-1), z.literal(1)]), active: z.boolean() })).max(50_000),
  conceptAliases: z.array(z.strictObject({ uuid, payrollConceptUuid: uuid, sourceDescription: name,
    normalizedDescription: name, active: z.boolean() })).max(150_000),
  payrollTypes: z.array(z.strictObject({ uuid, code, name, sortOrder: z.number().int().min(-2_147_483_648).max(2_147_483_647), active: z.boolean() })).max(10_000),
});
export type CatalogManifest = z.infer<typeof catalogManifestSchema>;
export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>;

export class CatalogError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'CatalogError'; }
}

/** PHP contract: sort list UUIDs, sort object keys, preserve Unicode/slashes. */
export function catalogChecksum(snapshot: Pick<CatalogSnapshot, 'conceptAliases' | 'conceptGroups' | 'payrollConcepts' | 'payrollTypes'>): string {
  const catalogs = Object.fromEntries(['conceptAliases', 'conceptGroups', 'payrollConcepts', 'payrollTypes'].map((key) => [key,
    [...snapshot[key as keyof typeof snapshot]].sort((a, b) => a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0)]));
  function ordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, ordered(item)]));
    return value;
  }
  // PHP JSON_UNESCAPED_UNICODE does not imply JSON_UNESCAPED_LINE_TERMINATORS.
  const json = JSON.stringify(ordered(catalogs)).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

export function validateCatalogSnapshot(raw: unknown): CatalogSnapshot {
  const parsed = catalogSnapshotSchema.safeParse(raw);
  if (!parsed.success) throw new CatalogError('INVALID_SNAPSHOT', 'El catálogo recibido no cumple el contrato compatible.');
  const snapshot = parsed.data;
  const fail = () => { throw new CatalogError('INVALID_RELATIONSHIPS', 'El catálogo contiene identidades duplicadas o relaciones incompatibles.'); };
  for (const rows of [snapshot.conceptGroups, snapshot.payrollConcepts, snapshot.conceptAliases, snapshot.payrollTypes]) {
    if (new Set(rows.map((row) => row.uuid)).size !== rows.length) fail();
  }
  for (const rows of [snapshot.conceptGroups, snapshot.payrollConcepts, snapshot.payrollTypes]) {
    if (new Set(rows.map((row) => row.code)).size !== rows.length) fail();
  }
  const groups = new Set(snapshot.conceptGroups.map((row) => row.uuid));
  const concepts = new Set(snapshot.payrollConcepts.map((row) => row.uuid));
  const activeDescriptions = new Set<string>();
  for (const concept of snapshot.payrollConcepts) if (concept.conceptGroupUuid !== null && !groups.has(concept.conceptGroupUuid)) fail();
  for (const alias of snapshot.conceptAliases) {
    if (!concepts.has(alias.payrollConceptUuid)) fail();
    if (canonicalizeConceptDescription(alias.sourceDescription) !== alias.normalizedDescription) {
      throw new CatalogError('NORMALIZATION_MISMATCH', 'La normalización de alias requiere una versión compatible del cliente.');
    }
    if (alias.active && activeDescriptions.has(alias.normalizedDescription)) fail();
    if (alias.active) activeDescriptions.add(alias.normalizedDescription);
  }
  if (catalogChecksum(snapshot) !== snapshot.checksumSha256) throw new CatalogError('CHECKSUM_MISMATCH', 'El checksum del catálogo no coincide. Se conservó la copia anterior.');
  return snapshot;
}
