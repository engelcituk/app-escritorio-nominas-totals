# SEFIPLAN Nómina

Aplicación de escritorio local para inspeccionar archivos TXT institucionales de nómina, clasificar ISR, conservar exclusiones y errores, persistir lotes auditables y generar reportes Excel conciliados.

## Instalación para usuario final

Ejecuta `release/SEFIPLAN Nómina Setup 0.1.0.exe` y sigue el asistente. La base SQLite se guarda en el directorio de datos de usuario de Windows, nunca en `Program Files`. No se requiere conexión a internet.

## Reiniciar los datos locales

Con la aplicación y el proceso de desarrollo completamente cerrados, se puede renombrar o eliminar `C:\Users\<usuario>\AppData\Roaming\sefiplan-nomina`. Al iniciar de nuevo, Electron recrea la carpeta y la aplicación crea una base SQLite limpia con el esquema inicial.

Este reinicio elimina el histórico, configuraciones, reglas personalizadas y respaldos automáticos guardados dentro de esa carpeta. No elimina los reportes Excel generados en Documentos ni en otra carpeta seleccionada. Para conservar una recuperación sencilla, es preferible renombrar la carpeta antes de eliminarla.

## Flujo principal

1. Abre **Nueva importación**.
2. Selecciona el TXT oficial.
3. Confirma año, quincena, tipo de nómina e ISR.
4. Revisa que el preflight sea compatible (mínimo 95 % de la muestra válida).
5. Revisa las opciones de exclusión y elige la carpeta de reportes si corresponde.
6. Procesa el archivo y espera a que detalle, totales y conciliación concluyan.
7. Abre la carpeta de reportes o consulta el lote en **Histórico**.

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

Los índices 0 a 3 forman la clave dependencia con el formato `parte1 + parte2 + parte3 + "-" + parte4`; por ejemplo, `21111|06|1|06` se convierte en `21111061-06`. El índice 4 es el número de empleado, el índice 20 es la fuente de financiamiento y el índice 21 es el centro de pago. Las reglas de exclusión iniciales permanecen sin valores mágicos: deben confirmarse institucionalmente. El icono oficial del instalador también requiere un activo de identidad autorizado.

Consulta [arquitectura y plan](docs/01-arquitectura-y-plan.md) y [sistema visual](docs/02-sistema-visual.md) para las decisiones completas.
