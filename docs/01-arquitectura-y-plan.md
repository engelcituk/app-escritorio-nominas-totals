# SEFIPLAN Nómina — arquitectura mensual del MVP

## 1. Arquitectura técnica

La aplicación conserva cuatro fronteras:

1. **Renderer (Vue 3 + Bootstrap 5 + SCSS)**: expediente mensual, matriz operativa, catálogos y estados de interacción.
2. **Preload**: contrato mínimo y tipado expuesto como `window.sefiplanApi`.
3. **Main (Electron)**: validación Zod, SQLite, coordinación, rutas y generación de Excel.
4. **Worker thread**: lectura por stream, clasificación, retenidos y cálculo determinista en centavos.

SQLite vive en `app.getPath('userData')`. Los TXT no se cargan completos en el Renderer y no se persiste cada movimiento: se guardan lotes, snapshots y totales agrupados auditables.

## 2. Dominio mensual

La migración inicial única crea `monthly_reconciliations`, `payroll_types`, `payroll_batches`, snapshots de conceptos, alias y retenidos, `batch_totals`, `report_artifacts` y `audit_logs`.

```text
concept_groups          1 ── n monthly_reconciliations
monthly_reconciliations 1 ── n payroll_batches
payroll_types           1 ── n payroll_batches
payroll_batches         1 ── n batch_totals
payroll_batches         1 ── n batch_*_snapshots
monthly_reconciliations 1 ── 1 reporte mensual vigente
payroll_batches         1 ── 1 TXT Completo vigente por lote
```

Una combinación `año + mes + grupo` identifica el expediente. Cada mes admite dos quincenas (`2 × mes − 1` y `2 × mes`). Solo existe una versión activa por `expediente + quincena + tipo de nómina`; las versiones sustituidas se conservan inactivas para garantizar un reemplazo seguro, pero no contribuyen a Histórico, Consolidado, Matriz anual ni reportes.

## 3. Flujo operativo

```text
[Periodo]   año | mes | grupo de conceptos
[Matriz]    filas: tipos de nómina · columnas: las dos quincenas
[Archivos]  TXT + metadatos inferidos/confirmados + reemplazo
[Conceptos] selección y alta rápida independiente por TXT
[Retenidos] lista y validación independiente por TXT
[Actualizar] proceso secuencial + conciliación + reporte mensual
```

Objetivo: integrar las nóminas que llegan durante el mes sin volver a sumar versiones reemplazadas. La acción principal es **Actualizar expediente**. Se bloquean archivos incompatibles, metadatos inconsistentes, hashes activos duplicados, dos archivos para el mismo espacio en una sola actualización y reemplazos no confirmados.

Los estados loading, empty, error, success y disabled están presentes. El foco de errores es visible, las tablas soportan desplazamiento horizontal y el procesamiento muestra avance por archivo.

## 4. Reemplazo seguro

1. El candidato se procesa como lote inactivo.
2. Debe conciliar en centavos y generar su `TXT_Completo`.
3. En una transacción se desactiva la versión anterior y se activa el candidato.
4. Se recalculan los totales exclusivamente desde lotes activos.
5. Se sobrescribe la misma ruta del reporte mensual mediante archivo temporal.
6. Si falla antes de completar el cambio, el lote y reporte anteriores permanecen vigentes y el candidato queda fallido.

Los reintegros usan factor `−1`; nunca se acumulan importes en punto flotante.

## 5. Salidas

```text
/{año}/M{mes}/{grupo}/Totales_{grupo}_{año}_M{mes}.xlsx
/{año}/M{mes}/{grupo}/Q{quincena}/TXT_Completo_...xlsx
```

El reporte mensual incluye `Resumen mensual`, `Por nómina`, `Desglose agrupado`, `Control` y `Retenidos`. La hoja de control reconcilia contra lotes activos con diferencia cero. No se generan `Detalle_Conceptos` ni `Totales_Conceptos` por archivo, ni versiones históricas del reporte mensual.

## 6. Riesgos y mitigaciones

- **Metadatos erróneos**: se extraen del patrón `QNA_{quincena}_{año}_{tipo}.txt` y se bloquean contradicciones.
- **Duplicidad**: SHA-256 y el índice único del espacio activo evitan doble suma.
- **Archivo abierto en Excel**: el error se comunica y la versión anterior conserva vigencia.
- **Volumen**: stream, totales agrupados, progreso limitado a intervalos y Excel streaming para TXT Completo.
- **Límite de Excel**: el contenido rota antes de 1,048,576 filas.
- **Cierre inesperado**: los lotes en proceso se marcan interrumpidos al iniciar.
- **Esquema de desarrollo anterior**: la aplicación ofrece eliminar base, WAL y SHM y recrear desde la única migración vigente; no archiva automáticamente.
