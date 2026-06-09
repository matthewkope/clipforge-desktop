import type { AppApi } from '../../shared/media';

declare global {
  interface Window {
    clipForge: AppApi;
  }
}

export {};
