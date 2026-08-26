<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '../components/PageHeader.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const email = ref(''); const password = ref(''); const deviceName = ref('');
const feedback = ref<HTMLElement | null>(null);
const now = ref(Date.now());
const timer = window.setInterval(() => { now.value = Date.now(); }, 1000);
const waitingSeconds = computed(() => Math.max(0, Math.ceil(((auth.status?.retryAt ?? 0) - now.value) / 1000)));
const disabled = computed(() => auth.busy || auth.status?.state === 'UNCONFIGURED' || waitingSeconds.value > 0);
watch(() => auth.status?.deviceName, (value) => { if (!deviceName.value && value) deviceName.value = value; }, { immediate: true });
onBeforeUnmount(() => { password.value = ''; window.clearInterval(timer); });
async function submit(): Promise<void> {
  if (disabled.value) return;
  const input = { email: email.value, password: password.value, deviceName: deviceName.value };
  password.value = '';
  try {
    await auth.login(input);
    if (auth.status?.state === 'AUTHENTICATED' && !auth.status.errorCode) await router.push('/configuracion');
    else { await nextTick(); feedback.value?.focus(); }
  } finally { input.password = ''; }
}
</script>

<template>
  <PageHeader title="Acceso institucional" description="Vincula este equipo con el servidor de nómina." />
  <section class="auth-panel" aria-labelledby="access-title" :aria-busy="auth.busy">
    <h2 id="access-title">Iniciar sesión y registrar equipo</h2>
    <p class="mb-1">Servidor institucional</p>
    <p class="auth-origin">{{ auth.status?.apiOrigin ?? 'Sin configurar' }}</p>
    <p>La sesión autoriza a este dispositivo. Los archivos TXT y reportes se procesan localmente.</p>
    <div
      v-if="auth.transportError || auth.status?.message" ref="feedback" tabindex="-1"
      class="alert" :class="auth.transportError || auth.status?.errorCode ? 'alert-warning' : 'alert-info'" role="status"
    >
      {{ auth.transportError || auth.status?.message }}
    </div>
    <form @submit.prevent="submit">
      <fieldset :disabled="disabled">
        <legend class="visually-hidden">Credenciales y nombre del equipo</legend>
        <div class="mb-3"><label for="central-email" class="form-label">Correo electrónico</label>
          <input id="central-email" v-model.trim="email" class="form-control" name="email" type="email" autocomplete="username" maxlength="255" required /></div>
        <div class="mb-3"><label for="central-password" class="form-label">Contraseña</label>
          <input id="central-password" v-model="password" class="form-control" name="password" type="password" autocomplete="current-password" maxlength="255" required aria-describedby="password-help" />
          <p id="password-help" class="form-text">La contraseña no se guarda. La sesión se protege con el cifrado de Windows.</p></div>
        <div class="mb-4"><label for="central-device" class="form-label">Nombre del equipo</label>
          <input id="central-device" v-model.trim="deviceName" class="form-control" name="deviceName" maxlength="120" required aria-describedby="device-help" />
          <p id="device-help" class="form-text">Usa un nombre reconocible, por ejemplo: Nómina · Oficina 01.</p></div>
        <button class="btn btn-primary" type="submit">{{ auth.busy ? 'Verificando…' : 'Iniciar sesión y registrar equipo' }}</button>
      </fieldset>
      <p v-if="waitingSeconds" class="form-text" role="status">Podrás volver a intentar en {{ waitingSeconds }} segundos.</p>
      <p v-if="auth.status?.state === 'UNCONFIGURED'" class="form-text">El acceso está deshabilitado hasta configurar el servidor en la aplicación de escritorio.</p>
    </form>
    <p class="mt-4 mb-0 small">Fase 1: autenticación del equipo. La sincronización central aún no está disponible.</p>
    <RouterLink class="d-inline-block mt-3" to="/historico">Consultar histórico local</RouterLink>
  </section>
</template>
