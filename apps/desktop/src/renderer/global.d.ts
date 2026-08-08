import type { AppInfoApi } from "../shared/app-info";

declare global {
  interface Window {
    printTune: AppInfoApi;
  }
}

export {};
