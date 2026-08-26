# Contrato esperado — borrador de negociación 0.1

> **Actualización Fase 1 (2026-08-26): borrador histórico.** Ya se obtuvo el [OpenAPI real](../contracts/tools-sefiplan.openapi.json). Consultar [diferencias](../contracts/README.md) y [autenticación implementada](fase-1.md). No implementar rutas/schemas usando las propuestas siguientes.

**No es OpenAPI de Laravel ni un contrato aprobado.** No se encontró OpenAPI/Swagger/documento de contrato en el repositorio auditado. Las rutas marcadas “solicitada” provienen del requerimiento del usuario; no se verificó su existencia en un servidor. Los campos adicionales y comportamientos son propuestas para cerrar ambigüedades antes de implementar.

No crear un mock que convierta este borrador unilateral en fuente de verdad. Primero recibir/aprobar el documento con el equipo Laravel, fijar versión/hash y después implementar schemas Zod y mock separado con fixtures versionadas. Fase 0 entrega esta especificación esperada, no servicios ni mocks productivos.

## 1. Convenciones por confirmar

| Tema | Requisito / propuesta | Confirmación necesaria |
|---|---|---|
| Transporte | HTTPS institucional; JSON UTF-8; multipart para Excel | Base URL, CA/proxy, origen de uploads y feed |
| Identidad | UUID canónico; ningún ID SQLite/MySQL remoto | Formato/versión admitida, ámbito de institución/tenant |
| Fechas | RFC 3339 UTC; no fechas locales sin offset | Precisión y headers de tiempo del servidor |
| Importes | Centavos enteros exactos | Máximo safe integer o decimal string si supera 2^53−1; no redondear |
| Revision catálogo | Entero no negativo, monotónico por ámbito | No usar como identificador global entre instituciones |
| Revisión de entidad | Opaca, persistida sin coerción | ETag/If-Match o campo explícito para concurrencia |
| Nombres/códigos | Canon preservado; code único y legible | Longitudes, Unicode, normalización de aliases y restricciones de rutas |
| Envelope | Pendiente: objeto directo o `{data: ...}` | Elegir uno en contrato; no tolerar ambos heurísticamente |
| Límites | Tiempo, bytes JSON, arrays, tamaño Excel y páginas acotados | Valores de API y política administrada |
| Desconocidos | Rechazar esquema de snapshot no soportado y relaciones desconocidas | Versionado compatible, no descartar campos antes de verificar hash |
| Errores | Código estable + correlationId + campos validados permitidos | No mostrar cuerpo HTML, excepciones, SQL ni stack al usuario |
| Paginación | API de catálogos debe entregar snapshot completo consistente | Si fragmentado: manifest con partes/hash y commit de todas juntas |

Los IDs locales sí permanecen en IPC para selección/consulta local; no confundir el contrato `SefiplanApi` actual con un contrato REST. Construir DTO remoto con lista permitida, nunca `SELECT *` serializado.

## 2. Endpoints conocidos y huecos

| Operación | Método/ruta | Estado | Petición/resultado esperado |
|---|---|---|---|
| Login y registro/vinculación de equipo | POST `/api/v1/desktop/tokens` | Solicitada | Credenciales + identidad instalación/nombre/appVersion/platform; LoginResponse |
| Heartbeat | POST `/api/v1/desktop/heartbeat` | Solicitada | deviceUuid, installationUuid, appVersion, platform; DeviceResponse |
| Manifest | GET `/api/v1/catalogs/manifest` | Solicitada | If-None-Match si existe ETag; 200 CatalogManifest o 304 sin JSON |
| Snapshot | GET `/api/v1/catalogs/snapshot` | Solicitada | CatalogSnapshot de la revisión del manifest |
| Política de versión | GET `/api/v1/desktop/version-policy` | Solicitada | VersionPolicyResponse para canal/plataforma |
| Validar/restaurar sesión | **Por definir** | Bloqueante | Usuario/dispositivo/abilities/expiración; no asumir refresh token |
| Revocar token actual/logout | **Por definir** | Bloqueante | Revocación idempotente; borrar token local aun si falla |
| Upsert expediente | **Por definir** | Bloqueante | UPSERT_RECONCILIATION → ReconciliationResponse |
| Upsert/reemplazo de lote | **Por definir** | Bloqueante | UPSERT_BATCH → BatchResponse; revisión base y lote sustituido |
| Totales de lote | **Por definir** | Bloqueante | UPLOAD_BATCH_TOTALS → SyncOperationResponse |
| Registrar reporte | **Por definir** | Bloqueante | Tipo, propietario UUID, revisión, nombre, bytes, SHA-256 → ReportResponse |
| Transferir/confirmar/consultar reporte | **Por definir** | Bloqueante | Stream y ACK de disponibilidad, hash, bytes |
| Completar sincronización | **Por definir** | Bloqueante | COMPLETE_SYNC → SyncOperationResponse de la revisión completa |
| Consultar ACK por operationUuid | **Por definir o replay suficiente** | Bloqueante | Recuperación de respuesta perdida/restauración |
| Feed por canal | **Por definir** | Bloqueante | latest.yml + EXE + blockmap; autorización/range/redirects |
| Reporte/backoffice | **Rutas permitidas por definir** | Bloqueante | Construcción desde UUID validado en main, sin token en URL |

No elegir rutas inventadas para las operaciones salientes. Laravel puede exponer recursos separados o un endpoint de operaciones; debe quedar fijado antes del cliente.

## 3. Schemas Zod a crear tras aprobación

La siguiente tabla define el contenido esperado, no código ejecutable. Todo schema de red reside en main/shared sin traer tokens a bundles de renderer por importaciones de runtime innecesarias. `LoginResponse` nunca es un DTO IPC.

| Schema | Campos y validaciones mínimas |
|---|---|
| LoginResponse | `token` string no vacío y acotado (solo main); `user` con identidad UUID/nombre; `device` DeviceResponse; `abilities` array de strings acotados; proponer `expiresAt` nullable y ámbito institucional |
| DeviceResponse | `deviceUuid`, `installationUuid`, `deviceName`, estado de revocación y fechas; nombres exactos del envelope pendientes; comparar installationUuid con instalación solicitante |
| CatalogManifest | `revision`, `checksumSha256` hex64, `snapshotSchemaVersion`; `validUntil` nullable, `maximumOfflineAge` con unidad explícita, `minimumSupportedAppVersion`; proponer ETag separado |
| CatalogSnapshot | schemaVersion/revision + arrays `conceptGroups`, `concepts`, `conceptAliases`, `payrollTypes`; mismo ámbito y revisión que manifest |
| ConceptGroup | `uuid`, `code`, `name`, `active`; código único por ámbito |
| PayrollConcept | `uuid`, `code`, `name`, `conceptGroupUuid` nullable si el dominio lo permite, `operationFactor` −1 o 1, `active` |
| ConceptAlias | `uuid`, `conceptUuid`, `sourceDescription`, `normalizedDescription`, `active`; unicidad activa de descripción normalizada |
| PayrollType | `uuid`, `code`, `name`, `active`, `sortOrder`; acordar si sortOrder único como SQLite actual |
| ReconciliationResponse | `operationUuid`, `reconciliationUuid`, revisión remota y ACK/hash de petición; si UUID ya conocido, exigir igualdad |
| BatchResponse | `operationUuid`, `batchUuid`, `reconciliationUuid`, revisión remota, ACK/hash; identidad de versión/reemplazo |
| ReportResponse | `reportUuid`, tipo SOURCE/MONTHLY_TOTALS, propietario UUID, hash SHA-256, tamaño, estado de disponibilidad, revisión; transporte/uploadUrl solo si contrato lo establece |
| SyncOperationResponse | `operationUuid`, `payloadHashSha256`, estado aplicado/replay, referencias de entidad UUID y revisión; ACK no puede corresponder a otra operación |
| VersionPolicyResponse | latestVersion, minimumSupportedVersion, mandatory; proponer canal/plataforma/validUntil y semántica de bloqueo; currentVersion se toma localmente, validar eco si API lo incluye |
| UpdateStatus | DTO IPC: estado enum solicitado, currentVersion, availableVersion nullable, required boolean, progreso 0–100 nullable, canInstall, código/mensaje saneado; sin URL privada, header, token ni objeto autoUpdater |

Para cada schema: fixture válida, campos obligatorios ausentes, tipo incorrecto, UUID/hash inválido, límite excedido, relaciones desconocidas, respuesta de revisión incorrecta y cuerpo con campos sensibles. No “arreglar” respuestas coercionando identificadores numéricos a UUID.

## 4. Checksum y serialización determinista

**Propuesta a acordar y probar idénticamente en PHP y TypeScript**:

1. Definir exactamente el documento cubierto: schemaVersion, revision y los cuatro arrays completos de catálogos; decidir si también cubre vigencia/política. El checksum no se incluye a sí mismo.
2. Validar esquema y unicidad de UUID antes de canonicalizar. No aceptar NaN, Infinity, undefined ni números fuera del rango permitido.
3. Ordenar cada colección de catálogos por UUID canónico con comparación de bytes, no localeCompare. Ordenar claves de objetos mediante algoritmo canónico acordado (por ejemplo JCS/RFC 8785 si ambos lados lo implementan).
4. Preservar valores del canon y distinguir null/ausente. No quitar acentos, convertir mayúsculas o normalizar nombres antes del hash. Campos no soportados provocan rechazo/versionado, no eliminación silenciosa.
5. Serializar sin espacios superfluos/BOM y calcular SHA-256 sobre UTF-8. Compresión HTTP no cambia el documento lógico hasheado.
6. Confirmar vectores de prueba PHP↔TS, incluidos Unicode, escapes, arrays vacíos, null, orden de claves y cantidades límite.

ETag no se deduce arbitrariamente de checksum: acordar quotes/prefijo débil/formato. Guardar manifest_etag. Un 304 no tiene cuerpo para Zod y no renueva vigencia sin contrato explícito. Si el snapshot nuevo llega con misma revisión/hash distinto, rechazar y diagnosticar; una revisión inferior requiere procedimiento central de rollback autorizado, no aceptación silenciosa.

## 5. Payloads salientes e identidad

Campos comunes requeridos: operationUuid, payloadHashSha256, catalogRevision (o procedencia por lotes en un mensual mixto), appVersion, installationUuid, deviceUuid. Nunca IDs SQLite/MySQL, rutas absolutas, TXT ni credenciales. `originalFilename` se valida como nombre, sin ruta. El hash del TXT puede viajar como metadato autorizado; su contenido no.

Hash del payload: fijar un objeto de negocio inmutable sin `payloadHashSha256` para evitar autorreferencia. Incluir operationUuid y contexto acordado; persistir JSON canónico y hash una vez. Definir en contrato si UUID/hash viajan en headers o envelope; no enviar hashes de objetos diferentes según endpoint. El hash del Excel es independiente del hash del payload.

| Operación | Contenido esperado adicional |
|---|---|
| UPSERT_RECONCILIATION | year, month, conceptGroupUuid, revisión local objetivo, revisión remota base, contexto de identidad de expediente |
| UPSERT_BATCH | reconciliationUuid o referencia UUID predecesora aprobada; year/month/fortnight, conceptGroupUuid, payrollTypeUuid, layoutCode/layoutVersion, originalFilename, fileSize, fileHashSha256, version, contadores y totalAmountCents; referencia UUID al lote reemplazado |
| UPLOAD_BATCH_TOTALS | batchUuid/referencia aprobada; grupos por conceptUuid y dimensiones contables (fuente, cuenta, movimiento), factor, conteo y centavos originales/netos; totales y paginación/partes si volumen excede límite |
| UPLOAD_SOURCE_REPORT | Reporte SOURCE del lote, revisión, nombre seguro, tamaño y SHA-256; bytes fuera de JSON mediante multipart |
| UPLOAD_MONTHLY_TOTALS_REPORT | Expediente y revisión exacta, conjunto de lotes/revisiones de catálogo, tamaño/hash del mensual inmutable |
| COMPLETE_SYNC | UUID/revisión de expediente y dependencias/ACK necesarios; servidor valida integridad antes de declararlo completo |

El alcance de datos de retenidos y tablas agregadas autorizadas debe aprobarse; no enviar nombres de empleados por defecto dentro de totales. Los SOURCE ya contienen datos personales: tratarlos conforme a la política institucional de acceso, sin afirmar anonimización.

### Dependencias sin UUID central todavía

Tres contratos posibles, **se debe elegir uno**:

1. Preferido en este borrador: Laravel permite referencias a `reconciliationOperationUuid`/`batchOperationUuid`, resuelve el UUID central asociado a un ACK y mantiene el payload inmutable aun cuando `reconciliationUuid` inicial es null.
2. Laravel acepta UUID de entidad reservado por cliente como identidad definitiva y lo devuelve sin cambiarlo. `central_uuid` local se confirma tras ACK.
3. Materialización diferida: intención durable separada de petición HTTP; completar UUID y congelar petición/hash exactamente una vez antes del primer envío. Requiere ajustar el modelo propuesto y definir qué hash identifica cada capa.

No asumir compatibilidad de la opción 1. El schema SQL de outbox y su trigger de inmutabilidad se revisan si se adopta la opción 3. No mutar payload/hash de un reintento para rellenar la dependencia.

### Concurrencia institucional

Definir alcance de unicidad de expediente (institución + año + mes + grupo UUID), del slot activo (expediente + quincena + tipo UUID) y del hash de archivo. Una versión local no es automáticamente la versión institucional si otro equipo subió antes. Usar revisión base/If-Match o contrato equivalente; 409 lleva diagnóstico y no provoca sobrescritura automática. No combinar totales mensuales de dos equipos sin política explícita de Laravel.

Idempotencia sobrevive reinicio/restauración y cambio de token autorizado en la misma instalación/ámbito. Acordar qué ocurre al autenticarse un usuario diferente; nunca permitir que su sesión envíe cola de otro ámbito por accidente.

## 6. Upload y feed

Contrato de registro/transferencia/confirmación debe definir: nombre de campo multipart, Content-Type, tamaño máximo, hash de bytes descomprimidos del archivo, códigos de ya existente, ACK y estados de verificación. `AVAILABLE` requiere hash/tamaño coincidentes; `UPLOADING` no equivale a éxito. Una respuesta perdida tras subir debe permitir consulta o replay sin crear otro reporte.

Multipart inicial se transmite con longitud calculada o chunked aceptado por servidor, sin buffer de archivo completo. Si hay uploadUrl, exigir HTTPS/origen permitido y método/expiración; no adjuntar bearer a almacenamiento externo salvo autorización contractual específica. Futuro resumable necesita uploadSessionUuid, offsets/partes, hashes y cancelación acordados; no implementarlo con suposiciones.

Feed institucional debe conservar formato electron-builder: latest.yml coherente con EXE y blockmap generados, rangos para descarga diferencial y firma Authenticode válida. Los hashes propios del feed no se reemplazan por SHA-256 de reportes. Laravel publica el conjunto de manera atómica y conserva N-1 para pruebas/recuperación. Definir cómo un cliente UPDATE_REQUIRED sin sesión válida obtiene actualización sin ampliar abilities de datos ni colocar secretos en URL.

## 7. Frontera IPC esperada

| Namespace | Métodos específicos | Respuesta |
|---|---|---|
| auth | login, logout, status | Auth DTO sin token; errores saneados |
| sync | status, retry, listPending, onStatusChanged | Estado derivado, páginas ≤100, unsubscribe |
| catalog | status, synchronize | Revisión, vigencia, conteos, resultado de sync |
| updates | check, download, install, onStatusChanged | UpdateStatus saneado |

Complementos a aprobar: listado/exportación de conflictos, relocalizar reporte por diálogo, abrir backoffice/reporte central mediante objetivo enumerado, opción de instalar al cerrar. No exponer invoke/send genéricos ni callbacks Electron completos. Validación Zod y sender/senderFrame en todos los canales, incluidas lecturas.

## 8. Mock y aceptación del contrato

Tras recibir contrato aprobado: ubicar OpenAPI/documento con versión y hash en `docs/contracts/nomina-central/v1`, fixtures en `tests/fixtures/central/v1` y servidor aislado en `tests/support/central-mock`. Estos paths son propuestas, no archivos creados en Fase 0. El mock no se importa desde main productivo ni desde installPreviewApi.

Escenarios: login correcto/incorrecto, expiración/revocación, 304, snapshot nuevo/corrupto/cambio de revisión, 429 Retry-After, 5xx/timeouts, desconexión después de aplicar, mismo UUID distinto hash, conflictos entre equipos, upload existente/faltante/cancelado/confirmación perdida. El mock conserva un ledger de idempotencia y sirve archivos pequeños sintéticos por stream.

Pruebas de contrato ejecutan los mismos schemas contra fixture oficial y mock; cuando exista staging, repetir contra Laravel con datos sintéticos y autorización. No llamar “integración Laravel validada” a una prueba que solo usa mock.
