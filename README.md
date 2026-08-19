# SEFIPLAN Nómina

Aplicación de escritorio local para integrar los TXT quincenales de nómina en expedientes mensuales, seleccionar conceptos desde un catálogo auditable y mantener un reporte Excel conciliado por mes y grupo.

## Instalación para usuario final

Ejecuta `release/SEFIPLAN Nómina Setup 0.1.0.exe` y sigue el asistente. La base SQLite se guarda en el directorio de datos de usuario de Windows, nunca en `Program Files`. No se requiere conexión a internet.

## Reiniciar los datos locales

En desarrollo, si la aplicación detecta una base con el esquema anterior ofrece **Eliminar y recrear**. La base, su WAL y su SHM se eliminan sin archivarse y se crea el esquema mensual limpio. También se puede cerrar completamente la aplicación y eliminar manualmente `C:\Users\<usuario>\AppData\Roaming\sefiplan-nomina\sefiplan-nomina.sqlite*`.

Este reinicio elimina el histórico, la configuración y el catálogo personalizado guardados en la base. No elimina carpetas de reportes antiguas; simplemente dejan de estar registradas.

El modelo mensual redefine directamente la migración inicial porque el producto continúa en desarrollo. Las bases creadas con el esquema quincenal anterior no son compatibles.

## Flujo principal

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
- El workbook mensual documenta cobertura, nóminas, desglose, control y retenidos; la diferencia de conciliación debe ser cero.
- La restauración valida ZIP, manifiesto, versión y esquema, y crea un respaldo automático previo.

## Estructura confirmada del TXT

Los índices 0 a 3 forman la clave dependencia con el formato `parte1 + parte2 + parte3 + "-" + parte4`; por ejemplo, `21111|06|1|06` se convierte en `21111061-06`. El índice 4 es el número de empleado y el índice 8 se presenta como **Fuente** (`1508-26-001`). El penúltimo valor se conserva por separado como **Fuente de financiamiento** técnica (`CO`) y el último es el centro de pago. El reconocimiento usa alias exactos normalizados del catálogo, sin coincidencias abiertas.

Consulta [arquitectura y plan](docs/01-arquitectura-y-plan.md) y [sistema visual](docs/02-sistema-visual.md) para las decisiones completas.
