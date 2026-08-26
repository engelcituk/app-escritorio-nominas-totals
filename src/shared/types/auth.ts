export interface LoginInput { email: string; password: string; deviceName: string }
export interface AuthStatus {
  state: 'UNCONFIGURED' | 'AUTH_REQUIRED' | 'AUTHENTICATED' | 'OFFLINE' | 'UNVERIFIED';
  busy: boolean;
  apiOrigin: string | null;
  appVersion: string;
  installationUuid: string;
  deviceUuid: string | null;
  deviceName: string;
  lastSeenAt: string | null;
  message: string | null;
  errorCode: string | null;
  retryAt: number | null;
}
