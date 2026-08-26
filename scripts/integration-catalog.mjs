import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../dist/main/database/migrations.js';
import { DatabaseService } from '../dist/main/database/DatabaseService.js';
import { initializeDatabase } from '../dist/main/database/initializeDatabase.js';
import { CatalogRepository } from '../dist/main/services/central/CatalogRepository.js';
import { catalogChecksum } from '../dist/main/services/central/catalogContracts.js';
import { captureBatchCatalog } from '../dist/main/services/central/captureCatalog.js';
import { ACTIVE_CONCEPT_MATCHERS_SQL } from '../dist/main/services/ConceptMatcher.js';
import { seedLegacyCatalog } from '../tests/fixtures/legacy-catalog.mjs';
import { snapshotFromLegacy } from '../tests/fixtures/snapshot-from-legacy.mjs';

const origin = 'https://nomina.example';
const now = '2026-08-26T12:00:00Z';
function insertBatch(db, id, typeId, recId) {
  db.prepare(`INSERT INTO payroll_batches(id,reconciliation_id,source_order,year,month,fortnight,payroll_type_id,
    layout_code,layout_version,original_filename,original_file_path,file_size,file_hash_sha256,status,created_at,updated_at)
    VALUES(?,?,?,2026,7,13,?,'TEST',1,'test.txt','test.txt',1,?,'COMPLETED',?,?)`).run(id, recId, id, typeId, randomUUID(), now, now);
}
function rehash(value) { value.checksumSha256 = catalogChecksum(value); return value; }

export async function verifyCatalogReplica(root) {
  const path = join(root, 'catalog-legacy.sqlite');
  const old = new Database(path);
  old.pragma('foreign_keys=ON'); old.pragma('journal_mode=WAL');
  for (const migration of MIGRATIONS.slice(0, 2)) { old.exec(migration.sql); old.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(migration.version, migration.name, now); }
  seedLegacyCatalog(old);
  const snapshot = snapshotFromLegacy(old);
  const groupId = old.prepare("SELECT id FROM concept_groups WHERE code='ISR'").get().id;
  const typeId = old.prepare("SELECT id FROM payroll_types WHERE code='SUELDOS'").get().id;
  const conceptId = old.prepare("SELECT id FROM payroll_concepts WHERE code='ISR_POR_SALARIOS'").get().id;
  old.prepare(`INSERT INTO monthly_reconciliations(id,year,month,concept_group_id,created_at,updated_at) VALUES(1,2026,7,?,?,?)`).run(groupId, now, now);
  insertBatch(old, 1, typeId, 1);
  old.prepare(`INSERT INTO batch_concept_snapshots(batch_id,source_concept_id,concept_code,concept_name,operation_factor,selected,created_at)
    VALUES(1,?,'OLD','Fotografía histórica',-1,1,?)`).run(conceptId, now);
  old.prepare("INSERT INTO concept_groups(code,name,created_at,updated_at) VALUES('LEGACY','Solo histórico',?,?)").run(now, now);
  old.close();
  const service = await initializeDatabase(path); const db = service.connection;
  try {
    const repository = new CatalogRepository(db);
    assert.equal(repository.state(), null);
    assert.ok(JSON.parse(repository.exportDiagnostics()).conflicts.length > 30);
    assert.equal(db.prepare('SELECT central_uuid FROM payroll_concepts WHERE id=?').get(conceptId).central_uuid, null);
    assert.equal(db.prepare('SELECT concept_group_name_snapshot FROM monthly_reconciliations WHERE id=1').get().concept_group_name_snapshot, 'Impuesto sobre la Renta');
    assert.equal(db.prepare('SELECT payroll_type_name_snapshot,catalog_revision FROM payroll_batches WHERE id=1').get().catalog_revision, null);
    const backups = await readdir(join(root, 'catalog-backups')); assert.ok(backups.some(name => name.startsWith('before-v3-')));
    const preMigration = new Database(join(root, 'catalog-backups', backups.find(name => name.startsWith('before-v3-'))), { readonly: true });
    try { assert.equal(preMigration.prepare('SELECT COUNT(*) n FROM payroll_batches').get().n, 1); assert.equal(preMigration.prepare('SELECT MAX(version) v FROM schema_migrations').get().v, 2); } finally { preMigration.close(); }
    repository.apply(snapshot, origin, 3600);
    assert.equal(repository.state().snapshot_schema_version, 1);
    assert.ok(repository.verifyStored()); assert.equal(repository.counts().legacyCount, 1);
    const ungrouped = db.prepare("SELECT id,central_uuid FROM payroll_concepts WHERE group_id IS NULL AND active=1 AND mapping_status='MAPPED' LIMIT 1").get();
    assert.ok(ungrouped);
    assert.equal(repository.readSnapshot().payrollConcepts.find(row => row.uuid === ungrouped.central_uuid).conceptGroupUuid, null);
    assert.ok(db.prepare(ACTIVE_CONCEPT_MATCHERS_SQL).all().some(rule => rule.conceptId === ungrouped.id && rule.groupId === null));
    assert.equal(repository.page({ entity: 'groups', filter: 'legacy', search: '', page: 1, pageSize: 25 }).items[0].code, 'LEGACY');
    assert.equal(repository.page({ entity: 'concepts', filter: 'all', search: 'I S R', page: 1, pageSize: 25 }).total > 0, true);
    assert.equal(db.prepare("SELECT id FROM payroll_concepts WHERE code='ISR_POR_SALARIOS'").get().id, conceptId);
    assert.equal(db.prepare('SELECT concept_name,operation_factor,central_uuid FROM batch_concept_snapshots WHERE batch_id=1').get().concept_name, 'Fotografía histórica');
    assert.equal(db.prepare('SELECT central_uuid FROM batch_concept_snapshots WHERE batch_id=1').get().central_uuid, null);
    assert.throws(() => db.prepare('UPDATE payroll_concepts SET central_uuid=? WHERE id=?').run(randomUUID(), conceptId), /IMMUTABLE/);
    insertBatch(db, 2, typeId, 1);
    const captured = db.transaction(() => captureBatchCatalog(db, { batchId: 2, reconciliationId: 1, payrollTypeId: typeId, revision: 1, selectedIds: [conceptId], now })).immediate();
    const frozen = db.prepare('SELECT * FROM batch_concept_snapshots WHERE batch_id=2').all();
    const aliasFrozen = db.prepare('SELECT * FROM batch_alias_snapshots WHERE batch_id=2').all();
    const metadata = db.prepare('SELECT catalog_revision,concept_group_uuid,payroll_type_uuid,payroll_type_name_snapshot FROM payroll_batches WHERE id=2').get();
    assert.equal(metadata.catalog_revision, 1); assert.ok(metadata.concept_group_uuid); assert.ok(metadata.payroll_type_uuid);
    assert.ok(captured.some(rule => rule.conceptId === conceptId && rule.operationFactor === 1));
    assert.ok(captured.some(rule => rule.conceptId === ungrouped.id && rule.groupId === null));
    assert.deepEqual(db.prepare('SELECT concept_group_uuid,group_id_snapshot,selected FROM batch_concept_snapshots WHERE batch_id=2 AND source_concept_id=?').get(ungrouped.id),
      { concept_group_uuid: null, group_id_snapshot: null, selected: 0 });
    assert.throws(() => db.transaction(() => captureBatchCatalog(db, { batchId: 2, reconciliationId: 1, payrollTypeId: typeId, revision: 1, selectedIds: [ungrouped.id], now }))(), /otro grupo/);
    assert.deepEqual(db.prepare('SELECT * FROM batch_concept_snapshots WHERE batch_id=2').all(), frozen);

    const next = structuredClone(snapshot); next.revision = 2;
    const salary = next.payrollConcepts.find(row => row.code === 'ISR_POR_SALARIOS'); salary.operationFactor = -1; salary.name = 'Nombre central actualizado'; salary.conceptGroupUuid = null;
    next.payrollTypes[0].name = 'Nuevo nombre'; next.payrollTypes[1].sortOrder = next.payrollTypes[0].sortOrder;
    [next.payrollTypes[0].code, next.payrollTypes[1].code] = [next.payrollTypes[1].code, next.payrollTypes[0].code];
    repository.apply(rehash(next), origin, 3600);
    assert.ok(repository.verifyStored()); assert.equal(db.prepare('SELECT operation_factor FROM payroll_concepts WHERE id=?').get(conceptId).operation_factor, -1);
    assert.equal(db.prepare('SELECT group_id FROM payroll_concepts WHERE id=?').get(conceptId).group_id, null);
    assert.deepEqual(db.prepare('SELECT * FROM batch_concept_snapshots WHERE batch_id=2').all(), frozen);
    assert.deepEqual(db.prepare('SELECT * FROM batch_alias_snapshots WHERE batch_id=2').all(), aliasFrozen);
    assert.deepEqual(db.prepare('SELECT catalog_revision,concept_group_uuid,payroll_type_uuid,payroll_type_name_snapshot FROM payroll_batches WHERE id=2').get(), metadata);

    const conflicting = structuredClone(next); conflicting.revision = 3; conflicting.payrollConcepts.find(row => row.uuid === salary.uuid).uuid = randomUUID();
    conflicting.conceptAliases.forEach(row => { if (row.payrollConceptUuid === salary.uuid) row.payrollConceptUuid = conflicting.payrollConcepts.find(c => c.code === salary.code).uuid; });
    assert.throws(() => repository.apply(rehash(conflicting), origin, 3600), error => error.code === 'CODE_OWNED_BY_OTHER_UUID');
    assert.equal(repository.state().revision, 2); assert.ok(repository.verifyStored()); assert.ok(repository.conflicts(1).items.some(row => row.conflictType === 'CODE_OWNED_BY_OTHER_UUID'));
    const invalid = structuredClone(next); invalid.payrollConcepts[0].name = 'Corrupto';
    assert.throws(() => repository.apply(invalid, origin, 3600), error => error.code === 'CHECKSUM_MISMATCH');
    assert.equal(repository.state().revision, 2);
    assert.throws(() => repository.apply(snapshot, origin, 3600), error => error.code === 'REVISION_CONFLICT');
    assert.throws(() => repository.confirmUnchanged('https://other.example', 3600, Date.now()));
    const removed = structuredClone(next); removed.revision = 3; removed.payrollConcepts = removed.payrollConcepts.filter(row => row.uuid !== salary.uuid);
    removed.conceptAliases = removed.conceptAliases.filter(row => row.payrollConceptUuid !== salary.uuid);
    repository.apply(rehash(removed), origin, 3600);
    assert.deepEqual(db.prepare('SELECT active,present_in_snapshot FROM payroll_concepts WHERE id=?').get(conceptId), { active: 0, present_in_snapshot: 0 });
    assert.ok(repository.verifyStored());
    insertBatch(db, 3, typeId, 1);
    assert.throws(() => db.transaction(() => captureBatchCatalog(db, { batchId: 3, reconciliationId: 1, payrollTypeId: typeId, revision: 3, selectedIds: [conceptId], now }))(), /inactivos/);
    repository.requireVerification(); assert.equal(repository.state().requires_verification, 1);
    assert.deepEqual(db.pragma('foreign_key_check'), []); assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { service.close(); }
  const empty = new DatabaseService(join(root, 'empty-catalog.sqlite'), { initialize: true });
  try { assert.equal(empty.connection.prepare('SELECT COUNT(*) n FROM payroll_concepts').get().n, 0); } finally { empty.close(); }

  const ambiguous = new DatabaseService(join(root, 'ambiguous-catalog.sqlite'), { initialize: true });
  try {
    seedLegacyCatalog(ambiguous.connection); const value = snapshotFromLegacy(ambiguous.connection);
    ambiguous.connection.exec(`INSERT INTO concept_aliases(concept_id,source_description,normalized_description,active,created_at,updated_at)
      SELECT concept_id,source_description,normalized_description,0,created_at,updated_at FROM concept_aliases LIMIT 1`);
    const repo = new CatalogRepository(ambiguous.connection);
    assert.throws(() => repo.apply(value, origin, 3600), error => error.code === 'AMBIGUOUS_LEGACY');
    assert.equal(ambiguous.connection.prepare('SELECT COUNT(*) n FROM payroll_concepts WHERE central_uuid IS NOT NULL').get().n, 0);
    assert.equal(repo.conflicts(1).total, 1);
  } finally { ambiguous.close(); }
  console.log(JSON.stringify({ catalogMigration: 'v2-to-v3-with-backup', atomicRollback: true, immutableUuid: true,
    noProductionSeed: true, historicSnapshotsPreserved: true, ambiguityRejected: true, foreignKeys: 'ok' }));
}
