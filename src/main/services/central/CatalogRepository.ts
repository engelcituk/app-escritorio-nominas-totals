import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CatalogAliasEntry, CatalogConflict, CatalogEntry, CatalogPage, CatalogQuery } from '../../../shared/types/catalog.js';
import { CatalogError, catalogChecksum, validateCatalogSnapshot, SNAPSHOT_SCHEMA_VERSION, type CatalogSnapshot } from './catalogContracts.js';

const tables = ['concept_groups', 'payroll_concepts', 'concept_aliases', 'payroll_types'] as const;
type Table = typeof tables[number];
type Row = { id: number; central_uuid: string | null; code: string; name: string; active: number; normalized_description: string;
  concept_id: number; group_id: number | null; operation_factor: number; sort_order: number; central_sort_order: number;
  source_description: string; catalog_revision: number | null; mapping_status: 'MAPPED' | 'LEGACY_UNMAPPED'; present_in_snapshot: number };
export interface CatalogStateRow {
  snapshot_schema_version: number;
  revision: number | null; checksum_sha256: string | null; published_at: string | null;
  synced_at: string | null; valid_until: string | null; api_origin: string | null; requires_verification: number;
  last_attempt_at: string | null; last_error: string | null; retry_at: number | null;
}
class MappingConflict extends CatalogError {
  constructor(readonly table: Table, readonly row: Row, code: string) {
    super(code, 'El catálogo contiene un conflicto de identidad local. Consulta el diagnóstico; no se aplicaron cambios.');
  }
}

export class CatalogRepository {
  constructor(readonly db: Database.Database) {}
  state(): CatalogStateRow | null { return this.db.prepare('SELECT * FROM catalog_sync_state WHERE id=1').get() as CatalogStateRow ?? null; }

  counts(): { legacyCount: number; conflictCount: number } {
    return { legacyCount: tables.reduce((sum, table) => sum + Number((this.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE central_uuid IS NULL`).get() as { n: number }).n), 0),
      conflictCount: (this.db.prepare('SELECT COUNT(*) n FROM catalog_sync_conflicts WHERE resolved_at IS NULL').get() as { n: number }).n };
  }

  recordAttempt(error: string | null = null, retryAt: number | null = null): void {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO catalog_sync_state(id,last_attempt_at,last_error,retry_at,updated_at) VALUES(1,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_error=excluded.last_error,retry_at=excluded.retry_at,updated_at=excluded.updated_at`)
      .run(now, error, retryAt, now);
  }

  requireVerification(): void {
    this.db.prepare('UPDATE catalog_sync_state SET requires_verification=1 WHERE id=1').run();
  }

  readSnapshot(): CatalogSnapshot | null {
    const state = this.state();
    if (state?.revision === null || !state?.checksum_sha256) return null;
    const groups = this.rows('concept_groups').filter((row) => row.present_in_snapshot);
    const concepts = this.rows('payroll_concepts').filter((row) => row.present_in_snapshot);
    const aliases = this.rows('concept_aliases').filter((row) => row.present_in_snapshot);
    const types = this.rows('payroll_types').filter((row) => row.present_in_snapshot);
    const groupIds = new Map(groups.map((row) => [row.id, row.central_uuid!]));
    const conceptIds = new Map(concepts.map((row) => [row.id, row.central_uuid!]));
    return { revision: state.revision, checksumSha256: state.checksum_sha256, publishedAt: state.published_at,
      conceptGroups: groups.map((row) => ({ uuid: row.central_uuid!, code: row.code, name: row.name, active: Boolean(row.active) })),
      payrollConcepts: concepts.map((row) => ({ uuid: row.central_uuid!, code: row.code, name: row.name, active: Boolean(row.active),
        conceptGroupUuid: row.group_id === null ? null : groupIds.get(row.group_id)!, operationFactor: row.operation_factor as 1 | -1 })),
      conceptAliases: aliases.map((row) => ({ uuid: row.central_uuid!, payrollConceptUuid: conceptIds.get(row.concept_id)!,
        sourceDescription: row.source_description, normalizedDescription: row.normalized_description, active: Boolean(row.active) })),
      payrollTypes: types.map((row) => ({ uuid: row.central_uuid!, code: row.code, name: row.name, sortOrder: row.central_sort_order, active: Boolean(row.active) })),
    };
  }

  verifyStored(): boolean {
    if (this.state()?.snapshot_schema_version !== SNAPSHOT_SCHEMA_VERSION) return false;
    const snapshot = this.readSnapshot();
    return snapshot !== null && catalogChecksum(snapshot) === snapshot.checksumSha256;
  }

  confirmUnchanged(origin: string, maximumAgeSeconds: number, now: number): void {
    this.db.transaction(() => {
      const state = this.state();
      if (state?.api_origin !== origin || !this.verifyStored()) throw new CatalogError('LOCAL_CATALOG_INVALID', 'La copia local requiere descargar y verificar el catálogo completo.');
      this.confirm(origin, maximumAgeSeconds, now);
    }).immediate();
  }

  apply(snapshot: CatalogSnapshot, origin: string, maximumAgeSeconds: number, now = Date.now()): void {
    validateCatalogSnapshot(snapshot);
    try {
      this.db.transaction(() => {
        const state = this.state();
        if (state?.api_origin && state.api_origin !== origin) throw new CatalogError('CATALOG_ORIGIN_MISMATCH', 'La copia local pertenece a otro servidor.');
        if (state?.revision !== null && state?.revision !== undefined && (snapshot.revision < state.revision
          || (snapshot.revision === state.revision && state.checksum_sha256 !== snapshot.checksumSha256))) {
          throw new CatalogError('REVISION_CONFLICT', 'La revisión del servidor retrocedió o cambió de contenido.');
        }
        const timestamp = new Date(now).toISOString();
        const groupPlan = this.plan('concept_groups', snapshot.conceptGroups, (row) => row.code);
        const conceptPlan = this.plan('payroll_concepts', snapshot.payrollConcepts, (row) => row.code);
        const typePlan = this.plan('payroll_types', snapshot.payrollTypes, (row) => row.code);
        const aliasPlan = this.plan('concept_aliases', snapshot.conceptAliases, (row) => row.normalizedDescription);
        this.db.prepare('UPDATE catalog_sync_conflicts SET resolved_at=? WHERE resolved_at IS NULL').run(timestamp);
        // Release mutable unique keys only for identities participating in this snapshot.
        // Values outside the transaction are never visible; a collision rolls everything back.
        for (const [table, plan] of [['concept_groups', groupPlan], ['payroll_concepts', conceptPlan], ['payroll_types', typePlan]] as const) {
          const prefix = `__SYNC_${randomUUID()}_`;
          for (const [index, item] of plan.entries()) if (item.local) this.db.prepare(`UPDATE ${table} SET code=? WHERE id=?`).run(`${prefix}${index}`, item.local.id);
        }
        for (const table of tables) this.db.prepare(`UPDATE ${table} SET present_in_snapshot=0,active=CASE WHEN central_uuid IS NOT NULL THEN 0 ELSE active END WHERE central_uuid IS NOT NULL`).run();
        for (const item of aliasPlan) if (item.local) this.db.prepare('UPDATE concept_aliases SET active=0 WHERE id=?').run(item.local.id);
        const groupIds = new Map<string, number>();
        for (const { remote, local } of groupPlan) {
          const id = this.upsert('concept_groups', local?.id, { code: remote.code, name: remote.name, ...this.provenance(remote, snapshot.revision, timestamp) });
          groupIds.set(remote.uuid, id);
        }
        const conceptIds = new Map<string, number>();
        for (const { remote, local } of conceptPlan) {
          const groupId = remote.conceptGroupUuid === null ? null : groupIds.get(remote.conceptGroupUuid)!;
          if (local && (local.group_id !== groupId || local.operation_factor !== remote.operationFactor)) {
            this.db.prepare(`INSERT INTO audit_logs(action,entity_type,entity_id,description,created_at) VALUES('CENTRAL_RULE_CHANGE','PAYROLL_CONCEPT',?,'Se aplicó la asociación/factor del catálogo central; snapshots anteriores conservados.',?)`).run(String(local.id), timestamp);
          }
          const id = this.upsert('payroll_concepts', local?.id, { code: remote.code, name: remote.name, group_id: groupId,
            operation_factor: remote.operationFactor, ...this.provenance(remote, snapshot.revision, timestamp) });
          conceptIds.set(remote.uuid, id);
        }
        // Existing sort_order is UNIQUE. Keep it as local ordinal; preserve the exact
        // (possibly tied) remote sortOrder in central_sort_order and order by it in UI.
        const typeRows = this.rows('payroll_types');
        let temporaryOrder = Math.min(0, ...typeRows.map((row) => row.sort_order)) - typeRows.length - typePlan.length - 1;
        for (const row of typeRows) this.db.prepare('UPDATE payroll_types SET sort_order=? WHERE id=?').run(temporaryOrder--, row.id);
        let rank = 1;
        for (const { remote, local } of [...typePlan].sort((a, b) => a.remote.sortOrder - b.remote.sortOrder || a.remote.uuid.localeCompare(b.remote.uuid))) {
          this.upsert('payroll_types', local?.id, { code: remote.code, name: remote.name, sort_order: rank++,
            central_sort_order: remote.sortOrder, ...this.provenance(remote, snapshot.revision, timestamp) });
        }
        const assignedTypes = new Set(typePlan.flatMap((item) => item.local ? [item.local.id] : []));
        for (const row of typeRows.sort((a, b) => a.sort_order - b.sort_order)) if (!assignedTypes.has(row.id)) {
          this.db.prepare('UPDATE payroll_types SET sort_order=? WHERE id=?').run(rank++, row.id);
        }
        for (const { remote, local } of aliasPlan) {
          const conceptId = conceptIds.get(remote.payrollConceptUuid)!;
          if (local && local.concept_id !== conceptId) this.db.prepare(`INSERT INTO audit_logs(action,entity_type,entity_id,description,created_at)
            VALUES('CENTRAL_ALIAS_CHANGE','CONCEPT_ALIAS',?,'Se aplicó la asociación central del alias; snapshots anteriores conservados.',?)`).run(String(local.id), timestamp);
          this.upsert('concept_aliases', local?.id, { concept_id: conceptId, source_description: remote.sourceDescription,
            normalized_description: remote.normalizedDescription, ...this.provenance(remote, snapshot.revision, timestamp) });
        }
        for (const table of tables) for (const row of this.rows(table)) if (!row.central_uuid) {
          this.conflict(table, row, 'LEGACY_UNMAPPED', 'Registro local sin equivalencia central; solo disponible como histórico.', snapshot.revision, timestamp);
        }
        if ((this.db.pragma('foreign_key_check') as unknown[]).length) throw new CatalogError('INVALID_RELATIONSHIPS', 'No se pudo verificar la integridad de las relaciones.');
        this.db.prepare(`INSERT INTO catalog_sync_state(id,revision,checksum_sha256,published_at,snapshot_schema_version,updated_at) VALUES(1,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,checksum_sha256=excluded.checksum_sha256,published_at=excluded.published_at,snapshot_schema_version=excluded.snapshot_schema_version,updated_at=excluded.updated_at`)
          .run(snapshot.revision, snapshot.checksumSha256, snapshot.publishedAt, SNAPSHOT_SCHEMA_VERSION, timestamp);
        if (!this.verifyStored()) throw new CatalogError('LOCAL_CATALOG_INVALID', 'La réplica aplicada no coincide con el checksum verificado.');
        this.confirm(origin, maximumAgeSeconds, now);
      }).immediate();
    } catch (error) {
      if (error instanceof MappingConflict) {
        this.conflict(error.table, error.row, error.code, error.message, snapshot.revision, new Date(now).toISOString());
        throw error;
      }
      if (error instanceof CatalogError) throw error;
      throw new CatalogError('CATALOG_APPLY_FAILED', 'No se pudo aplicar el catálogo. Se conservó la copia anterior.');
    }
  }

  page(query: CatalogQuery): CatalogPage<CatalogEntry> {
    const table = { concepts: 'payroll_concepts', groups: 'concept_groups', types: 'payroll_types' }[query.entity];
    const filter = query.filter === 'legacy' ? 't.central_uuid IS NULL' : query.filter === 'active'
      ? 't.active=1 AND t.present_in_snapshot=1' : query.filter === 'inactive' ? 't.active=0' : '1=1';
    const term = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
    const condition = `${filter} AND (t.name LIKE ? ESCAPE '\\' OR t.code LIKE ? ESCAPE '\\'${query.entity === 'concepts'
      ? " OR EXISTS(SELECT 1 FROM concept_aliases a WHERE a.concept_id=t.id AND a.source_description LIKE ? ESCAPE '\\')" : ''})`;
    const params = query.entity === 'concepts' ? [term, term, term] : [term, term];
    const total = (this.db.prepare(`SELECT COUNT(*) n FROM ${table} t WHERE ${condition}`).get(...params) as { n: number }).n;
    const details = query.entity === 'concepts' ? `g.name group_name,t.operation_factor,(SELECT COUNT(*) FROM concept_aliases a WHERE a.concept_id=t.id) alias_count`
      : 'NULL group_name,NULL operation_factor,0 alias_count';
    const join = query.entity === 'concepts' ? 'LEFT JOIN concept_groups g ON g.id=t.group_id' : '';
    const order = query.entity === 'types' ? 't.sort_order,t.id' : 't.name,t.id';
    const items = (this.db.prepare(`SELECT t.*,${details} FROM ${table} t ${join} WHERE ${condition} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as Array<Row & { group_name: string | null; alias_count: number }>).map((row) => ({
      id: row.id, uuid: row.central_uuid, code: row.code, name: row.name, active: Boolean(row.active), mappingStatus: row.mapping_status,
      revision: row.catalog_revision, groupName: row.group_name, operationFactor: row.operation_factor, aliasCount: row.alias_count,
    }));
    return { items, total };
  }

  aliases(id: number, page: number): CatalogPage<CatalogAliasEntry> {
    const total = (this.db.prepare('SELECT COUNT(*) n FROM concept_aliases WHERE concept_id=?').get(id) as { n: number }).n;
    const items = (this.db.prepare('SELECT * FROM concept_aliases WHERE concept_id=? ORDER BY source_description,id LIMIT 25 OFFSET ?').all(id, (page - 1) * 25) as Row[])
      .map((row) => ({ id: row.id, uuid: row.central_uuid, sourceDescription: row.source_description, normalizedDescription: row.normalized_description, active: Boolean(row.active) }));
    return { items, total };
  }

  conflicts(page: number): CatalogPage<CatalogConflict> {
    const total = this.counts().conflictCount;
    const items = this.db.prepare(`SELECT id,entity_type entityType,local_id localId,local_code code,conflict_type conflictType,description,revision
      FROM catalog_sync_conflicts WHERE resolved_at IS NULL ORDER BY id LIMIT 25 OFFSET ?`).all((page - 1) * 25) as CatalogConflict[];
    return { items, total };
  }

  private rows(table: Table): Row[] { return this.db.prepare(`SELECT * FROM ${table}`).all() as Row[]; }
  exportDiagnostics(): string {
    return this.db.transaction(() => {
      const items = this.db.prepare(`SELECT entity_type,local_id,local_code,conflict_type,description,revision,created_at
        FROM catalog_sync_conflicts WHERE resolved_at IS NULL ORDER BY id LIMIT 100001`).all();
      if (items.length > 100000) throw new CatalogError('EXPORT_LIMIT', 'El diagnóstico excede 100000 registros. Solicita una extracción al administrador.');
      return JSON.stringify({ format: 'sefiplan-catalog-diagnostics-v1', exportedAt: new Date().toISOString(),
        catalogRevision: this.state()?.revision ?? null, conflicts: items }, null, 2);
    })();
  }
  private plan<T extends { uuid: string }>(table: Table, remotes: T[], key: (remote: T) => string): Array<{ remote: T; local: Row | undefined }> {
    const rows = this.rows(table); const byUuid = new Map(rows.filter((row) => row.central_uuid).map((row) => [row.central_uuid!, row]));
    const localKey = (row: Row) => table === 'concept_aliases' ? row.normalized_description : row.code;
    const legacyByKey = new Map<string, Row[]>();
    for (const row of rows) if (!row.central_uuid) legacyByKey.set(localKey(row), [...legacyByKey.get(localKey(row)) ?? [], row]);
    const assigned = new Set<number>();
    const plan = remotes.map((remote) => {
      let local = byUuid.get(remote.uuid);
      if (!local) {
        const candidates = legacyByKey.get(key(remote)) ?? [];
        if (candidates.length > 1 || (candidates[0] && assigned.has(candidates[0].id))) throw new MappingConflict(table, candidates[0]!, 'AMBIGUOUS_LEGACY');
        local = candidates[0];
      }
      if (local) assigned.add(local.id);
      return { remote, local };
    });
    if (table !== 'concept_aliases') {
      const byCode = new Map(rows.map((row) => [row.code, row]));
      for (const item of plan) { const owner = byCode.get(key(item.remote)); if (owner && !assigned.has(owner.id)) throw new MappingConflict(table, owner, 'CODE_OWNED_BY_OTHER_UUID'); }
    }
    return plan;
  }
  private provenance(remote: { uuid: string; active: boolean }, revision: number, now: string) {
    return { central_uuid: remote.uuid, active: remote.active ? 1 : 0, catalog_revision: revision, mapping_status: 'MAPPED', present_in_snapshot: 1, updated_at: now };
  }
  private upsert(table: Table, id: number | undefined, values: Record<string, string | number | null>): number {
    const entries = Object.entries(values);
    if (id !== undefined) { this.db.prepare(`UPDATE ${table} SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?`).run(...entries.map(([, value]) => value), id); return id; }
    return Number(this.db.prepare(`INSERT INTO ${table}(${entries.map(([key]) => key).join(',')},created_at) VALUES(${entries.map(() => '?').join(',')},?)`)
      .run(...entries.map(([, value]) => value), values.updated_at).lastInsertRowid);
  }
  private confirm(origin: string, age: number, now: number): void {
    this.db.prepare(`UPDATE catalog_sync_state SET api_origin=?,synced_at=?,valid_until=?,requires_verification=0,last_error=NULL,retry_at=NULL,updated_at=? WHERE id=1`)
      .run(origin, new Date(now).toISOString(), new Date(now + age * 1000).toISOString(), new Date(now).toISOString());
  }
  private conflict(table: Table, row: Row, kind: string, description: string, revision: number, now: string): void {
    this.db.prepare(`INSERT INTO catalog_sync_conflicts(entity_type,local_id,local_code,conflict_type,description,revision,created_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(entity_type,local_id,conflict_type) WHERE resolved_at IS NULL DO UPDATE SET revision=excluded.revision,description=excluded.description`)
      .run(table, row.id, row.code ?? null, kind, description, revision, now);
  }
}
