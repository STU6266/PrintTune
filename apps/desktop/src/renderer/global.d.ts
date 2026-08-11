import type { AppInfoApi } from "../shared/app-info";
import type { FeatureFlagsApi } from "../shared/feature-flags-api";
import type { PrinterApi } from "../shared/printer-api";
import type { PrinterKnowledgeApi } from "../shared/printer-knowledge-ui-api";
import type { PrinterTechnicalDataApi } from "../shared/printer-technical-data-api";
import type { PrinterStateLifecycleApi } from "../shared/printer-state-lifecycle-api";
import type { WorkspaceApi } from "../shared/workspace-api";

declare global {
  interface Window {
    printTune: AppInfoApi &
      FeatureFlagsApi &
      WorkspaceApi &
      PrinterApi &
      PrinterKnowledgeApi &
      PrinterStateLifecycleApi &
      PrinterTechnicalDataApi;
  }
}

export {};
