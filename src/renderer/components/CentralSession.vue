<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';
const auth = useAuthStore();
const confirming = ref(false); const externalError = ref('');
async function logout(): Promise<void> { await auth.logout(); confirming.value = false; }
async function openBackoffice(): Promise<void> {
  externalError.value = '';
  try { await window.sefiplanApi.openBackoffice(); } catch { externalError.value = 'No se pudo abrir la administración central.'; }
}
</script>

<template>
  <section class="central-session mb-4" aria-labelledby="session-title" :aria-busy="auth.busy">
    <h2 id="session-title">Sesión institucional</h2>
    <p role="status"><strong>{{ auth.label }}</strong></p>
    <div v-if="auth.status" class="row g-3 mb-3">
      <div class="col-12 col-xl-6"><dl class="mb-0">
        <dt>Servidor</dt><dd class="auth-origin">{{ auth.status.apiOrigin ?? 'Sin configurar' }}</dd>
        <dt>Equipo</dt><dd>{{ auth.status.deviceName || 'Sin vincular' }}</dd>
        <dt>Versión de la aplicación</dt><dd>{{ auth.status.appVersion }}</dd>
      </dl></div>
      <div class="col-12 col-xl-6"><dl class="mb-0">
        <dt>UUID del dispositivo</dt><dd class="auth-uuid">{{ auth.status.deviceUuid ?? 'Se asignará al iniciar sesión' }}</dd>
        <dt>UUID de la instalación</dt><dd class="auth-uuid">{{ auth.status.installationUuid || 'No disponible en vista previa' }}</dd>
        <dt>Última validación de sesión</dt><dd>{{ auth.status.lastSeenAt ? new Date(auth.status.lastSeenAt).toLocaleString('es-MX') : 'Sin validación' }}</dd>
      </dl></div>
    </div>
    <p class="small">La API identifica al equipo; no proporciona el perfil del usuario. Una sesión activa no significa que los datos estén sincronizados.</p>
    <div v-if="auth.transportError || auth.status?.message" class="alert" :class="auth.transportError || auth.status?.errorCode ? 'alert-warning' : 'alert-info'" role="status">{{ auth.transportError || auth.status?.message }}</div>
    <div v-if="externalError" class="alert alert-warning" role="alert">{{ externalError }}</div>
    <div class="d-flex flex-wrap gap-2">
      <RouterLink v-if="!auth.hasSession" class="btn btn-primary" to="/acceso">Iniciar sesión</RouterLink>
      <button v-if="auth.hasSession" class="btn btn-outline-primary" type="button" :disabled="auth.busy" @click="auth.check">Verificar conexión</button>
      <RouterLink v-if="auth.hasSession && auth.status?.state !== 'AUTHENTICATED'" class="btn btn-outline-primary" to="/acceso">Volver a autenticar</RouterLink>
      <button class="btn btn-outline-secondary" type="button" :disabled="!auth.status?.apiOrigin" @click="openBackoffice">Abrir administración central <i class="bi bi-box-arrow-up-right" aria-hidden="true" /></button>
      <button v-if="auth.hasSession" class="btn btn-outline-danger" type="button" :disabled="auth.busy" @click="confirming = true">Cerrar sesión</button>
    </div>
    <div v-if="confirming" class="alert alert-warning mt-3 mb-0" role="group" aria-label="Confirmar cierre de sesión">
      <p>¿Cerrar la sesión de este equipo? Los datos, reportes y trabajos locales se conservan.</p>
      <button class="btn btn-danger me-2" type="button" :disabled="auth.busy" @click="logout">Sí, cerrar sesión</button>
      <button class="btn btn-outline-secondary" type="button" :disabled="auth.busy" @click="confirming = false">Cancelar</button>
    </div>
  </section>
</template>
