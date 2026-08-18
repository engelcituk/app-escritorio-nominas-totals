# SEFIPLAN Nómina

Aplicación de escritorio local para inspeccionar uno o varios TXT institucionales de nómina, seleccionar conceptos desde un catálogo auditable y generar reportes Excel conciliados.

## Instalación para usuario final

Ejecuta `release/SEFIPLAN Nómina Setup 0.1.0.exe` y sigue el asistente. La base SQLite se guarda en el directorio de datos de usuario de Windows, nunca en `Program Files`. No se requiere conexión a internet.

## Reiniciar los datos locales

En desarrollo, si la aplicación detecta la base anterior ofrece **Archivar y recrear**: conserva el archivo con el sufijo `esquema-anterior-<fecha>` y crea una base SQLite limpia. También se puede cerrar completamente la aplicación y renombrar o eliminar manualmente `C:\Users\<usuario>\AppData\Roaming\sefiplan-nomina`.

Este reinicio elimina el histórico, la configuración, el catálogo personalizado y los respaldos automáticos guardados dentro de esa carpeta. No elimina los reportes Excel generados en Documentos ni en otra carpeta seleccionada. Para conservar una recuperación sencilla, es preferible renombrar la carpeta antes de eliminarla.

La ampliación de expedientes multiarchivo redefine directamente la migración inicial porque el producto continúa en desarrollo. Una base o respaldo creado con el esquema anterior no es compatible: debe cerrarse la aplicación y renombrarse la carpeta de datos antes de iniciar esta versión.

## Flujo principal

1. Abre **Nueva importación**, captura el año común y selecciona uno o varios TXT oficiales.
2. Confirma quincena y tipo de nómina de cada archivo.
3. Elige, de manera independiente por TXT, los conceptos detectados que deben totalizarse.
4. Revisa que todos los archivos sean compatibles y que los hashes no estén duplicados.
5. Captura y valida, si corresponde, los empleados retenidos dentro del TXT afectado.
6. Revisa el resumen y procesa el expediente; los archivos se concilian secuencialmente.
7. Abre los reportes individuales y el consolidado o consulta el **Histórico**.

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
- Las líneas desplazadas, importes inválidos y registros excluidos se documentan en los Excel para auditoría.
- La restauración valida ZIP, manifiesto, versión y esquema, y crea un respaldo automático previo.

## Estructura confirmada del TXT

Los índices 0 a 3 forman la clave dependencia con el formato `parte1 + parte2 + parte3 + "-" + parte4`; por ejemplo, `21111|06|1|06` se convierte en `21111061-06`. El índice 4 es el número de empleado, el penúltimo valor es la fuente de financiamiento y el último es el centro de pago; por ejemplo, `|CO|1`. El reconocimiento usa alias exactos normalizados del catálogo, sin coincidencias abiertas. El icono oficial del instalador requiere un activo de identidad autorizado.

Consulta [arquitectura y plan](docs/01-arquitectura-y-plan.md) y [sistema visual](docs/02-sistema-visual.md) para las decisiones completas.
