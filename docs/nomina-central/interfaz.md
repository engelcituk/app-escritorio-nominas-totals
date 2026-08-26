# Diseño de interfaz para revisión — Fase 0

No se implementa ninguna vista en esta fase. Aplicada la skill local `.codex/skills/ui-ux-pro-max/SKILL.md`: búsqueda de sistema visual para gobierno/nómina/contabilidad y guía Vue para estado derivado/formularios/accesibilidad. Se adoptan foco, semántica y `computed`; se descartan el patrón comercial Hero/Features/CTA, paleta azul alternativa, fuentes remotas y librerías nuevas sugeridas automáticamente. Se conserva el sistema institucional de `docs/02-sistema-visual.md`.

Stack obligatorio: Vue 3, Router, Pinia cuando sea necesario, Bootstrap 5, Bootstrap Icons y SCSS. Sin framework visual adicional, tarjetas decorativas, gráficos ornamentales ni acceso directo a red desde renderer.

## Reglas comunes

- Jerarquía: título/objetivo → bloqueo o advertencia operativa → acción principal → datos y acciones secundarias. No confundir estado local con remoto.
- Estado central en un store/composable con `computed`; permisos efectivos revalidados en main. Los botones disabled incluyen explicación visible, no solo tooltip.
- Mensajes persistentes cuando requieren acción. Éxito local: “Procesamiento completado. Sincronización pendiente.” Error de red no reemplaza ese éxito por FAILED.
- `role=status`/`aria-live=polite` para cambios discretos; progreso limitado para evitar anuncios continuos. `role=alert` para errores; resumen enfocable y error junto al campo con aria-describedby/aria-invalid.
- Mantener selección/foco al actualizar páginas. Tablas con caption, encabezados con scope, montos alineados a la derecha y números tabulares. UUID truncado visualmente con detalle accesible/copia de UUID, nunca de token.
- Búsqueda paginada en SQLite con debounce/cancelación lógica; tamaños 25/50/100. No mandar toda la outbox ni todos los alias a Vue; detalle de alias bajo demanda.
- Icono Bootstrap + texto + tooltip accesible cuando corresponda. No depender de color ni usar emojis. Contraste mínimo 4.5:1; foco visible, reduced-motion, teclado y zoom 200 % a verificar.
- Conservar tonos institucionales actuales y fuente local Segoe UI. No cambiar identidad visual ni cargar fuentes desde internet.
- App de escritorio declara ventana mínima 980×680; probar ese mínimo, 1024×768 y 1440×900, zoom y modo preview estrecho. No declarar compatibilidad móvil por una tabla que hace scroll.

## A. Inicio de sesión (LoginView propuesta, Fase 1)

**Objetivo:** vincular instalación a una cuenta autorizada. **Acción principal:** “Iniciar sesión y registrar equipo”. **Riesgos:** servidor equivocado, credenciales expuestas, doble envío, revocación confundida con caída de red. **Jerarquía:** institución/servidor de solo lectura, conexión, formulario, mensaje de error y ayuda.

| Estado | Comportamiento |
|---|---|
| loading | Restaurando sesión o enviando login; aria-busy, sin doble submit |
| empty | Sin sesión: usuario, contraseña y nombre de equipo con labels; servidor visible |
| error | Distinguir credenciales, servidor, revocación y cifrado no disponible; no presentar raw response |
| success | Usuario/dispositivo vinculados; redirigir al primer sync si falta catálogo |
| disabled | Configuración inválida, formulario inválido o envío activo; motivo legible |

Volumen: formulario acotado; no listar dispositivos/usuarios masivamente. Contraseña nunca en Pinia/localStorage; limpiar campo tras intento y desmontaje. Permitir pegar y usar gestor de contraseñas. Histórico local puede seguir disponible según política aunque no se permita procesar.

## B. Indicador global (AppSidebar/App, Fases 1–3)

**Objetivo:** conocer disponibilidad y acción necesaria sin abandonar tarea. **Acción:** abrir Sincronización o actualización/login según bloqueo. **Riesgo:** “en línea” confundido con sincronizado. **Jerarquía:** estado corto + pendientes + explicación contextual.

loading: “Verificando conexión”; empty: “Equipo sin vincular”; error: “Error de sincronización”; success: “En línea · Sin pendientes”; disabled: link no aplicable sin configuración con explicación. READY_OFFLINE muestra “Sin conexión · N pendientes”; SYNCING “Sincronizando”; vigencia expirada “Catálogo vencido”; UPDATE_REQUIRED “Actualización requerida”. Fecha de última sincronización y fecha de vencimiento disponibles en detalle. Volumen: solo conteos, nunca una lista completa en sidebar. Con sidebar colapsado conservar nombre accesible del enlace.

## C. Sincronización (SyncView propuesta, Fase 3)

**Objetivo:** resolver pendientes y comprobar vigencia. **Acción:** “Reintentar elegibles”. **Riesgos:** reintentar conflictos infinitamente, duplicados, mostrar 100 % antes de ACK. **Jerarquía:** bloqueo → revisión/última sync/vigencia → filtros y tabla → detalle/diagnóstico/backoffice.

loading: consulta paginada mantiene encabezados; empty: “No hay operaciones pendientes” distinto de “Sin resultados del filtro”; error: mensaje por operación con código, intento y próxima fecha; success: ACK confirmado y fecha; disabled: sin auth/red, dependencia bloqueada, operación activa o error definitivo. No habilitar reintento automático para 409/422. Reintento manual requiere condiciones resueltas; editar datos genera nueva operación.

Tabla: tipo, operación UUID abreviado, entidad UUID, estado, intentos, próximo intento, código y acción. Filtros por estado/tipo; sin payload crudo. Progreso de uploads por archivo y verificación posterior. Conflictos legacy en pestaña/sección de diagnóstico paginada con exportación sanitizada. Archivo faltante permite “Localizar archivo” y muestra ruta esperada solo localmente. Volumen: paginación SQL 25/50/100, nunca renderizar toda la cola ni emitir evento por byte.

## D. Catálogo de conceptos (ConceptCatalogView, Fase 2)

**Objetivo:** consultar el canon y aliases disponibles. **Acción:** buscar/filtrar; “Sincronizar” como acción explícita secundaria. **Riesgos:** edición local accidental o elegir legacy. **Jerarquía:** “Este catálogo es administrado centralmente.” → revisión/vigencia → filtros → tabla/detalle.

loading: tabla en carga; empty: primera sincronización requerida o filtro sin resultados, diferenciados; error: conservar último catálogo válido con aviso; success: revisión confirmada; disabled: sincronizar sin sesión o ya en curso, no deshabilitar lectura. Mostrar nombre/código/grupo/factor/activo/UUID/revisión/estado legacy. Alias bajo demanda y lectura solamente. Volumen: consultas paginadas, no filtrado de todos los alias por concepto.

Retirar editor de grupo, concepto, alias, desactivación, draft schemas/preload/handlers productivos. “Abrir administración central” pasa por main/allowlist. HomeView deja de ofrecer “Administrar conceptos” como CRUD local.

## E. Tipos de nómina (sección de SettingsView, Fase 2)

**Objetivo:** consultar tipos oficiales. **Acción:** buscar/abrir administración central. **Riesgos:** cambiar código usado o confundir inactivo con eliminado. **Jerarquía:** procedencia → revisión → código/nombre/estado/UUID.

loading: consulta; empty: requiere primer sync o filtro vacío; error: catálogo anterior legible; success: revisión visible; disabled: sin edición local y sync ya activo. Retirar Nuevo/Editar/Guardar; mantener lectura de tipos inactivos usados por historial. Volumen: tabla paginada o sección paginada si crece; no cargar todo para formar selectores nuevos. Separar en vista propia solo si la navegación lo justifica.

## F. Historial (HistoryView, Fase 4)

**Objetivo:** consultar evidencia local y confirmación central por revisión. **Acción:** abrir reporte local; consultar central cuando exista. **Riesgos:** sumar versiones sustituidas, asumir que todo COMPLETED está en servidor, abrir archivo equivocado tras regeneración. **Jerarquía:** filtros → expediente/revisión → estado local y remoto → lotes/reportes.

loading: conservar filtros; empty: sin expedientes/filtro sin coincidencia; error: mensaje remoto independiente del estado local; success: “Completado / Sincronizado” con fecha y UUID; disabled: reporte central sin ACK o archivo faltante (ofrecer localizar), reintento mientras está activo. Mostrar `NOT_QUEUED` como “Histórico anterior sin envío”, no PENDING ficticio.

Volumen: paginación existente 25, detalle de lotes/reportes bajo demanda; no cargar cientos por expediente en listado. Mostrar UUID/error en detalle para no saturar columnas. Consolidado/AnnualMatrix conservan acceso offline y agregan desde SQL todas las filas, no la página inicial de 100. Diferenciar totales locales de datos centrales si en futuro se muestran ambos.

## G. Configuración (SettingsView, Fases 1 y 5)

**Objetivo:** conocer entorno, sesión, dispositivo y versión. **Acción:** buscar actualización; cerrar sesión es separada y explícita. **Riesgos:** editar servidor de producción, perder pendientes al salir, usar versión hardcodeada. **Jerarquía:** servidor/usuario/dispositivo → catálogo → actualización → carpeta local y sesión.

loading: solicitar DTO saneado; empty: usuario no autenticado/dispositivo no vinculado; error: mensaje de red sin afectar configuración local; success: valores confirmados; disabled: servidor/canal administrados no editables, operación activa protegida. Mostrar app.getVersion recibido de main, última sincronización, canal, nombre/UUID dispositivo; nunca token. Logout explica que los pendientes se conservan. Volumen: valores de resumen; tipos de nómina paginados por separado. No devolver indiscriminadamente app_settings.

## H. Actualizaciones (componente en Configuración, Fase 5)

**Objetivo:** descargar e instalar sin perder trabajo. **Acción:** “Buscar actualización”, luego “Descargar” y “Reiniciar e instalar”. **Riesgos:** reinicio durante Excel/upload, versión obligatoria ocultando un lote activo, confundir descarga con instalación. **Jerarquía:** versión/política → estado/progreso → acciones y advertencia.

loading: CHECKING/DOWNLOADING con porcentaje determinado si disponible; empty: IDLE; error: ERROR recuperable con reintento; success: NOT_AVAILABLE o DOWNLOADED diferenciados; disabled: instalar sin descarga verificada o con barrera activa. AVAILABLE muestra versión; REQUIRED explica bloqueo de nuevos procesos sin cancelar el actual. DEFERRED_ACTIVE_PROCESS: “Se instalará cuando termine el procesamiento”. “Instalar al cerrar” guarda intención y respeta la misma barrera; no bypass del control de main. Volumen: solo una descarga/canal, no lista decorativa de releases.

## I. Importación, respaldo y documentación existentes

ImportView/ConceptMultiSelect: conservar flujo por TXT, retirar alta rápida local. Loading del preflight conserva selección; desconocidos/legacy muestran diagnóstico y backoffice; error de catálogo bloquea iniciar con motivo; success local separado de remoto; disabled por vigencia/auth/update se decide centralmente y se revalida en main. No deshabilitar lectura/historial ni cancelar proceso aceptado. Grandes archivos siguen en worker/stream; solo preview acotado llega a Vue.

BackupsView: objetivo recuperar sin perder pendientes/identidad; acción crear respaldo local o restauración confirmada. Loading identifica fase; empty sin backup elegido no es error; error conserva base anterior; success informa verificación pendiente; disabled durante actividad crítica. Explicar que ZIP actual no incluye Excel/token y que restaurar no equivale a sincronizar. Diagnóstico de archivos faltantes paginado.

DocumentationView: explicar canon, offline, caducidad, pendientes, reemplazos/versiones y diferencia entre backup/reporte remoto. Loading/empty/error de consulta de catálogo explícitos (hoy no captura error); contenido estático sigue disponible offline. Conceptos documentados paginados/bajo demanda para no duplicar todo el catálogo en memoria.

## Criterio de aceptación de UI futura

Pruebas de estados UNCONFIGURED/AUTH_REQUIRED/FIRST_SYNC_REQUIRED/READY_ONLINE/READY_OFFLINE/SYNCING/DEGRADED/UPDATE_REQUIRED; teclado completo, foco al error/navegación y al cerrar selector, lector de pantalla, zoom, contraste medido y reduced-motion. Comprobar listeners al desmontar, respuestas de consultas fuera de orden y disabled con motivo. No se marca ninguna de estas pruebas como ejecutada en Fase 0.
