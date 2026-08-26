# Fase 3 — Outbox

**Estado: implementada y verificada.** La cola y el motor están listos; los adaptadores productivos de resultados y reportes corresponden a la fase 4.

## Alcance y contrato

La cola distingue intenciones locales (`local.result.publish`) de operaciones remotas (`reconciliation.upsert`, `batch.upsert`, `report.upload`). Una intención se registra en la misma transacción que completa el lote, permanece retenida mientras se genera el reporte mensual y se libera solo cuando ese paso termina. No se registra el TXT ni rutas en su payload. No se reconstruye retrospectivamente una intención para lotes anteriores a esta fase.

La intención local no es una reserva Laravel: su hash identifica el manifiesto local inmutable. La fase 4 deberá expandirla en operaciones hijas con sus propios UUID y hashes de los DTO remotos definitivos, referencias centrales y archivos de reporte inmutables. No debe reutilizar el UUID/hash de la intención para otra petición. El formato local se versiona explícitamente.

El motor admite adaptadores por tipo de operación, pero esta fase no instala adaptadores de envío de resultados ni Excel en producción. Sin adaptador no hay reserva ni tráfico saliente y el trabajo permanece pendiente. Las pruebas de entrega usan adaptadores aislados. Una reserva PENDING/PROCESSING nunca se marca SYNCED: se exige consultar un ACK COMPLETED con UUID, tipo, hash y recurso correspondientes. Laravel genera los UUID de recursos. No se implementan endpoints supuestos del borrador de fase 0.

## Diseño de la vista antes de implementar

Skill aplicada: `.codex/skills/ui-ux-pro-max/SKILL.md`. Se usan sus recomendaciones de tablas compactas, filtros, semántica, feedback y estado derivado en Vue. Se descartan hero, precios, fuentes externas, dashboards decorativos y nueva paleta; se conserva Vue 3, Bootstrap 5 y SCSS institucional.

- Objetivo: distinguir trabajo local terminado de envío confirmado y diagnosticar lo pendiente.
- Acción principal: consultar la cola y reintentar operaciones elegibles sin cambiar su identidad. Verificar conexión mediante la sesión desktop.
- Riesgos: confundir una reserva con entrega, repetir un conflicto, enviar al servidor/equipo equivocado, ocultar Retry-After o considerar enviada una intención sin adaptador.
- Jerarquía: estado y explicación del alcance → catálogo → conteos textuales → filtros y tabla → diagnóstico de una operación. Sin mostrar payloads ni respuestas crudas.
- Loading: conservar la tabla y anunciar la actualización; empty: sin trabajo o sin coincidencias; error: aviso persistente saneado; success: solo ACK confirmado; disabled: sesión no verificada, offline, procesamiento/restauración, espera obligatoria, conflicto o adaptador ausente.
- Volumen: SQL paginado 25/50/100, búsqueda acotada y detalle a demanda. No descargar la cola completa al renderer. Teclado, etiquetas, foco visible y estado expresado en texto.

## Operación y recuperación

- Migración v4 aditiva; respaldo SQLite consistente antes de migrar una base v3. Mantiene catálogo, identidad, lotes e histórico. La base respaldada incluye la cola; nunca incluye el token de safeStorage.
- `sync_outbox` guarda identidad, hash, payload, origen/equipo, dependencias, intentos, próximo intento y diagnóstico. Triggers impiden cambiar petición, UUID, hash y vínculos; un recurso central confirmado no puede reemplazarse por otro.
- `local_ready=0` retiene la intención hasta finalizar el reporte mensual. Si el reporte falla, queda FAILED sin envío. Si se cierra la aplicación en ese intervalo, queda `LOCAL_REPORTS_UNCONFIRMED` para revisión; no se presupone que el reporte esté completo. Los resultados listos permanecen PENDING hasta la fase 4.
- Un intento remoto IN_PROGRESS se recupera como RETRY conservando todo su contenido. Se consulta el UUID antes de repetir; una respuesta perdida después del commit se confirma sin otra mutación. El límite de intentos también se aplica al recuperar un cierre.
- Un solo ciclo por proceso, máximo 25 operaciones por recorrido, consultas cortas a SQLite y ninguna transacción durante HTTP. El temporizador revisa cada 5 segundos; procesamiento, catálogo activo y restauración impiden iniciar entregas. La restauración se rechaza mientras la outbox está activa. Se verifica sesión después de restaurar.
- Cada operación conserva origen, instalación y dispositivo originales. Si la identidad actual no coincide, pasa a CONFLICT antes de emitir HTTP. Restaurar un respaldo de otro equipo no autoriza enviar sus operaciones con una identidad distinta.
- El renderer solo recibe resúmenes y diagnósticos paginados; no puede encolar, modificar contenido, elegir URLs ni ejecutar SQL. Las consultas de lista no cargan los payloads. Datos de error usan mensajes propios, nunca HTML/SQL/respuestas crudas de Laravel.

### Matriz de reintentos

| Situación | Acción |
|---|---|
| Red / timeout / HTTP 408, 500, 502, 503, 504 | RETRY con backoff exponencial y jitter; consulta antes de repetir |
| HTTP 429 | RETRY y pausa global durable; Retry-After es mínimo y no se reduce al máximo del backoff |
| HTTP 400, 404 de mutación, 422 | FAILED; sin reintento automático ni botón para repetir un payload inválido |
| HTTP 401 | AuthService invalida sesión; operación conservada, nuevo login y reintento explícito |
| HTTP 403 | FAILED; se consulta `/me` para distinguir permiso insuficiente de revocación; AuthService borra token si la verificación del equipo lo rechaza |
| TLS | FAILED y verificación de sesión obligatoria; no se desactiva TLS |
| HTTP 409, ACK incorrecto, identidad distinta o hash alterado | CONFLICT; revisión manual, sin bucle ni cambio automático de UUID/hash |
| Reserva sin ACK COMPLETED | No es SYNCED; espera y consulta nuevamente con límite de intentos |
| Cierre de sesión, suspensión por procesamiento o cierre de aplicación | Abort/generación de sesión impiden confirmar una respuesta tardía; reconsulta al reanudar |
| Límite agotado | FAILED; reintento explícito abre un nuevo ciclo conservando UUID, contenido e intentos acumulados |

La política institucional existente `syncRetryPolicy` controla base, máximo y número de intentos (por defecto 2 s, 5 min y 10). El jitter usa entre 50% y 100% de la demora exponencial. Reintentar manualmente no salta Retry-After ni una dependencia sin confirmar. No se usa `navigator.onLine` como prueba de disponibilidad; se verifica la API desktop.

## Verificación — 26 de agosto de 2026

- Typecheck, lint y compilación de main, renderer y preload sin errores; `git diff --check` limpio. No se generó instalador.
- **154 pruebas unitarias (24 suites)**: serialización determinista contrastada con Python, límites de JSON y precisión, rechazo de secretos/rutas por clave, contrato de operaciones, jitter, Retry-After y esquemas IPC, además de las regresiones anteriores.
- Integración nativa Electron/SQLite: v3→v4 con respaldo, transacción de intención y rollback, reportes no confirmados, UUID/hash/payload inmutables, nuevas operaciones relacionadas, dependencias, cola paginada, single-flight, matriz HTTP, límite de intentos y reintento explícito, timeout tras commit sin duplicar, ACK incorrecto, logout con respuesta tardía, offline/online y copia/restauración del UUID. Los adaptadores de mutación de esta prueba son aislados, no Laravel.
- Regresión de nómina: **330090 centavos ($3300.90)** y reemplazo fallido sin alterar la versión activa ni su reporte.
- E2E Electron con servidor de catálogo aislado: TXT offline crea una intención PENDING con cero envíos; vista, diagnóstico, filtros, foco y tamaños 980/1440 px; respaldo/restauración mediante IPC conserva UUID y estado. Capturas revisadas en `test-results/catalog/outbox-*.png`.
- E2E con **Laravel real**: login, catálogo verificado, procesamiento offline y dos Excel locales; intención durable conservada con el mismo UUID/hash y cero intentos después de reiniciar Electron. Logout confirmado. Los datos de trabajo del usuario no se tocaron.
- API real de operaciones: reserva, GET por UUID, replay de la misma reserva y conflicto **409** con hash distinto. La reserva quedó PENDING y sin recurso, como debe ocurrir sin mutación. UUID de prueba: `45c040a0-5385-4e3a-9f2f-999677a89dad`. El token temporal fue revocado; el registro de prueba puede seguir visible en Laravel. No se modificaron expedientes/lotes ni se subieron TXT o Excel.

La comprobación real demuestra el protocolo de reserva, no la aplicación de una mutación ni uploads. Esos adaptadores, mapeos de recursos, DTO completos y copias inmutables de reportes corresponden a la fase 4. En particular, los conteos y quincenas locales no deben copiarse sin traducir: el contrato Laravel usa quincena 1/2 dentro del mes y reglas distintas para los conteos agregados.

## Ejecución de pruebas

Compilar primero con `npm run build`. Ejecutar `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:integration` y `npm run test:e2e:selection`.

Para Laravel, `npm run test:integration:auth` acepta entrada temporal con `apiBaseUrl`, `email`, `password`, `catalog: true`, `outbox: true`. Crea una reserva sintética sin mutar recursos. `npm run test:e2e:auth` con `catalog: true` verifica también persistencia de la intención tras reinicio. Usar stdin o `SEFIPLAN_TEST_INPUT_JSON` temporal y eliminarla al terminar; no guardar credenciales en archivos del repositorio.
