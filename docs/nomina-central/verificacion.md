# Verificación de Fase 0 y plan de pruebas

## 1. Resultados observados en esta entrega

Ámbito: documentación de arquitectura, no implementación de sincronización. Los resultados siguientes son comprobaciones ejecutadas, no resultados esperados de fases futuras.

| Verificación | Resultado | Alcance/límite |
|---|---|---|
| Git inicial | Limpio; HEAD `3f77872d13a1422a49f898b080058b1dad5af226` | Sin modificaciones previas que preservar |
| Node local | 22.20.0 | Runtime de comprobación de herramientas |
| Electron instalado | 37.10.3 | Leído en node_modules; SafeStorage sin API async en sus tipos |
| Typecheck | Correcto, exit 0 | vue-tsc renderer + tsc main, ambos sin emitir |
| Lint | Correcto, exit 0 | eslint con max-warnings=0 |
| Pruebas unitarias existentes | **16 archivos, 52 pruebas correctas**, exit 0 | Vitest 3.2.7; duración reportada 16.92 s; no es benchmark de procesamiento |
| Borrador SQL | Cuatro bloques v2–v5 ejecutados en SQLite **en memoria**, exit 0 | SQLite Python 3.53.1, no better-sqlite3/Electron ni base operativa |
| Base v1 vacía → DDL v5 | Correcto | integrity_check=ok y foreign_key_check vacío |
| Base v1 con datos sintéticos personalizados → DDL v5 | Correcto | IDs, nombres, factor y snapshots preservados; UUID/revisión legacy permanecen NULL |
| Restricciones del DDL | Correcto | UUID central inmutable; una versión vigente y múltiples artefactos históricos; payload/hash outbox inmutables; hash de reporte encolado inmutable |
| Rollback DDL | Correcto | Error inyectado tras bloque de catálogo revierte columnas/tablas nuevas y conserva datos v1 |
| Revisión documental y alcance | Correcto | Cinco Markdown con enlaces locales existentes, fences equilibrados y sin whitespace final; Git solo muestra `docs/nomina-central/` nuevo |
| Bases del usuario / datos reales | **No accedidos** | Ninguna migración aplicada a instalación existente |

El comando `npm --version` falló inicialmente porque el launcher resolvió un npm global incompleto en AppData. No se reparó ni modificó el entorno del usuario: las verificaciones se ejecutaron mediante el npm-cli instalado junto a Node:

```powershell
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run typecheck
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run lint
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' test
```

Comprobación DDL: se extrajo el SQL v1 actual y los cuatro bloques SQL del documento de migraciones, se aplicaron con BEGIN/COMMIT a bases `:memory:` vacías y pobladas con grupo/concepto/alias/tipo/expediente/lote/snapshots/reporte sintéticos. Se ejecutaron aserciones de integridad, restricciones y rollback. No se añadió un runner productivo ni un archivo de pruebas que simule la futura implementación.

**No ejecutado en Fase 0:** build/instalador, integración Electron, E2E visual, benchmark TXT, login contra Laravel, mock contractual, upload real, safeStorage real bajo Windows, actualización instalada N-1→N, restauración de backup operativo. Esas comprobaciones no se sustituyen con las 52 pruebas unitarias.

No corresponde comparar antes/después de procesamiento en un cambio exclusivamente documental. Sí debe obtenerse baseline representativo **antes de Fase 2**, que altera captura de catálogo, y repetir en Fases 3–6.

## 2. Cobertura existente leída

| Suites/scripts | Cobertura observada | Huecos relevantes |
|---|---|---|
| money, normalization, rules, payroll-evaluator | Centavos, reintegros, aliases exactos, retenidos | Límites monetarios remotos, catálogo mutable entre capturas |
| layout-parser, preflight, employee-numbers | Layout de 22 columnas, inventario, validación de archivos/empleados | Procesamiento offline con sesión/política, cardinalidad alta |
| process-schema, ipc-serialization, error-message | Payload de importación, clonación Vue/IPC, mensajes | Sender/frame, schemas completos IPC, secretos en errores |
| payroll-period, payroll-field-labels, report-path | Periodos, etiquetas, nombres/rutas | UUID/versión de catálogo y cambio remoto de códigos |
| payroll-types, schema | Constantes iniciales y fragmentos SQL v1 | Migraciones reales: actualmente exigen una sola migración |
| utf8-source | Marcadores de mojibake en fuentes/pruebas | No verifica contrato ni semántica de documentación |
| integration-pipeline.mjs | Worker/builders, dos quincenas, reemplazo, centavos y hojas Excel con datos sintéticos | Replica parte del servicio, no cubre commit real/outbox ni caída entre pasos |
| e2e-file-selection.mjs | Preload, selección, preflight, conceptos, procesamiento, anchura a dos tamaños | Auth/estado central, teclado/foco completo, actualización |
| generate-benchmark-file.mjs | Genera TXT sintético con backpressure | **No mide** tiempos, memoria, throughput o regresión |

## 3. Matriz de pruebas por fase

| Fase | Unitarias | Integración / evidencia de aceptación |
|---|---|---|
| 1 | ApiClient: timeout/abort/HTTP/Zod/límites/redirects; AuthService: login/logout/restore/race; SecureTokenStore: cifrado no disponible, escritura/lectura corrupta; DeviceService: singleton | Mock contractual login/401/403 revocado; token no presente en DTO/SQLite/logs; DPAPI real con usuario de pruebas; IPC de sender ajeno rechazado |
| 2 | Serialización/hash, UUID mapping, política offline/estado derivado; validación de relaciones | v1 nueva/poblada/personalizada; code swaps/sort_order; alias duplicados; UUID distinto; rollback de snapshot; 304; vigencia; seeders no sobrescriben canon; snapshot inmutable durante sincronización |
| 3 | Outbox: hash estable/errores/backoff/jitter/Retry-After/dependencias; conectividad; single-flight | Reinicio con PENDING/IN_PROGRESS; doble claim; mismo UUID/hash; 409/422 no retry automático; revocación pausa sin borrar; reconexiones repetidas no duplican ciclos |
| 4 | Mappers sin IDs/rutas/TXT; reporte hash/tamaño; estados de progreso/cancelación; journal | Commit local+outbox, archivos faltantes/movidos; SOURCE y mensual streaming al servidor; respuesta perdida tras ACK; hash diferente; reporte ya disponible; versiones mensuales pendientes sobreviven regeneración; múltiples dispositivos y reemplazos |
| 5 | SemVer/canal/política/required; todas las guardas de instalación y eventos | Feed autenticado en YAML/EXE/blockmap, firma inválida rechazada, error recuperable, descarga durante proceso, instalación diferida; **NSIS real N-1→N**, migración, reinicio y datos intactos |
| 6 | Sanitización por lista permitida, rotación, validación de backup y export | Backup WAL consistente/restauración con pendientes e identidad; ZIP inválido/límites; seguridad IPC completa, accesibilidad y benchmark representativo |

Preferir extender suites/fixtures existentes cuando cubran el dominio. Crear suites nuevas solo para capas nuevas. No sustituir pruebas de comportamiento por aserciones sobre nombres de servicios o número fijo de migraciones.

## 4. Escenarios transversales imprescindibles

### Estado y autorización

Tabla de combinaciones con reloj falso: no configurado, sin token, token expirado/revocado, nunca sincronizado, catálogo válido offline, catálogo vencido online/offline, error outbox con catálogo válido, sync en curso con/sin catálogo, update obligatorio y proceso activo. Verificar motivos/permiso, no solo label del estado. Volver a validar en main para que un renderer modificado no inicie procesos bloqueados.

### Seguridad

Usar secretos canario sintéticos y comprobar que no aparecen en IPC, Pinia, SQLite, logs, diagnóstico, URL o mensajes de errores. Probar raw body con token en error, redirect cross-origin, URL con credenciales, TLS inválido, frame hijo y ventana distinta; navegación/ventanas externas rechazadas. Verificar logout incluso si revocación remota falla y respuesta de login vieja llega después. Tokens de archivos no permiten paths arbitrarios.

### Catálogo

Snapshot idéntico, UUID repetido, code ocupado por otra identidad, normalización incompatible, factor fuera de −1/1, alias padre faltante, grupo inactivo, revisión regresiva, schema no soportado, cambio de revisión entre manifest/snapshot, checksum inválido, 304 sin catálogo previo, vigencia que no se extiende por 304. Con fallo, revisión/checksum/datos anteriores intactos y diagnóstico persistido aparte.

### Caídas y durabilidad

Inyectar cierre en: antes/después de journal, durante Excel, después de archivos listos, antes/durante/después de commit local+outbox, tras envío remoto antes del ACK local, durante verificación de reporte y durante restauración. Cada recuperación debe conservar bytes/UUID/hash, distinguir no completado de completado, evitar doble acumulación y no instalar una actualización en mitad de recuperación.

### Reportes y reemplazos

Mensual de revisión r pendiente mientras r+1 se genera; SOURCE conservado para versión sustituida; dos cargas offline para mismo slot; un equipo remoto se adelantó; archivo modificado entre hash y transferencia; relocalización con mismo/distinto hash; falta de espacio. Los dos reportes de cada commit deben existir y ser verificables antes de emitir éxito local.

### Backup

Respaldar con WAL activo mediante API consistente. Restaurar con misma instalación, con otra instalación, con schema futuro, con outbox más antigua que la actual y con reportes faltantes. Nunca restaurar token, cambiar installationUuid sin procedimiento confirmado, perder operaciones nuevas ni asumir SYNCED por existencia de un archivo. Si el merge no es seguro, detener restauración conservando ambas copias.

## 5. Protocolo de benchmark propuesto

Dataset sintético de 500 000 líneas y al menos uno superior a 1 048 576 para rotación de hojas; incluir también muchas descripciones/nombres distintos, muchas fuentes/cuentas, retenidos y líneas inválidas. El generador actual sirve de base pero no representa todas esas cardinalidades.

Fijar hardware, Windows, Electron, Node embebido, tamaño/hash de dataset, configuración, catálogo y estado de caché. Ejecutar calentamiento y varias repeticiones antes/después; guardar mediana/p95 de tiempo y RSS máximo por proceso. Medir por separado hash/preflight, worker, SOURCE, mensual, commit y tiempo total. Repetir sin red, con salida lenta y con sync activa.

Comprobar centavos, filas, exclusiones, versiones activas y archivos equivalentes; hashes binarios de XLSX pueden cambiar por timestamps aunque datos sean iguales. Registrar latencia de UI/event loop y disco, no solo líneas/segundo. Umbral de regresión debe aprobarse en D15 antes de comparar; no declarar “sin regresiones relevantes” si no se acordó ni midió.

No agregar HTTP por línea ni cambiar cálculos monetarios como parte de sincronización. Si memoria de shared strings/mensual resulta problemática, tratarlo como cambio separado medido y revisado.

## 6. Protocolo de actualización instalada

VM Windows de prueba con instalador firmado N-1 que ya incluya updater, userData sintético vN-1, catálogo/identidad/outbox y archivos. Publicar N en feed de pruebas con Laravel o servidor contractual autorizado. Comprobar detección, bearer en todos los recursos, descarga completa/diferencial, firma y hashes. Mantener un procesamiento/Excel activo y confirmar que instalar se pospone. Luego permitir instalación, reiniciar, aplicar migraciones y verificar revisión, pendientes, identidad, reportes y disponibilidad de descifrado del token del mismo usuario.

Probar además EXE alterado, blockmap ausente, 401, TLS inválido, corte de red, disco lleno, cierre de sesión Windows y política de actualización obligatoria sin token válido. Conservar instalador anterior y backup consistente; no hacer downgrade automático de base migrada. La 0.1.0 actual necesita bootstrap por instalador/distribución administrada porque carece de updater.

## 7. Puertas de revisión

Fase 0 entrega documentos y baseline verde. Para iniciar Fase 1: revisión del resultado anterior, contrato real/versionado y configuración institucional definidos. Cada fase posterior conserva typecheck/lint/pruebas verdes y evidencia de pruebas específicas; benchmark cuando cambia procesamiento. Una suite fallida bloquea avanzar, no se deshabilita para dar por terminada la fase.

Los criterios de aceptación de la transición completa permanecen **pendientes**. Esta entrega no afirma API canónica operativa, offline habilitado, token cifrado implementado, uploads ni actualización funcional.
