# SEFIPLAN Nómina

Cliente de escritorio Electron para integrar los TXT quincenales de nómina en expedientes mensuales, seleccionar conceptos del catálogo central de Laravel y mantener un reporte Excel conciliado por mes y grupo.

## Instalación para usuario final

Ejecuta `release/SEFIPLAN Nómina Setup 0.1.0.exe` y sigue el asistente. La base SQLite se guarda en el directorio de datos de usuario de Windows, nunca en `Program Files`. La primera sesión y descarga de catálogos requieren acceso al servidor Laravel. Después puede procesar sin conexión mientras el catálogo sea válido (7 días por defecto, configurable institucionalmente). Los resultados y Excel siguen siendo locales; su envío se implementa en fases posteriores. El paquete debe incluir la configuración institucional junto a sus recursos; no se utiliza la configuración de desarrollo en producción.

## Reiniciar los datos locales

En desarrollo, si la aplicación detecta una base con el esquema anterior ofrece **Eliminar y recrear**. La base, su WAL y su SHM se eliminan sin archivarse y se crea el esquema mensual limpio. También se puede cerrar completamente la aplicación y eliminar manualmente `C:\Users\<usuario>\AppData\Roaming\sefiplan-nomina\sefiplan-nomina.sqlite*`.

Este reinicio elimina el histórico, la configuración y el catálogo personalizado guardados en la base. No elimina carpetas de reportes antiguas; simplemente dejan de estar registradas.

Las migraciones mensuales v1/v2 se conservan. La migración v3 añade la réplica central sin borrar el histórico y genera un respaldo consistente en `catalog-backups` antes de aplicarse. El catálogo anterior deja de ser fuente oficial: los registros sin equivalencia quedan `LEGACY_UNMAPPED`. Las bases del antiguo esquema quincenal siguen siendo incompatibles.

## Flujo principal

Antes de comenzar, inicia sesión en **Acceso institucional** y verifica el estado de **Catálogo central**. Conceptos, grupos, tipos y alias se administran únicamente en Laravel. Si cambia la revisión mientras preparas un TXT, vuelve a analizarlo.

1. Abre **Expedientes mensuales** y selecciona año, mes y grupo de conceptos.
2. Agrega uno o varios TXT de las dos quincenas válidas del mes y confirma el tipo de nómina de cada archivo.
3. Elige, de manera independiente por TXT, los conceptos detectados que deben totalizarse.
4. Revisa que el nombre, año, quincena y tipo sean consistentes y que los hashes no estén duplicados.
5. Captura y valida, si corresponde, los empleados retenidos dentro del TXT afectado.
6. Actualiza el expediente; cada archivo concilia antes de convertirse en la versión activa de su quincena y tipo.
7. Conserva el `TXT_Completo_...xlsx` de cada archivo y abre el único `Totales_ISR_{año}_M{mes}.xlsx` vigente.

## Desarrollo

Requisitos: Node.js 22 y Windows para el empaquetado final.

```powershell
npm install
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
npm run dist:win
```

El benchmark sintético se genera bajo demanda, sin información personal:

```powershell
npm run benchmark:fixture -- 500000
```

## Seguridad y precisión

- `contextIsolation: true`, `nodeIntegration: false`, sandbox y CSP.
- El Renderer solo usa una API explícita de preload; no recibe rutas para leer o escribir libremente.
- Todos los payloads IPC relevantes se validan con Zod.
- El TXT se procesa por streaming: la primera pasada calcula los totales y la segunda genera los Excel.
- Los importes se almacenan y suman como centavos enteros.
- SQLite conserva lotes y totales agrupados, pero no persiste cada movimiento de nómina.
- El workbook mensual contiene resumen, totales por nómina, desglose agrupado y retenidos; la diferencia de conciliación se valida internamente antes de guardarlo.
- La restauración valida ZIP, manifiesto, versión y esquema, y crea un respaldo automático previo.

## Estructura confirmada del TXT

Los índices 0 a 3 forman la clave dependencia con el formato `parte1 + parte2 + parte3 + "-" + parte4`; por ejemplo, `21111|06|1|06` se convierte en `21111061-06`. El índice 4 es el número de empleado y el índice 8 se presenta como **Fuente** (`1508-26-001`). El penúltimo valor se conserva por separado como **Fuente de financiamiento** técnica (`CO`) y el último es el centro de pago. El reconocimiento usa alias exactos normalizados del catálogo, sin coincidencias abiertas.

Consulta [arquitectura y plan](docs/01-arquitectura-y-plan.md) y [sistema visual](docs/02-sistema-visual.md) para las decisiones completas.

## Integración central por fases

Consulta [Fase 1: sesión e identidad](docs/nomina-central/fase-1.md) y [Fase 2: catálogo, migración y pruebas](docs/nomina-central/fase-2.md).

La [Fase 3: outbox durable](docs/nomina-central/fase-3.md) añade la vista **Sincronización**, cola local inmutable, dependencias y motor de reintentos.

La [Fase 4: resultados y reportes](docs/nomina-central/fase-4.md) conecta expedientes, lotes, fotografías del catálogo, totales y los Excel SOURCE/MONTHLY_TOTALS a Laravel. Incluye copias por revisión, progreso, consulta del historial central y respaldo de los archivos pendientes (migración v5 aditiva con respaldo previo). Solo se confirma una publicación tras el ACK de sus cuatro operaciones. No se encolan retrospectivamente lotes sin intención de publicación. Las intenciones antiguas cuyo mensual ya fue sobrescrito requieren recuperación; nunca se sustituuyen silenciosamente por otro reporte.

Las pruebas `npm run test:integration` y `npm run test:e2e:selection` requieren compilar previamente con `npm run build`; Electron debe estar recompilado para su ABI nativo. La prueba E2E de selección usa un servidor HTTP de contrato y un perfil temporal, no Laravel. La prueba `npm run test:integration:auth` admite en stdin un JSON con `apiBaseUrl`, `email`, `password` y `catalog: true` para verificar además la descarga real y el 304. No guardar ese JSON en el repositorio.

`npm run test:e2e:auth` admite el mismo JSON; con `catalog: true` comprueba el catálogo real, reinicio de Electron y procesamiento offline del TXT sintético con dos Excel en una carpeta temporal. Ambas pruebas admiten también la variable efímera `SEFIPLAN_TEST_INPUT_JSON` en Windows; eliminarla del entorno al terminar. Las sesiones se cierran y los perfiles temporales se eliminan. Estas pruebas usan el catálogo publicado: para el procesamiento de regresión se requieren el grupo ISR, el tipo SUELDOS y sus alias del TXT de prueba.

La prueba de API real admite además `outbox: true` junto con `catalog: true`: verifica reserva, consulta, replay y conflicto de hash. Deja una reserva sintética PENDING en Laravel, sin crear recursos ni subir reportes. La prueba E2E real comprueba que UUID/hash de la intención sobrevivan a otro reinicio.
