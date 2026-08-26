import type Database from 'better-sqlite3';
import type { ConceptMatchRule } from '../ConceptMatcher.js';

/** Called inside the worker's batch-creation transaction, never across TXT I/O. */
export function captureBatchCatalog(db: Database.Database, input: { batchId: number; reconciliationId: number;
  payrollTypeId: number; revision: number; selectedIds: number[]; now: string }): ConceptMatchRule[] {
  const state = db.prepare('SELECT revision,requires_verification FROM catalog_sync_state WHERE id=1').get() as { revision: number; requires_verification: number } | undefined;
  if (!state || state.requires_verification || state.revision !== input.revision) throw new Error('El catálogo cambió. Vuelve a analizar los archivos antes de procesar.');
  const group = db.prepare(`SELECT g.* FROM concept_groups g JOIN monthly_reconciliations mr ON mr.concept_group_id=g.id
    WHERE mr.id=? AND g.active=1 AND g.mapping_status='MAPPED' AND g.present_in_snapshot=1`).get(input.reconciliationId) as { id: number; code: string; name: string; central_uuid: string } | undefined;
  const type = db.prepare(`SELECT * FROM payroll_types WHERE id=? AND active=1 AND mapping_status='MAPPED' AND present_in_snapshot=1`)
    .get(input.payrollTypeId) as { code: string; name: string; central_uuid: string } | undefined;
  if (!group || !type) throw new Error('El grupo o tipo de nómina no es elegible en el catálogo central.');
  const selected = new Set(input.selectedIds);
  const concepts = db.prepare(`SELECT c.*,g.central_uuid group_uuid,g.code group_code,g.name group_name FROM payroll_concepts c
    LEFT JOIN concept_groups g ON g.id=c.group_id WHERE c.active=1 AND c.mapping_status='MAPPED'
    AND c.present_in_snapshot=1
    AND (c.group_id IS NULL OR (g.active=1 AND g.mapping_status='MAPPED' AND g.present_in_snapshot=1))`).all() as Array<{
      id: number; code: string; name: string; group_id: number | null; operation_factor: number; central_uuid: string;
      group_uuid: string | null; group_code: string | null; group_name: string | null;
    }>;
  const eligible = new Set(concepts.filter((concept) => concept.group_id === group.id).map((concept) => concept.id));
  if (!selected.size || [...selected].some((id) => !eligible.has(id))) throw new Error('La selección contiene conceptos inactivos, históricos o de otro grupo.');
  db.prepare(`UPDATE payroll_batches SET catalog_revision=?,concept_group_uuid=?,concept_group_code_snapshot=?,concept_group_name_snapshot=?,
    payroll_type_uuid=?,payroll_type_code_snapshot=?,payroll_type_name_snapshot=? WHERE id=?`)
    .run(input.revision, group.central_uuid, group.code, group.name, type.central_uuid, type.code, type.name, input.batchId);
  const insert = db.prepare(`INSERT INTO batch_concept_snapshots(batch_id,source_concept_id,concept_code,concept_name,group_code,group_name,
    operation_factor,selected,created_at,central_uuid,concept_group_uuid,catalog_revision,group_id_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const concept of concepts) insert.run(input.batchId, concept.id, concept.code, concept.name, concept.group_code, concept.group_name,
    concept.operation_factor, selected.has(concept.id) ? 1 : 0, input.now, concept.central_uuid, concept.group_uuid, input.revision, concept.group_id);
  db.prepare(`INSERT INTO batch_alias_snapshots(batch_id,source_alias_id,source_concept_id,source_description,normalized_description,
    created_at,central_uuid,concept_uuid,catalog_revision)
    SELECT ?,a.id,a.concept_id,a.source_description,a.normalized_description,?,a.central_uuid,c.central_uuid,?
    FROM concept_aliases a JOIN batch_concept_snapshots c ON c.source_concept_id=a.concept_id AND c.batch_id=?
    WHERE a.active=1 AND a.mapping_status='MAPPED' AND a.present_in_snapshot=1`).run(input.batchId, input.now, input.revision, input.batchId);
  return db.prepare(`SELECT a.source_alias_id aliasId,c.source_concept_id conceptId,c.concept_code conceptCode,c.concept_name conceptName,
    c.group_id_snapshot groupId,c.group_code groupCode,c.group_name groupName,c.operation_factor operationFactor,a.normalized_description normalizedDescription
    FROM batch_alias_snapshots a JOIN batch_concept_snapshots c ON c.batch_id=a.batch_id AND c.source_concept_id=a.source_concept_id
    WHERE a.batch_id=?`).all(input.batchId) as ConceptMatchRule[];
}
