# Fase 4 — Resultados y reportes

**Estado: implementada y verificada el 26 de agosto de 2026.** Sin cambios en Laravel ni avance de la fase de actualizaciones.

## Decisiones de implementación

- Cada intención local produce cuatro operaciones independientes, con UUID/hash persistentes: expediente, lote, SOURCE y MONTHLY_TOTALS. Se serializan las publicaciones de un mismo expediente; un error anterior bloquea las posteriores.
- Las fotografías del catálogo y los totales por concepto se envían dentro del lote. Los IDs SQLite, rutas, TXT crudos y credenciales no forman parte de los DTO. El Excel SOURCE sí contiene el detalle del TXT que el usuario procesó.
- Quincena local 1–24 se traduce a 1/2 dentro del mes. Los registros sin clasificar cuentan como válidos sin coincidencia en el contrato remoto; no se alteran los cálculos locales.
- Cada publicación conserva metadatos y copias independientes de ambos Excel en `sync-files`, identificadas por SHA-256. Nunca se toma el mensual vigente para una revisión histórica distinta.
- Un fallo de red, contrato o preparación del envío no revierte un resultado local completado. El diagnóstico de la cola explica el bloqueo.
- La entrega se confirma consultando la operación remota. Los reportes se registran, suben completos y se confirman; el contrato no ofrece subida por fragmentos. Un reintento consulta la reserva y el estado del artefacto antes de repetir bytes.
- El historial remoto consulta exclusivamente UUID de expedientes ya vinculados a esta instalación: la API documentada no ofrece un listado global.

## Interfaz (Vue 3, Bootstrap 5 y SCSS)

Objetivo: distinguir trabajo local terminado, envío pendiente y disponibilidad central. Acción principal: procesar la cola disponible; acción secundaria: consultar el expediente central.

Riesgos: confundir bytes enviados con disponibilidad, repetir una versión, perder el mensual de una revisión o mostrar datos remotos como si estuvieran actualizados sin conexión. Se mantienen UUID, fechas de consulta y estados explícitos.

Jerarquía: estado y acciones, progreso del reporte activo, catálogo, tabla paginada de operaciones y diagnóstico/historial del recurso seleccionado. Sin tarjetas decorativas ni nuevas dependencias visuales. Se conservan tipografía, colores institucionales, contraste y foco visibles.

Estados: loading con texto y `aria-busy`; empty explicativo; error sanitizado con datos locales conservados; success solo tras ACK; disabled durante envío, desconexión o dependencias. La barra de transferencia nunca equivale a confirmación. Las listas locales se paginan en SQLite; el historial remoto limita la respuesta y pagina lotes en la vista.

## Persistencia, transporte y límites

Migración v5 aditiva con respaldo SQLite consistente previo. `sync_publications` guarda la fotografía de los DTO; `sync_report_files` vincula cada publicación a los bytes originales; `sync_delivery_steps` conserva el vínculo entre intención y operaciones. Los UUID centrales quedan en las operaciones confirmadas y se resuelven por esas relaciones, incluso después de recuperar una respuesta perdida. Triggers impiden modificar fotografías y vínculos.

La subida usa `net.request` de Electron, sesión central separada, TLS normal, sin cookies y sin seguir redirecciones. Se envía multipart por chunks desde disco, sin construir un Buffer/Blob del archivo completo en main. Chromium puede mantener su propia cola de envío. Su contador de progreso es informativo: no se usa como control de flujo porque puede no avanzar antes de `end()`. Los callbacks de `write` tampoco garantizan recepción en el servidor. [Contrato de ClientRequest](https://www.electronjs.org/docs/latest/api/client-request).

Límites: 100 MiB por Excel, 120 segundos por upload; pueden existir límites menores de PHP/proxy. Las respuestas ordinarias se acotan y el historial se limita a 8 MiB/10 000 lotes, con páginas visuales de 25. No hay reanudación por fragmentos: PENDING/FAILED sube completo; UPLOADING intenta completar; AVAILABLE se verifica sin volver a subir.

Los ZIP incluyen las copias `sync-files` referenciadas y se verifican por hash/tamaño al crear/restaurar. El límite actual del ZIP es **256 MiB sin comprimir**, debido a AdmZip; archivos mayores requieren respaldo administrado de SQLite y `sync-files`. No hay eliminación automática de las copias confirmadas. Los respaldos SQLite automáticos de migración no sustituyen el respaldo de archivos.

Una intención de fase 3 solo se prepara si todavía existe el mensual de su revisión. Si fue sobrescrito, queda `HISTORICAL_REPORT_MISSING`: requiere recuperación/revisión administrada y bloquea publicaciones posteriores de ese expediente. No se inventa un reporte histórico ni se descarta una operación parcialmente aplicada. Un Excel faltante/corrupto o falta de espacio permite reintento explícito después de resolver la causa; los conflictos de contrato/identidad no cambian UUID ni contenido.

## Verificación ejecutada

- 156 pruebas unitarias, TypeScript, ESLint y build de main/preload/renderer.
- Integración Electron/SQLite: migración v4→v5 con respaldo, copias de dos revisiones mensuales, orden por expediente, hashes, archivo corrupto, mensual histórico no sustituido, recuperación de archivo faltante desde ZIP y UUID persistentes.
- Adaptadores productivos con API simulada: respuesta perdida tras upload (sin segunda subida), respuesta perdida tras complete (consulta de ACK), cuatro reportes AVAILABLE y totales por concepto conciliados. No se presenta esta simulación como Laravel real.
- Transporte real de Chromium contra servidor local temporal: multipart de 3 MiB, bytes exactos, cookies omitidas, cancelación y redirecciones rechazadas.
- E2E con servidor contractual: procesamiento offline, restauración ZIP/SQLite, entrega completa, historial, foco de apertura/cierre y pantallas de 980/1440 px sin desbordamiento de página.
- **Laravel local real** `https://tools-sefiplan.test`: catálogo revisión 1 (89 conceptos activos), procesamiento offline del fixture sintético `uniform-isr.txt`, entrega de expediente/lote/SOURCE/MONTHLY_TOTALS, cinco filas locales SYNCED (intención + cuatro operaciones), historial central y reinicio sin crear operaciones nuevas. Periodo de prueba **diciembre de 2099**, total central **$2,040.55**, cuatro líneas; los dos reportes terminaron AVAILABLE. Logout confirmado y contraseña no persistida en código.

La prueba dejó el expediente sintético central `e99cd8b3-88d7-41ce-bbea-c715d889a308` y lote `5378ef1c-b63a-476e-b0fd-b3784671853d` para inspección. No se borraron recursos centrales al finalizar.

Comandos (después de compilar): `npm test`, `npm run typecheck`, `npm run lint`, `node scripts/run-pipeline-integration.mjs`, `node scripts/e2e-file-selection.mjs`. La prueba real usa `scripts/e2e-auth.mjs` con credenciales efímeras por entrada/entorno; nunca guardarlas en archivos. El lanzador de integración limpia el perfil de Chromium después de cerrar Electron para evitar locks en Windows.
