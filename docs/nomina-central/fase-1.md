# Fase 1 — Identidad y autenticación

Implementación verificada el 26 de agosto de 2026 contra Laravel local. No se implementan todavía catálogo remoto, outbox, uploads ni actualizaciones. El procesamiento TXT, SQLite y los reportes existentes siguen disponibles; la sesión central **no** certifica sincronización ni vigencia del catálogo. Los bloqueos dependientes del catálogo se incorporarán en Fase 2.

## Contrato real

Fuente: [documentación Laravel](https://tools-sefiplan.test/docs), versión 1.0.0. Copia: [OpenAPI](../contracts/tools-sefiplan.openapi.json). SHA-256: `0A0DDBC7CD348D6F905C4EB57696CD5D73FE004707E1BCC82F56778A5CA57C33`.

| Operación | Contrato |
|---|---|
| POST /api/v1/desktop/tokens | email, password, deviceUuid, installationUuid, name, appVersion, platform; respuesta 201: token, tokenType Bearer, abilities, device |
| GET /api/v1/desktop/me | Device directamente; **no** User ni envoltura data |
| POST /api/v1/desktop/heartbeat | Sin cuerpo; receivedAt; requiere device:heartbeat |
| POST /api/v1/desktop/logout | Sin cuerpo; invalida solamente el token utilizado |

Ambos UUID se generan en el cliente, son distintos y estables. Reautenticar invalida tokens anteriores del mismo dispositivo. No existe refresh; la documentación declara Sanctum sin expiración global automática. No se inventan TTL ni perfil de usuario.

Credenciales inválidas devuelven **422**. La UI muestra un mensaje general de credenciales/datos del equipo: el contrato no distingue todas las reglas mediante códigos estables. No compara textos localizados ni refleja cuerpos de error. 429 respeta Retry-After, sin reintento automático de login.

## Implementación y seguridad

- DeviceService genera installationUuid al iniciar y reserva deviceUuid/api_origin antes del primer request. Un timeout conserva la reserva. registered_at distingue reserva de registro confirmado; se reutiliza central_device_uuid de v2.
- SecureTokenStore usa safeStorage nativo. Solo blob cifrado en userData/secure/session.bin, vinculado a origen e instalación. No hay token ni contraseña en SQLite, configuración, renderer o logs.
- ApiClient restringe origen/rutas, valida con Zod y limita timeout/tamaño. No sigue redirects, reintenta mutaciones ni muestra respuestas crudas.
- AuthService serializa login/restauración/check/logout, cancela solicitudes y evita que login tardío reactive logout. Heartbeat cada cinco minutos mientras hay sesión.
- IPC específico: auth.login/logout/status/check/onChanged y openBackoffice. DTO sin secretos: estado, equipo/UUID, origen, versión y última validación. Abilities no se presentan como permisos locales; no se inventa userName.
- Vue 3, Pinia, Bootstrap 5 y SCSS: /acceso, estado global y sesión en Configuración. Contraseña solo en formulario/argumentos efímeros; se limpia al enviar/terminar/desmontar. Logout requiere confirmación.

Estados: UNCONFIGURED (configuración inválida/ausente), AUTH_REQUIRED, AUTHENTICATED (identidad confirmada), OFFLINE (sesión guardada ante red/timeout) y UNVERIFIED (TLS/contrato/otros fallos). No equivalen a los futuros READY_ONLINE/READY_OFFLINE de sincronización.

401/403 de /me eliminan el token; 401 de heartbeat también. 403 de heartbeat no prueba revocación porque exige permiso propio: conserva sesión e informa error. Identidad inesperada no reemplaza la instalación.

Logout desactiva la sesión durable **antes de esperar a la red**: escribe session.disabled, fuerza escritura y elimina el blob. La marca impide restaurar un blob bloqueado. Se intenta cierre remoto y se descarta token en memoria. Sin confirmación remota se advierte: el servidor puede conservar ese token hasta reautenticación/revocación. Si el almacenamiento impide incluso escribir la marca se informa error, sin prometer persistencia del cierre.

Main usa session.fetch de Chromium en partición de memoria separada y credentials: omit. TLS fue verificado en Electron real, sin excepciones de certificado ni flags inseguros. [Referencia oficial net.fetch](https://www.electronjs.org/docs/latest/api/net).

Todos los handlers IPC existentes/nuevos verifican window/webContents, mainFrame y URL exacta (hash permitido). Se bloquean nuevas ventanas, navegación/redirect externos y webview. El backoffice usa URL administrada en main sin token en URL. Un paquete ignora VITE_DEV_SERVER_URL; Vite solo acepta HTTP loopback en desarrollo. Se conservan sandbox, contextIsolation, webSecurity y nodeIntegration deshabilitado.

Electron 37.10.3 declara safeStorage síncrono: se usa ese API con I/O asíncrono de archivo, no métodos inexistentes. No se promete borrado físico de strings JS ni aislamiento de procesos maliciosos del mismo usuario Windows; modos POSIX no sustituyen ACL. [Referencia safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

## Datos y configuración

Migración v2 conserva v1/datos y añade identidad/trigger. Restaurar backup preserva la identidad local en la base candidata; el token queda fuera del backup SQLite. No se eliminó ninguna base operativa ni se alteró parser/cálculos/seeder. Coordinación de backups con procesamiento/outbox y problemas del seeder identificados en Fase 0 siguen pendientes.

Desarrollo: config/central.development.json contiene solamente las URLs locales suministradas. Variables SEFIPLAN_API_BASE_URL / SEFIPLAN_BACKOFFICE_URL / SEFIPLAN_REQUEST_TIMEOUT_MS tienen prioridad. No son VITE ni editables desde renderer.

Producción: solo resources/central.config.json administrado por despliegue. El paquete no incluye configuración de desarrollo ni usa variables para redirigir API. Ejemplo (reemplazar dominios antes de desplegar):

```json
{
  "apiBaseUrl": "https://nomina.example.invalid",
  "backofficeUrl": "https://nomina.example.invalid/",
  "updateChannel": "stable",
  "requestTimeoutMs": 15000,
  "catalogMaximumOfflineAge": 604800,
  "syncRetryPolicy": { "baseDelayMs": 2000, "maxDelayMs": 300000, "maximumAttempts": 10 }
}
```

Canal/vigencia/reintentos son configuración para fases siguientes; no hay updater/sync activos. Una identidad reservada no cambia silenciosamente de servidor. Para otro backend usar perfil aislado o reinicialización explícita.

Reiniciar Electron tras cambios de main/preload. Abrir **Sin sesión central** en la barra superior o **Configuración → Iniciar sesión**. Credenciales por canal separado; no están en el repositorio.

## Verificación

- Typecheck, lint y build renderer/main/preload correctos.
- **21 suites, 120 pruebas unitarias**: configuración, transporte, safeStorage, AuthService, sender/frame IPC y regresiones anteriores.
- Electron nativo: v1 → v2 con datos personalizados conservados; UUID estable/reservado, conflictos, identidad en candidato de restore, safeStorage real y token ausente en SQLite.
- Laravel real: login, restauración/heartbeat, cifrado, UUID distintos, logout seguido de /me rechazado con 401. Runner final exit 0 y perfil temporal eliminado después de salir Electron.
- UI real: formulario → sesión; **reinicio del proceso** → restauración; logout confirmado. Contraseña vacía y DTO sin secretos. Tab correo → contraseña; sin overflow horizontal en 1440×900 y 980×680. Capturas revisadas en test-results/auth, ignoradas por Git.
- Pipeline TXT/Excel: total **330090 centavos**, dos quincenas, sustitución, SOURCE/mensual y conservación del resultado ante sustitución fallida.
- E2E existente de selección TXT y actualización mensual correcto, incluyendo preview y tamaños 1440/1024. Detectó dos problemas anteriores: iconos decorativos contaminaban nombres accesibles y una carga inicial duplicada borraba archivos recién seleccionados. Se corrigieron ambos; la prueba completa terminó con exit 0.

Rechazo/revocación/red/TLS/rate limit/carreras se prueban con dobles deterministas basados en contrato; flujo correcto además contra Laravel real. No se revocaron dispositivos ajenos; los equipos de prueba pueden quedar listados sin token activo.

Se corrigieron los primeros runners porque Electron Windows no recibe stdin y Chromium mantiene archivos de perfil abiertos. El runner Node acepta stdin, transmite credenciales solo al entorno efímero del hijo y limpia el perfil tras finalizarlo. No se omitieron comprobaciones para conseguir exit 0.

No se verificaron instalador NSIS, actualización, benchmark 500k, lector de pantalla ni matriz completa de zoom/estados futuros.

### Comandos

```powershell
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run typecheck
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run lint
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' test
node node_modules/vite/bin/vite.js build
node node_modules/typescript/bin/tsc -p tsconfig.main.json
node node_modules/esbuild/bin/esbuild src/preload/preload.ts --bundle --platform=node --format=cjs --external:electron --outfile=dist/preload/preload.cjs
node node_modules/electron/cli.js scripts/integration-pipeline.mjs
node scripts/e2e-file-selection.mjs
```

El launcher npm local resolvía una ruta global defectuosa; se usa npm-cli junto a Node.

Para repetir contra Laravel: los runners Node aceptan por stdin JSON {apiBaseUrl,email,password}. Obtener contraseña interactivamente, nunca escribirla en archivos/comandos versionados. Ejecutar node scripts/run-auth-integration.mjs (contrato/cifrado) o node scripts/e2e-auth.mjs (UI). Requieren build previo y certificado confiable. Consumen un login; no ejecutar en bucle (límite cinco/minuto/correo/IP).

## Siguiente fase

Fase 2: snapshot/checksum reales, reconciliar catálogo local, retirar edición local y agregar vigencia/primera sincronización. Revisar [diferencias](../contracts/README.md) antes de implementar. No comenzar outbox/upload a partir del borrador histórico.
