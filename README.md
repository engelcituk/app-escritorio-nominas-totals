# SEFIPLAN Nómina

Aplicación de escritorio local para inspeccionar archivos TXT institucionales de nómina, clasificar ISR, conservar exclusiones y errores, persistir lotes auditables y generar reportes Excel conciliados.

## Instalación para usuario final

Ejecuta `release/SEFIPLAN Nómina Setup 0.1.0.exe` y sigue el asistente. La base SQLite se guarda en el directorio de datos de usuario de Windows, nunca en `Program Files`. No se requiere conexión a internet.

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
- El TXT se procesa por stream en un worker y SQLite se escribe en transacciones por lotes.
- Los importes se almacenan y suman como centavos enteros.
- Las líneas desplazadas, importes inválidos y registros excluidos se conservan para auditoría.
- La restauración valida ZIP, manifiesto, versión y esquema, y crea un respaldo automático previo.

## Supuestos pendientes

Los índices 0 (componente), 1 (fuente de financiamiento) y 4 (número de empleado) son provisionales hasta recibir el diccionario oficial. Las reglas de exclusión iniciales permanecen sin valores mágicos: deben confirmarse institucionalmente. El icono oficial del instalador también requiere un activo de identidad autorizado.

Consulta [arquitectura y plan](docs/01-arquitectura-y-plan.md) y [sistema visual](docs/02-sistema-visual.md) para las decisiones completas.
