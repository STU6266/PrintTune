import type { AppInfoApi } from "../shared/app-info";
import type { FeatureFlagsApi } from "../shared/feature-flags-api";

declare global {
  interface Window {
    printTune: AppInfoApi & FeatureFlagsApi;
  }
}

export {};
