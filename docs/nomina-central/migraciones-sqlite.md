# Propuesta exacta de migraciones SQLite

**DDL para revisión, no ejecutado por la aplicación.** No modificar la migración v1 ni registrar estas versiones en producción en Fase 0. Los números 2–5 se reservan provisionalmente y se revalidan antes de cada fase.

## Condiciones generales

- Base de partida: esquema v1 de `src/main/database/migrations.ts`. Incrementales en el MigrationService existente; todas las sentencias y registro de versión se confirman transaccionalmente, sin recrear base.
- Ejecutar migraciones una sola vez en bootstrap main, antes de abrir workers; las conexiones operativas deben validar versión, no sembrar ni competir por migraciones.
- Crear backup consistente previamente, verificar espacio/integridad y cerrar otras conexiones para cambios de esquema. No desactivar foreign_keys ni editar schema_migrations manualmente.
- El runner actual aplica todas las pendientes en una transacción. Mantener atomicidad y no hacer red/I/O de archivos dentro de ella; el backup precede a la transacción.
- UUID como TEXT canónico validado con Zod/main; índices UNIQUE admiten múltiples NULL para legacy. Los IDs enteros siguen siendo llaves locales.
- Fechas TEXT ISO 8601 UTC generadas por main. Hash lowercase SHA-256 de 64 caracteres. Validar también formato, tamaños y enteros seguros en Zod; CHECK de longitud no sustituye validación de contenido.
- Los metadatos remotos no significan que un registro histórico ya esté sincronizado. Default `NOT_QUEUED` en resultados existentes. Solo nuevos resultados confirmados se encolan.
- No insertar tokens, contraseñas, cabeceras ni respuestas de login en SQLite.

## Versión 2 — desktop_identity (Fase 1)

`installation_uuid` se genera en main con randomUUID e INSERT singleton transaccional; la migración no crea una identidad distinta en cada apertura. device_name se obtiene de entrada validada, no del hardware. api_origin permite detectar restauraciones/cambio de servidor; no habilita al usuario a editarlo.

```sql
CREATE TABLE app_identity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  installation_uuid TEXT NOT NULL UNIQUE,
  central_device_uuid TEXT UNIQUE,
  device_name TEXT NOT NULL,
  registered_at TEXT,
  last_seen_at TEXT,
  last_app_version TEXT,
  api_origin TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TRIGGER app_identity_installation_immutable
BEFORE UPDATE OF installation_uuid ON app_identity
WHEN OLD.installation_uuid IS NOT NEW.installation_uuid
BEGIN
  SELECT RAISE(ABORT, 'INSTALLATION_UUID_IMMUTABLE');
END;
```

El procedimiento excepcional para trasladar identidad necesita confirmación y diseño separado; no se resuelve haciendo UPDATE desde settings. central_device_uuid puede cambiar únicamente tras registro autenticado explícito aprobado, nunca por restaurar un backup de otra instalación.

## Versión 3 — central_catalog_replica (Fase 2)

`mapping_status` distingue la procedencia de `active`, que conserva el estado del canon. Las filas actuales quedan LEGACY_UNMAPPED sin borrar ni reescribir su contenido. Añadir revisión/UUID también a snapshots evita reconstruir referencias a partir de catálogos que después cambian.

```sql
ALTER TABLE concept_groups ADD COLUMN central_uuid TEXT;
ALTER TABLE concept_groups ADD COLUMN catalog_revision INTEGER CHECK (catalog_revision IS NULL OR catalog_revision >= 0);
ALTER TABLE concept_groups ADD COLUMN mapping_status TEXT NOT NULL DEFAULT 'LEGACY_UNMAPPED'
  CHECK (mapping_status IN ('LEGACY_UNMAPPED', 'MAPPED'));
CREATE UNIQUE INDEX idx_concept_groups_central_uuid ON concept_groups(central_uuid);
CREATE INDEX idx_concept_groups_catalog_revision ON concept_groups(catalog_revision);
CREATE TRIGGER concept_groups_central_uuid_immutable
BEFORE UPDATE OF central_uuid ON concept_groups
WHEN OLD.central_uuid IS NOT NULL AND OLD.central_uuid IS NOT NEW.central_uuid
BEGIN
  SELECT RAISE(ABORT, 'CENTRAL_UUID_IMMUTABLE');
END;
ALTER TABLE payroll_concepts ADD COLUMN central_uuid TEXT;
ALTER TABLE payroll_concepts ADD COLUMN catalog_revision INTEGER CHECK (catalog_revision IS NULL OR catalog_revision >= 0);
ALTER TABLE payroll_concepts ADD COLUMN mapping_status TEXT NOT NULL DEFAULT 'LEGACY_UNMAPPED'
  CHECK (mapping_status IN ('LEGACY_UNMAPPED', 'MAPPED'));
CREATE UNIQUE INDEX idx_payroll_concepts_central_uuid ON payroll_concepts(central_uuid);
CREATE INDEX idx_payroll_concepts_catalog_revision ON payroll_concepts(catalog_revision);
CREATE TRIGGER payroll_concepts_central_uuid_immutable
BEFORE UPDATE OF central_uuid ON payroll_concepts
WHEN OLD.central_uuid IS NOT NULL AND OLD.central_uuid IS NOT NEW.central_uuid
BEGIN
  SELECT RAISE(ABORT, 'CENTRAL_UUID_IMMUTABLE');
END;
ALTER TABLE concept_aliases ADD COLUMN central_uuid TEXT;
ALTER TABLE concept_aliases ADD COLUMN catalog_revision INTEGER CHECK (catalog_revision IS NULL OR catalog_revision >= 0);
ALTER TABLE concept_aliases ADD COLUMN mapping_status TEXT NOT NULL DEFAULT 'LEGACY_UNMAPPED'
  CHECK (mapping_status IN ('LEGACY_UNMAPPED', 'MAPPED'));
CREATE UNIQUE INDEX idx_concept_aliases_central_uuid ON concept_aliases(central_uuid);
CREATE INDEX idx_concept_aliases_catalog_revision ON concept_aliases(catalog_revision);
CREATE TRIGGER concept_aliases_central_uuid_immutable
BEFORE UPDATE OF central_uuid ON concept_aliases
WHEN OLD.central_uuid IS NOT NULL AND OLD.central_uuid IS NOT NEW.central_uuid
BEGIN
  SELECT RAISE(ABORT, 'CENTRAL_UUID_IMMUTABLE');
END;
ALTER TABLE payroll_types ADD COLUMN central_uuid TEXT;
ALTER TABLE payroll_types ADD COLUMN catalog_revision INTEGER CHECK (catalog_revision IS NULL OR catalog_revision >= 0);
ALTER TABLE payroll_types ADD COLUMN mapping_status TEXT NOT NULL DEFAULT 'LEGACY_UNMAPPED'
  CHECK (mapping_status IN ('LEGACY_UNMAPPED', 'MAPPED'));
CREATE UNIQUE INDEX idx_payroll_types_central_uuid ON payroll_types(central_uuid);
CREATE INDEX idx_payroll_types_catalog_revision ON payroll_types(catalog_revision);
CREATE TRIGGER payroll_types_central_uuid_immutable
BEFORE UPDATE OF central_uuid ON payroll_types
WHEN OLD.central_uuid IS NOT NULL AND OLD.central_uuid IS NOT NEW.central_uuid
BEGIN
  SELECT RAISE(ABORT, 'CENTRAL_UUID_IMMUTABLE');
END;

CREATE TABLE catalog_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER CHECK (revision IS NULL OR revision >= 0),
  checksum_sha256 TEXT CHECK (checksum_sha256 IS NULL OR length(checksum_sha256) = 64),
  synced_at TEXT,
  valid_until TEXT,
  snapshot_schema_version INTEGER,
  last_attempt_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  maximum_offline_age_seconds INTEGER CHECK (maximum_offline_age_seconds IS NULL OR maximum_offline_age_seconds > 0),
  minimum_supported_app_version TEXT,
  requires_verification INTEGER NOT NULL DEFAULT 0 CHECK (requires_verification IN (0, 1)),
  manifest_etag TEXT,
  api_origin TEXT,
  CHECK ((revision IS NULL AND checksum_sha256 IS NULL AND synced_at IS NULL)
      OR (revision IS NOT NULL AND checksum_sha256 IS NOT NULL AND synced_at IS NOT NULL AND snapshot_schema_version IS NOT NULL))
);
CREATE INDEX idx_catalog_sync_revision ON catalog_sync_state(revision);
CREATE INDEX idx_catalog_sync_checksum ON catalog_sync_state(checksum_sha256);

CREATE TABLE catalog_sync_conflicts (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('CONCEPT_GROUP', 'PAYROLL_CONCEPT', 'CONCEPT_ALIAS', 'PAYROLL_TYPE')),
  local_id INTEGER NOT NULL,
  local_code TEXT,
  local_normalized_value TEXT,
  conflict_type TEXT NOT NULL,
  description TEXT NOT NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  central_uuid TEXT,
  revision INTEGER,
  resolution_code TEXT
);
CREATE INDEX idx_catalog_conflicts_unresolved ON catalog_sync_conflicts(resolved_at, entity_type, local_id);
CREATE INDEX idx_catalog_conflicts_central ON catalog_sync_conflicts(entity_type, central_uuid);

ALTER TABLE payroll_batches ADD COLUMN catalog_revision INTEGER CHECK (catalog_revision IS NULL OR catalog_revision >= 0);
ALTER TABLE payroll_batches ADD COLUMN concept_group_uuid TEXT;
ALTER TABLE payroll_batches ADD COLUMN concept_group_code_snapshot TEXT;
ALTER TABLE payroll_batches ADD COLUMN concept_group_name_snapshot TEXT;
ALTER TABLE payroll_batches ADD COLUMN payroll_type_uuid TEXT;
ALTER TABLE payroll_batches ADD COLUMN payroll_type_code_snapshot TEXT;
ALTER TABLE payroll_batches ADD COLUMN payroll_type_name_snapshot TEXT;
CREATE INDEX idx_batches_catalog_revision ON payroll_batches(catalog_revision);

ALTER TABLE batch_concept_snapshots ADD COLUMN central_uuid TEXT;
ALTER TABLE batch_concept_snapshots ADD COLUMN concept_group_uuid TEXT;
ALTER TABLE batch_concept_snapshots ADD COLUMN catalog_revision INTEGER;
ALTER TABLE batch_alias_snapshots ADD COLUMN central_uuid TEXT;
ALTER TABLE batch_alias_snapshots ADD COLUMN concept_uuid TEXT;
ALTER TABLE batch_alias_snapshots ADD COLUMN catalog_revision INTEGER;
CREATE UNIQUE INDEX idx_batch_concept_central ON batch_concept_snapshots(batch_id, central_uuid);
CREATE UNIQUE INDEX idx_batch_alias_central ON batch_alias_snapshots(batch_id, central_uuid);
CREATE INDEX idx_batch_alias_snapshot_lookup ON batch_alias_snapshots(batch_id, normalized_description);
```

catalog_sync_state puede no tener fila hasta el primer intento; main trata ausencia como primera sincronización requerida. En intento inicial se inserta singleton con revision/checksum/synced_at NULL. Un commit de catálogo actualiza todas las columnas de procedencia simultáneamente. El 304 no transforma una fila sin snapshot en catálogo válido.

### Algoritmo de datos de la Fase 2 (no parte del DDL)

1. Descargar/validar snapshot y preparar mapa en memoria fuera de la transacción; backup de SQLite.
2. BEGIN IMMEDIATE, comprobar revisión base. Resolver UUID ya existentes primero; solo filas sin UUID son candidatas al enlace por code/normalized_description.
3. Registrar conflictos legacy; no borrar filas. Ambigüedad de identidad, colisión de código o relación imposible aborta la aplicación completa.
4. Intercambio de códigos/órdenes de filas ya identificadas: valores temporales reservados comprobados contra todas las filas, luego canon definitivo. Mantener índices de unicidad; no desactivarlos para tolerar datos ambiguos.
5. Resolver group_id/concept_id exclusivamente mediante el mapa UUID→ID local. Alias activo con concepto inactivo queda no elegible para procesos aunque preserve active recibido.
6. Marcar ausencias según semántica de snapshot completo/tombstones aprobada; nunca borrar histórico ni inferir baja por falta de una página.
7. Validar claves foráneas, conteos y ausencia de conflictos fatales; actualizar revisión/checksum y commit.
8. En rollback, guardar error/conflictos diagnósticos en transacción posterior; resolved_at solo cuando una revisión exitosa acredita resolución. Evitar duplicar el mismo conflicto abierto al reintentar.
9. No backfill de catalog_revision en lotes antiguos ni central_uuid en sus snapshots sin evidencia histórica.

## Versión 4 — durable_sync_outbox (Fase 3)

Estado de entidad remoto separado del estado local existente. `remote_revision` se propone TEXT para preservar una revisión/ETag opaca, sujeto a contrato. El expediente puede reunir lotes de distintas revisiones de catálogo; no añadir una catalog_revision única engañosa al agregado.

```sql
ALTER TABLE monthly_reconciliations ADD COLUMN central_uuid TEXT;
ALTER TABLE monthly_reconciliations ADD COLUMN remote_sync_status TEXT NOT NULL DEFAULT 'NOT_QUEUED'
  CHECK (remote_sync_status IN ('NOT_QUEUED', 'PENDING', 'IN_PROGRESS', 'RETRY', 'SYNCED', 'FAILED', 'CONFLICT'));
ALTER TABLE monthly_reconciliations ADD COLUMN remote_synced_at TEXT;
ALTER TABLE monthly_reconciliations ADD COLUMN remote_error TEXT;
ALTER TABLE monthly_reconciliations ADD COLUMN remote_revision TEXT;
CREATE UNIQUE INDEX idx_monthly_reconciliations_central_uuid ON monthly_reconciliations(central_uuid);
CREATE INDEX idx_monthly_reconciliations_remote_status ON monthly_reconciliations(remote_sync_status);
CREATE TRIGGER monthly_reconciliations_central_uuid_immutable
BEFORE UPDATE OF central_uuid ON monthly_reconciliations
WHEN OLD.central_uuid IS NOT NULL AND OLD.central_uuid IS NOT NEW.central_uuid
BEGIN
  SELECT RAISE(ABORT, 'CENTRAL_UUID_IMMUTABLE');
END;
ALTER TABLE payroll_batches ADD COLUMN central_uuid TEXT;
ALTER TABLE payroll_batches ADD COLUMN remote_sync_status TEXT NOT NULL DEFAULT 'NOT_QUEUED'
  CHECK (remote_sync_status IN ('NOT_QUEUED', 'PENDING', 'IN_PROGRESS', 'RETRY', 'SYNCED', 'FAILED', 'CONFLICT'));
ALTER TABLE payroll_batches ADD COLUMN remote_synced_at TEXT;
ALTER TABLE payroll_batches ADD COLUMN remote_error TEXT;
ALTER TABLE payroll_batches ADD COLUMN remote_revision TEXT;
CREATE UNIQUE INDEX idx_payroll_batches_central_uuid ON payroll_batches(central_uuid);
CREATE INDEX idx_payroll_batches_remote_status ON payroll_batches(remote_sync_status);
CREATE TRIGGER payroll_batches_central_uuid_immutable
BEFORE UPDATE OF central_uuid ON payroll_batches
WHEN OLD.central_uuid IS NOT NULL AND OLD.central_uuid IS NOT NEW.central_uuid
BEGIN
  SELECT RAISE(ABORT, 'CENTRAL_UUID_IMMUTABLE');
END;
ALTER TABLE report_artifacts ADD COLUMN central_uuid TEXT;
ALTER TABLE report_artifacts ADD COLUMN remote_sync_status TEXT NOT NULL DEFAULT 'NOT_QUEUED'
  CHECK (remote_sync_status IN ('NOT_QUEUED', 'PENDING', 'IN_PROGRESS', 'RETRY', 'SYNCED', 'FAILED', 'CONFLICT'));
ALTER TABLE report_artifacts ADD COLUMN remote_synced_at TEXT;
ALTER TABLE report_artifacts ADD COLUMN remote_error TEXT;
ALTER TABLE report_artifacts ADD COLUMN remote_revision TEXT;
CREATE UNIQUE INDEX idx_report_artifacts_central_uuid ON report_artifacts(central_uuid);
CREATE INDEX idx_report_artifacts_remote_status ON report_artifacts(remote_sync_status);
CREATE TRIGGER report_artifacts_central_uuid_immutable
BEFORE UPDATE OF central_uuid ON report_artifacts
WHEN OLD.central_uuid IS NOT NULL AND OLD.central_uuid IS NOT NEW.central_uuid
BEGIN
  SELECT RAISE(ABORT, 'CENTRAL_UUID_IMMUTABLE');
END;

CREATE TABLE sync_outbox (
  id INTEGER PRIMARY KEY,
  operation_uuid TEXT NOT NULL UNIQUE,
  operation_type TEXT NOT NULL CHECK (operation_type IN (
    'UPSERT_RECONCILIATION', 'UPSERT_BATCH', 'UPLOAD_BATCH_TOTALS',
    'UPLOAD_SOURCE_REPORT', 'UPLOAD_MONTHLY_TOTALS_REPORT', 'COMPLETE_SYNC')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('RECONCILIATION', 'BATCH', 'REPORT')),
  local_entity_id INTEGER,
  central_entity_uuid TEXT,
  payload_hash_sha256 TEXT NOT NULL CHECK (length(payload_hash_sha256) = 64),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'RETRY', 'SYNCED', 'FAILED', 'CONFLICT')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  last_http_status INTEGER CHECK (last_http_status IS NULL OR last_http_status BETWEEN 100 AND 599),
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  catalog_revision INTEGER,
  app_version TEXT NOT NULL,
  installation_uuid TEXT NOT NULL,
  device_uuid TEXT,
  api_origin TEXT NOT NULL,
  sync_group_uuid TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  supersedes_operation_uuid TEXT REFERENCES sync_outbox(operation_uuid),
  pause_reason TEXT CHECK (pause_reason IS NULL OR pause_reason IN ('AUTH_REQUIRED', 'USER_CANCELLED', 'BACKUP_RESTORE')),
  claimed_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  CHECK ((status = 'SYNCED' AND completed_at IS NOT NULL) OR status <> 'SYNCED'),
  UNIQUE(sync_group_uuid, sequence_number)
);
CREATE INDEX idx_sync_outbox_due ON sync_outbox(status, next_attempt_at);
CREATE INDEX idx_sync_outbox_hash ON sync_outbox(payload_hash_sha256);
CREATE INDEX idx_sync_outbox_local_mapping ON sync_outbox(entity_type, local_entity_id);
CREATE INDEX idx_sync_outbox_central_mapping ON sync_outbox(entity_type, central_entity_uuid);
CREATE INDEX idx_sync_outbox_revision ON sync_outbox(catalog_revision);
CREATE INDEX idx_sync_outbox_lease ON sync_outbox(status, lease_expires_at);

CREATE TABLE sync_outbox_dependencies (
  operation_uuid TEXT NOT NULL REFERENCES sync_outbox(operation_uuid),
  depends_on_operation_uuid TEXT NOT NULL REFERENCES sync_outbox(operation_uuid),
  PRIMARY KEY (operation_uuid, depends_on_operation_uuid),
  CHECK (operation_uuid <> depends_on_operation_uuid)
);
CREATE INDEX idx_outbox_dependency_parent ON sync_outbox_dependencies(depends_on_operation_uuid);

CREATE TRIGGER sync_outbox_intent_immutable
BEFORE UPDATE OF operation_uuid, operation_type, entity_type, payload_json, payload_hash_sha256,
  catalog_revision, app_version, installation_uuid, device_uuid, api_origin, sync_group_uuid, sequence_number,
  supersedes_operation_uuid ON sync_outbox
WHEN OLD.operation_uuid IS NOT NEW.operation_uuid
  OR OLD.operation_type IS NOT NEW.operation_type OR OLD.entity_type IS NOT NEW.entity_type
  OR OLD.payload_json IS NOT NEW.payload_json OR OLD.payload_hash_sha256 IS NOT NEW.payload_hash_sha256
  OR OLD.catalog_revision IS NOT NEW.catalog_revision OR OLD.app_version IS NOT NEW.app_version
  OR OLD.installation_uuid IS NOT NEW.installation_uuid OR OLD.device_uuid IS NOT NEW.device_uuid
  OR OLD.api_origin IS NOT NEW.api_origin OR OLD.sync_group_uuid IS NOT NEW.sync_group_uuid
  OR OLD.sequence_number IS NOT NEW.sequence_number
  OR OLD.supersedes_operation_uuid IS NOT NEW.supersedes_operation_uuid
BEGIN
  SELECT RAISE(ABORT, 'OUTBOX_INTENT_IMMUTABLE');
END;
CREATE TRIGGER sync_outbox_central_uuid_immutable
BEFORE UPDATE OF central_entity_uuid ON sync_outbox
WHEN OLD.central_entity_uuid IS NOT NULL AND OLD.central_entity_uuid IS NOT NEW.central_entity_uuid
BEGIN
  SELECT RAISE(ABORT, 'CENTRAL_UUID_IMMUTABLE');
END;
```

El índice UNIQUE de operation_uuid ya cubre ese requisito, no crear uno redundante. local_entity_id es un puntero privado sin FK polimórfica; el repositorio valida tipo/existencia y bloquea eliminación de entidades encoladas. El payload nunca contiene ese ID. Las referencias de dependencias están en UUID de operación; main valida DAG y orden al insertar. Un mensual depende de todos los lotes de su revisión, no solo del último archivo. Ningún hijo se reclama hasta que todos sus padres estén SYNCED.

device_uuid puede ser NULL solo para una intención local todavía sin vinculación válida; no enviar esa operación. Resolver el caso mediante una nueva intención explícita o un contrato de instalación aprobado, no editar una intención ya enviada. La política normal impide nuevos procesos sin sesión/dispositivo previamente vinculados.

Esta fase almacena cola y estados; no habilita envío de resultados hasta el commit/journal/spool de Fase 4. La finalización atómica es requisito de activación, no mejora opcional posterior.

## Versión 5 — immutable_reports_and_completion (Fase 4)

Los actuales índices de reporte vigente se reemplazan por índices parciales equivalentes que permiten conservar versiones. No se eliminan filas; is_current=1 preserva inicialmente cada fila actual. Cambiar los builders/mappers en la misma entrega: los ON CONFLICT actuales ya no corresponden a los índices y no deben quedar activos.

```sql
ALTER TABLE report_artifacts ADD COLUMN artifact_revision INTEGER NOT NULL DEFAULT 1 CHECK (artifact_revision > 0);
ALTER TABLE report_artifacts ADD COLUMN is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1));
ALTER TABLE report_artifacts ADD COLUMN file_size INTEGER CHECK (file_size IS NULL OR file_size >= 0);
ALTER TABLE report_artifacts ADD COLUMN spool_path TEXT;
ALTER TABLE report_artifacts ADD COLUMN catalog_revision INTEGER;
ALTER TABLE report_artifacts ADD COLUMN reconciliation_revision INTEGER;
ALTER TABLE report_artifacts ADD COLUMN supersedes_artifact_id INTEGER REFERENCES report_artifacts(id);
DROP INDEX idx_report_batch_type;
DROP INDEX idx_report_month_type;
CREATE UNIQUE INDEX idx_report_batch_current ON report_artifacts(batch_id, report_type)
  WHERE batch_id IS NOT NULL AND is_current = 1;
CREATE UNIQUE INDEX idx_report_month_current ON report_artifacts(reconciliation_id, report_type)
  WHERE reconciliation_id IS NOT NULL AND is_current = 1;
CREATE UNIQUE INDEX idx_report_batch_revision ON report_artifacts(batch_id, report_type, artifact_revision)
  WHERE batch_id IS NOT NULL;
CREATE UNIQUE INDEX idx_report_month_revision ON report_artifacts(reconciliation_id, report_type, artifact_revision)
  WHERE reconciliation_id IS NOT NULL;
CREATE INDEX idx_report_artifact_hash ON report_artifacts(file_hash_sha256);

ALTER TABLE sync_outbox ADD COLUMN report_artifact_id INTEGER REFERENCES report_artifacts(id);
CREATE INDEX idx_sync_outbox_report ON sync_outbox(report_artifact_id);

CREATE TABLE local_completion_journal (
  completion_uuid TEXT PRIMARY KEY,
  batch_id INTEGER NOT NULL UNIQUE REFERENCES payroll_batches(id),
  reconciliation_id INTEGER NOT NULL REFERENCES monthly_reconciliations(id),
  base_reconciliation_revision INTEGER NOT NULL,
  target_reconciliation_revision INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PREPARING', 'FILES_READY', 'COMMITTED', 'RECOVERY_REQUIRED')),
  manifest_json TEXT CHECK (manifest_json IS NULL OR json_valid(manifest_json)),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (target_reconciliation_revision = base_reconciliation_revision + 1)
);
CREATE INDEX idx_completion_journal_state ON local_completion_journal(state, updated_at);

CREATE TRIGGER report_synced_content_immutable
BEFORE UPDATE OF file_hash_sha256, file_size ON report_artifacts
WHEN (OLD.central_uuid IS NOT NULL OR EXISTS (
  SELECT 1 FROM sync_outbox WHERE report_artifact_id = OLD.id
)) AND (OLD.file_hash_sha256 IS NOT NEW.file_hash_sha256 OR OLD.file_size IS NOT NEW.file_size)
BEGIN
  SELECT RAISE(ABORT, 'REPORT_CONTENT_IMMUTABLE');
END;
CREATE TRIGGER outbox_report_reference_immutable
BEFORE UPDATE OF report_artifact_id ON sync_outbox
WHEN OLD.report_artifact_id IS NOT NULL AND OLD.report_artifact_id IS NOT NEW.report_artifact_id
BEGIN
  SELECT RAISE(ABORT, 'OUTBOX_REPORT_IMMUTABLE');
END;
```

### Semántica de versiones de reporte

- Cada nuevo contenido crea una fila nueva y una nueva operación; is_current marca el reporte de conveniencia vigente. Un central_uuid aceptado nunca se traslada ni cambia de fila.
- Se propone reportUuid por versión de contenido; confirmar con Laravel (D09). Si la API maneja reporte lógico y versiones con UUID separados, ajustar DDL **antes de implementar**, no reutilizar UUID con hash distinto.
- SOURCE puede tener catalog_revision única del lote; mensual usa reconciliation_revision y lista de revisiones/lotes en payload, catalog_revision nullable si mezcla revisiones.
- `spool_path` apunta a copia inmutable local verificada; no viaja a Laravel. `file_path` permite ubicación local; la copia de conveniencia del mensual no se usa para reintentar una revisión vieja.
- Relocalización cambia ruta solo tras verificar hash/tamaño; no actualiza hash de una operación existente.
- `manifest_json` del journal contiene rutas locales de trabajo, hashes, tamaños y operación/grupo UUID reservados; nunca TXT/credenciales ni datos de empleados. No exportarlo directamente como diagnóstico.
- Preparar archivos antes del commit; al confirmar cambiar is_current del anterior e insertar nueva fila dentro de la misma transacción. Conservar el anterior mientras outbox/historial lo necesiten.
- No llenar file_size de archivos antiguos con 0 inventado. Medir cuando se inspeccionen; falta de archivo queda como diagnóstico.

## Migraciones posteriores

UpdateService puede persistir política no secreta y versionada bajo claves privadas de app_settings; dejar de devolver toda la tabla al renderer. Logs rotativos no requieren tabla adicional. Cualquier necesidad posterior de DDL debe ser otra migración incremental aprobada.

## Pruebas obligatorias antes de aplicar a usuarios

Base nueva v1→v5; v1 poblada con personalizaciones/inactivos; IDs/FKs y snapshots conservados; rollback de toda la migración por error a mitad; segunda apertura sin cambios; UUID duplicado rechazado y múltiples NULL permitidos; UUID central inmutable; múltiples versiones de artefacto y un solo vigente; restricciones de payload; journal/cola recuperables. Validar en better-sqlite3/Electron real, no solo por búsqueda textual de SQL. La comprobación aislada del borrador se registra en verificacion.md y no sustituye esas pruebas productivas.

