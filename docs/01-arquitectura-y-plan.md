# SEFIPLAN Nómina — arquitectura y plan del MVP

## 1. Arquitectura técnica

La aplicación se divide en cuatro fronteras estrictas:

1. **Renderer (Vue 3)**: presentación, formularios y estado de sesión. No conoce rutas ni APIs de Node.
2. **Preload**: contrato mínimo, tipado y explícito expuesto como `window.sefiplanApi`.
3. **Main (Electron)**: diálogos nativos, validación Zod, consultas paginadas, reportes, respaldos y coordinación del worker.
4. **Worker thread**: lectura por stream, clasificación, exclusión, escritura SQLite por lotes y cálculo determinista.

SQLite vive en `app.getPath('userData')`. Los TXT nunca se cargan completos en memoria; el Renderer recibe una muestra o páginas acotadas. Los importes se almacenan como centavos enteros.

## 2. Árbol de carpetas

```text
src/
  main/
    database/{DatabaseService,MigrationService}.ts
    ipc/registerIpcHandlers.ts
    repositories/
    services/
    workers/PayrollProcessingWorker.ts
    main.ts, window.ts
  preload/preload.ts
  renderer/
    components/
    views/
    router/
    stores/
    styles/
    App.vue, main.ts
  shared/
    enums/
    payroll-layouts/uniformPayrollLayout.ts
    schemas/
    types/
    utils/
tests/{fixtures,unit,integration,e2e}/
scripts/generate-benchmark-file.mjs
docs/
```

## 3. Esquema SQLite

La migración `001_initial_schema` crea `app_settings`, `concept_families`, `concept_rules`, `exclusion_rules`, `payroll_batches`, `payroll_records`, `batch_totals`, `generated_reports` y `audit_logs`, además de los índices del requerimiento. `schema_migrations` registra cada migración aplicada. Las reglas iniciales de ISR son seeds auditables, no condicionales dispersos.

Relaciones principales:

```text
concept_families 1 ── n concept_rules
concept_families 1 ── n payroll_batches
payroll_batches  1 ── n payroll_records
payroll_batches  1 ── n batch_totals
payroll_batches  1 ── n generated_reports
payroll_batches  n ── 0..1 payroll_batches (replaced_batch_id)
```

## 4. Wireframes textuales

### Estructura global

```text
┌───────────────┬────────────────────────────────────────────────────┐
│ Marca         │ Título / breadcrumb                    Ayuda       │
│ Inicio        ├────────────────────────────────────────────────────┤
│ Nueva import. │ Área central desplazable                          │
│ Histórico     │                                                    │
│ Consolidado   │                                                    │
│ Matriz anual  │                                                    │
│ Reglas        │                                                    │
│ Configuración │                                                    │
│ Respaldos     │                                                    │
└───────────────┴────────────────────────────────────────────────────┘
```

### Nueva importación

```text
[1 Archivo]  zona de selección + metadatos
[2 Datos]    año | quincena | tipo | ISR
[3 Exclus.]  retenidos | cancelados | otras | auditoría
[4 Preflight] resumen de compatibilidad + tabla de 10 líneas
[5 Procesar] resumen fijo + acción primaria
              progreso determinado / cancelar
              resultado / total / reportes / histórico
```

Objetivo: procesar un TXT oficial con parámetros revisados explícitamente. Acción principal: **Procesar archivo**. Riesgos: archivo incompatible, metadatos equivocados, duplicado, reglas no confirmadas, cancelación y conciliación distinta de cero. Jerarquía: compatibilidad y datos primero; acción final solo habilitada con preflight ≥95 %. Estados: skeleton acotado, vacío instructivo, error recuperable, éxito con conciliación, controles deshabilitados durante proceso. Volumen: muestras y páginas; nunca detalle completo.

### Histórico

Filtros compactos arriba, tabla paginada con encabezado fijo, total alineado a la derecha, estado textual + color y menú de acciones por lote. En vacío se ofrece iniciar una importación.

### Consolidado y matriz anual

Selectores de periodo en barra superior, tabla contable como elemento principal, totales en fila de cierre y estados “no cargado” explícitos. Sin gráficas decorativas.

## 5. Fases

1. Base Electron/Vue, seguridad, navegación, pruebas.
2. Sistema visual, SCSS Bootstrap y shell.
3. SQLite, migraciones, seeds y dominio.
4. Archivo, layout uniforme, preflight y vista previa.
5. Stream, worker, progreso, cancelación y persistencia.
6. Reglas ISR, exclusiones, centavos y totales.
7. Excel detalle/totales y conciliación.
8. Histórico, duplicados, versiones y regeneración.
9. Consolidado, matriz anual y respaldos.
10. Volumen, E2E, empaquetado e instalador.

## 6. Riesgos y mitigaciones

- **Campos no confirmados**: `component`, `fundingSource` y `employeeNumber` conservan nombres provisionales y se documentan en el layout; no se inventa semántica.
- **Reglas de retenidos/cancelados**: no se activa un valor mágico. Se ofrecen motores y seeds conservadores; las reglas requieren evidencia institucional.
- **Native modules**: `better-sqlite3` requiere rebuild para Electron; `electron-builder install-app-deps` forma parte del flujo.
- **500,000+ filas**: stream, lotes SQLite, throttling de 250 ms, paginación y Excel streaming.
- **Cierre inesperado**: los lotes `PROCESSING` se marcan `INTERRUPTED` al iniciar.
- **Archivo abierto en Excel**: el error de escritura se traduce a mensaje comprensible y el lote conserva evidencia.
- **Límite de Excel**: rotación de hoja antes de 1,048,576 filas.

## 7. Supuestos pendientes

- Los índices 11, 12, 14–21 están confirmados provisionalmente por la muestra.
- Los campos 0–10 y 13 siguen como `rawFieldNN`; para el primer caso se exponen provisionalmente 0 como componente, 1 como fuente y 4 como número de empleado, marcados como **pendientes de confirmación** y centralizados en un solo archivo.
- La codificación inicial es UTF-8; el preflight informa reemplazos de caracteres. No se autocorrige una línea desplazada.
- Las reglas seed de ISR usan código/descripción/movimiento de la muestra. Las exclusiones seed permanecen inactivas hasta confirmación institucional.
- El usuario local solo se incorpora como metadato si el sistema lo proporciona; nunca se envía fuera del equipo.

