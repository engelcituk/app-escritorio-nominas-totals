import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { AuthStatus, LoginInput } from '@shared/types/auth';

export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus | null>(null);
  const pending = ref(false);
  const transportError = ref('');
  let unsubscribe: (() => void) | undefined;
  let revision = 0;
  const busy = computed(() => pending.value || !status.value || status.value.busy);
  const hasSession = computed(() => Boolean(status.value && ['AUTHENTICATED', 'OFFLINE', 'UNVERIFIED'].includes(status.value.state)));
  const label = computed(() => {
    if (!status.value) return 'Cargando sesión';
    if (status.value.busy) return 'Verificando sesión';
    return { UNCONFIGURED: 'Servidor sin configurar', AUTH_REQUIRED: 'Sin sesión central',
      AUTHENTICATED: 'Sesión central activa', OFFLINE: 'Sesión guardada · Sin conexión', UNVERIFIED: 'Sesión sin verificar' }[status.value.state];
  });
  async function start(): Promise<void> {
    if (unsubscribe) return;
    const requestedRevision = revision;
    try {
      unsubscribe = window.sefiplanApi.auth.onChanged((value) => { ++revision; status.value = value; });
      const initial = await window.sefiplanApi.auth.status();
      if (revision === requestedRevision) status.value = initial;
    } catch { transportError.value = 'No se pudo consultar la sesión del equipo.'; }
  }
  function stop(): void { unsubscribe?.(); unsubscribe = undefined; }
  async function perform(action: () => Promise<AuthStatus>): Promise<void> {
    if (pending.value) return;
    pending.value = true; transportError.value = '';
    try { status.value = await action(); }
    catch { transportError.value = 'No se pudo completar la solicitud. Intenta nuevamente.'; }
    finally { pending.value = false; }
  }
  // Credentials are arguments only: never Pinia state, localStorage or logs.
  const login = (input: LoginInput) => perform(() => window.sefiplanApi.auth.login(input));
  const logout = () => perform(() => window.sefiplanApi.auth.logout());
  const check = () => perform(() => window.sefiplanApi.auth.check());
  return { status, busy, hasSession, label, transportError, start, stop, login, logout, check };
});
