import type { AppInfoApi } from "../shared/app-info";
import type { FeatureFlagsApi } from "../shared/feature-flags-api";
import type { PrinterApi } from "../shared/printer-api";
import type { PrinterTechnicalDataApi } from "../shared/printer-technical-data-api";
import type { WorkspaceApi } from "../shared/workspace-api";

declare global {
  interface Window {
    printTune: AppInfoApi & FeatureFlagsApi & WorkspaceApi & PrinterApi & PrinterTechnicalDataApi;
  }
}

export {};
