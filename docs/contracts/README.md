# Contrato Laravel verificado

`tools-sefiplan.openapi.json` se obtuvo de [OpenAPI del backend local](https://tools-sefiplan.test/docs/openapi.json), mediante sesión web autorizada el 2026-08-26. Versión 1.0.0. SHA-256: `0A0DDBC7CD348D6F905C4EB57696CD5D73FE004707E1BCC82F56778A5CA57C33`.

Contiene ejemplos sintéticos de documentación, no credenciales ni tokens de las pruebas. La sesión web solo permitió consultar docs; Electron usa endpoints desktop/Bearer.

Esta copia reemplaza como fuente técnica las suposiciones de `../nomina-central/contrato-api.md`. Fase 0 se conserva como registro histórico.

## Diferencias para las siguientes fases

- `/me` devuelve Device, no User. Respuestas camelCase sin data. UUID de dispositivo/instalación se generan en cliente; reconciliation/batch/report en servidor.
- Login inválido devuelve 422; renovar elimina tokens anteriores del dispositivo; no existe refresh. Token pertenece a DesktopDevice. Según docs, desactivar User no revoca tokens emitidos: el administrador debe revocar el dispositivo.
- Checksum de snapshot cubre solo conceptAliases, conceptGroups, **payrollConcepts**, payrollTypes; excluye revisión/fechas. Listas por uuid, claves ordenadas y JSON compacto UTF-8 con Unicode/slashes sin escapar. ETag es checksum entre comillas. Snapshot sin paginación; incluye inactivos.
- Reserva obligatoria en `/api/v1/sync/operations`. operationType: reconciliation.upsert, batch.upsert, report.upload. No implementar los seis tipos locales propuestos como seis endpoints remotos.
- Payload hash excluye operationUuid/payloadHashSha256 de raíz; ordena claves recursivamente y preserva arrays. Replay devuelve estado **actual** del recurso. No hay deduplicación de negocio por hash TXT: otra operación puede crear otra versión.
- Totals/conceptSnapshots/aliasSnapshots viajan en batch, no endpoints separados.
- Reportes: metadata → multipart → complete, máximo 100 MiB, sin chunks. Dispositivo creador posee upload/complete; available no se sobrescribe (409). Download usa sesión web.
- Version-policy recibe channel/currentVersion en query. Feeds: `/desktop-updates/{channel}/latest.yml` y beta.yml, autenticados. Backend no garantiza Authenticode: firma/verificación se resuelve aparte.
- No hay aislamiento por tenant documentado; validar antes de desplegar en múltiples instituciones.

Estas diferencias solo se documentan en Fase 1. No se ejecutaron mutaciones de catálogos, conciliaciones, reportes ni releases.
