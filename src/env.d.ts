/// <reference types="vite/client" />

import type { SefiplanApi } from './shared/types/api';

declare global {
  interface Window {
    sefiplanApi: SefiplanApi;
  }
}

export {};
