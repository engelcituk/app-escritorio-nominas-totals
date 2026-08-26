# Fase 2 — Catálogo remoto

**Estado: cerrada y verificada contra Laravel local el 26 de agosto de 2026.** El bloqueo HTTP 500 del snapshot fue corregido en el backend por el usuario; la descarga, persistencia, consulta condicional y operación offline quedaron comprobadas con Electron.

## Decisiones de alcance

La API existente gobierna conceptos, grupos, aliases y tipos. SQLite conserva IDs y referencias históricas. Se retira el seeder productivo y toda escritura de catálogo por IPC/preload/UI. Sin snapshot verificado y vigente no se aceptan nuevos procesos; historial y reportes existentes siguen accesibles. Los resultados aún no se sincronizan (outbox y uploads son fases posteriores).

La migración v3 añade UUID, revisión, procedencia, estado de réplica y diagnósticos. No elimina registros ni asigna revisión/UUID retrospectivos a lotes históricos. Etiquetas locales de grupos/tipos se conservan como «al migrar», no como fotografías originales del procesamiento.

El enlace inicial usa code (grupos/conceptos/tipos) o normalized_description (aliases) solo en filas sin UUID. Ambigüedades abortan la aplicación transaccional y dejan diagnóstico. UUID conocido nunca cambia. Filas sin equivalencia quedan LEGACY_UNMAPPED y no son elegibles. Ausencias del snapshot completo quedan fuera de la réplica activa, sin borrar histórico.

Se conserva sortOrder remoto en central_sort_order, permitiendo empates que el OpenAPI no prohíbe. sort_order conserva su restricción UNIQUE como ordinal local: canon primero, legacy después. No se reconstruyen tablas con foreign_keys deshabilitado.

El snapshot real admite `conceptGroupUuid: null`. Se conserva ese valor en SQLite y en el checksum sin crear grupos artificiales. Los conceptos sin grupo se reconocen por sus alias y se fotografían como no seleccionados; no pueden totalizarse dentro de un grupo. Un UUID de grupo no nulo sigue exigiendo una referencia existente; omitir el campo no equivale a enviarlo como null.

Máxima antigüedad offline: configuración institucional catalogMaximumOfflineAge; el manifest real no trae vigencia ni versión mínima. Un 304 solo renueva una copia completa íntegra del mismo origen. No crea catálogo desde cero. Reloj anterior a la última validación bloquea procesamiento hasta verificar en línea.

Una descarga no bloquea nuevas cargas si existe copia vigente. Si empieza un proceso durante la descarga, se descarta el intento de aplicación y se conserva la revisión anterior; se puede reintentar al terminar. La sincronización no aplica cambios mientras se generan TXT/Excel. Preflight registra revisión y main rechaza solicitudes analizadas con otra revisión. Worker captura reglas, conceptos, alias y etiquetas en una transacción corta; evaluación usa esa captura. Ningún lock abarca lectura TXT o red.

## Diseño de interfaz antes de implementar

Skill aplicada: ui-ux-pro-max del proyecto. Se adoptan semántica, foco, contraste y estado derivado con Pinia/computed. Se descartan newsletter/hero, fuentes remotas, paleta alternativa y dependencias sugeridas sin relación con la tarea. Se conserva Vue 3 + Bootstrap 5 + SCSS institucional.

| Superficie | Objetivo y acción principal | Riesgos y jerarquía | Estados y volumen |
|---|---|---|---|
| Estado de catálogo | Conocer vigencia y sincronizar | No confundir catálogo actualizado con resultados enviados; estado → revisión/fechas → acción | loading durante sync; empty primer sync; error con copia anterior; success verificado; disabled sin sesión/proceso activo/rate limit. Solo resumen |
| Catálogo | Consultar conceptos, grupos, tipos y aliases | Canon de solo lectura; banner → filtros → tabla → detalle | loading conserva filtros; empty distingue búsqueda/primer sync; error recuperable; success revisión; disabled escritura inexistente. SQL paginado 25/50/100 y aliases bajo demanda |
| Conflictos | Identificar legacy y conflictos de enlace | No resolver cambiando UUID local; aviso → listado → administración central | loading/empty/error y conteos; sin botones de edición/resolución arbitraria; exportación JSON mediante diálogo nativo. Páginas de 25 |
| Importación | Procesar con catálogo vigente | Evitar selección stale/legacy; bloqueo explicado → periodo → archivos → conceptos → ejecutar | disabled si falta sesión/catálogo/vigencia o cambió revisión; reanálisis explícito; proceso activo continúa. Mantener preview acotado y worker/stream |
| Configuración/documentación | Consultar procedencia y operar en servidor | Separar ajustes locales de catálogo; sesión → catálogo → carpeta | Sin editor local; enlace al catálogo paginado. Ayuda estática disponible offline |

Teclado y focus visibles; iconos decorativos con aria-hidden. Errores y estados persistentes; no solo colores. UUID se ajusta al ancho. No se renderiza todo el snapshot ni todos los aliases para navegar el catálogo.

## Verificación realizada — 26 de agosto de 2026

- Typecheck de Vue/TypeScript y lint sin errores; build de renderer, main y preload.
- **136 pruebas unitarias (23 suites)**: checksum contrastado con serialización independiente de Python, Unicode/slashes, duplicados, relaciones/factores, grupo nullable sin aceptar referencias desconocidas ni campos omitidos, normalización, ETag fuerte/débil y 304, primera copia, vencimiento, cambio de reloj, permiso rechazado seguido de caída de red, respuesta tardía tras logout, backup fallido y publicación cambiante.
- Integración nativa Electron/SQLite: v1→v3 y v2→v3, copia previa, IDs conservados, UUID inmutables, conflictos ambiguos, rollback, códigos intercambiados, sortOrder con empates, bajas sin borrar histórico, fotos de reglas/alias/etiquetas inalteradas, FK e integridad. Incluye reconstrucción del checksum con grupo null, reconocimiento y captura de conceptos sin grupo, y rechazo de su selección dentro de ISR. La nómina de regresión mantiene **330090 centavos ($3300.90)** y el reemplazo fallido conserva la versión activa y su reporte.
- E2E Electron con **servidor HTTP de contrato aislado**: login, primera copia, consulta de alias, ausencia de CRUD en preload, reanálisis obligatorio tras cambiar revisión, procesamiento offline y generación de Excel, respaldo ZIP y restauración mediante IPC, identidad conservada y nueva verificación obligatoria. Sin desbordamiento horizontal a 980/1024/1440 px. Capturas en `test-results/catalog` (ignoradas por Git).
- La prueba de interfaz descubrió un estado de análisis modificado fuera de la reactividad de Vue; se corrigió usando estados reactivos por archivo. No se cambió el cálculo de importes.

## Integración real completada

Tras el fix del usuario, Laravel respondió **200 al manifest**, **200 al snapshot** y **304 al manifest condicional**. Se aplicó la revisión **1**, checksum `f3f07a22dcf290786f9f0dabf13ae2deff1297343d033097eee7ed0b4e15767e`, verificado nuevamente desde las filas persistidas. El cliente acepta el ETag débil `W/"…"` observado en las respuestas 200 y el fuerte observado en el 304, manteniendo la comprobación SHA-256 independiente.

La descarga reveló la relación de grupo nullable que la copia inicial de OpenAPI no declaraba. Se corrigió el contrato del cliente, su persistencia y la captura de reglas; el resto de la validación estricta permanece. El catálogo real pasó la validación de normalización y referencias.

`scripts/integration-auth.mjs`, ejecutado mediante `scripts/run-auth-integration.mjs` con `catalog: true`, verificó login, safeStorage nativo, restauración y heartbeat, primera descarga, checksum persistido, 304 y cierre de sesión remoto confirmado mediante 401 del token revocado. TLS permaneció habilitado.

`scripts/e2e-auth.mjs` con `catalog: true` comprobó desde Electron: primera sincronización, **89 conceptos activos**, catálogo y alias de solo lectura, ausencia de CRUD en preload, persistencia después de cerrar y abrir el proceso, identidad estable, procesamiento del TXT sintético con la red cancelada solo en la sesión API del cliente y **dos archivos Excel locales no vacíos**. Se restableció la conexión antes de cerrar sesión. Las capturas del catálogo real se revisaron a 980/1440 px sin desbordamiento; están en `test-results/auth` (ignorado por Git).

No se modificó el backend ni sus catálogos, ni se enviaron TXT, resultados o Excel. Solo se crearon sesiones/dispositivos de prueba mediante los endpoints desktop autorizados; los tokens se revocaron al terminar. Se usaron perfiles y bases temporales, sin guardar contraseñas ni tokens en código, SQLite o capturas. Los dispositivos de prueba pueden seguir apareciendo en la administración central sin tokens activos.

## Operación, límites y reversibilidad

- Sincronización automática al autenticar/restaurar y tras verificaciones de sesión; botón manual. Un solo intento concurrente, una repetición por cambio de publicación y respeto de Retry-After. No hay outbox ni motor de reintentos salientes en esta fase.
- `snapshot_schema_version=1` identifica el formato compatible del cliente; la API actual no declara ese campo. Checksum cubre únicamente las cuatro listas, ordenadas por UUID y claves. Una futura versión incompatible exige otro contrato del cliente.
- Snapshot limitado a 32 MiB, 10000 grupos, 50000 conceptos, 150000 alias y 10000 tipos; respuestas mayores se rechazan conservando la copia anterior. Consulta paginada de 25/50/100 filas; alias/diagnóstico de 25. Selector de grupos limitado a 1000 activos con error explícito si se excede. Exportación JSON de diagnóstico hasta 100000 filas; se rechaza una exportación mayor sin truncarla.
- No se imponen códigos en mayúsculas que OpenAPI no declare. Para rutas de reportes se mantienen los códigos históricos seguros; los demás se convierten en un segmento con hash. Las etiquetas originales permanecen en SQLite/Excel. Se evitan traversal, nombres reservados de Windows y colisiones por mayúsculas/minúsculas.
- La restauración respalda incluyendo WAL, valida integridad/FK, conserva identidad y marca verificación requerida antes del reemplazo. No corre durante procesamiento/sync. Revoca los permisos temporales de selección de archivos/carpetas. No cambia el token del equipo.
- Un 403 de catálogos o fallo TLS exige verificación completa antes de volver a procesar; una caída de red posterior no borra ese bloqueo. Una descarga corrupta conserva la copia anterior y su vigencia.
- Las fotografías históricas no reciben UUID ni revisión retrospectivos. Las etiquetas capturadas en v3 se identifican como `LEGACY_AT_MIGRATION`. Los lotes nuevos guardan UUID, revisión, conceptos, alias y etiquetas en la misma transacción de creación.
- No se generó instalador ni se tocaron datos de trabajo del usuario. La migración v3 de esta entrega todavía no está publicada; las pruebas usaron perfiles y bases temporales.
