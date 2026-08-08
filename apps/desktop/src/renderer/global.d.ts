import type { AppInfoApi } from "../shared/app-info";
import type { FeatureFlagsApi } from "../shared/feature-flags-api";
import type { WorkspaceApi } from "../shared/workspace-api";

declare global {
  interface Window {
    printTune: AppInfoApi & FeatureFlagsApi & WorkspaceApi;
  }
}

export {};
