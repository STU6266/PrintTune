import { contextBridge, ipcRenderer } from "electron";

import { APP_INFO_CHANNEL, assertAppInfo, type AppInfoApi } from "../shared/app-info";
import { createFeatureFlagsApi, type FeatureFlagsApi } from "../shared/feature-flags-api";
import { createPrinterApi, type PrinterApi } from "../shared/printer-api";
import {
  createPrinterKnowledgeApi,
  type PrinterKnowledgeApi,
} from "../shared/printer-knowledge-ui-api";
import {
  createPrinterTechnicalDataApi,
  type PrinterTechnicalDataApi,
} from "../shared/printer-technical-data-api";
import { createWorkspaceApi, type WorkspaceApi } from "../shared/workspace-api";

const appInfoApi: AppInfoApi = {
  async getAppInfo() {
    return assertAppInfo(await ipcRenderer.invoke(APP_INFO_CHANNEL));
  },
};

const featureFlagsApi = createFeatureFlagsApi((channel) => ipcRenderer.invoke(channel));
const workspaceApi = createWorkspaceApi((channel, payload) => ipcRenderer.invoke(channel, payload));
const printerApi = createPrinterApi((channel, payload) => ipcRenderer.invoke(channel, payload));
const printerKnowledgeApi = createPrinterKnowledgeApi((channel, payload) =>
  ipcRenderer.invoke(channel, payload)
);
const printerTechnicalDataApi = createPrinterTechnicalDataApi((channel, payload) =>
  ipcRenderer.invoke(channel, payload)
);

const printTuneApi: AppInfoApi &
  FeatureFlagsApi &
  WorkspaceApi &
  PrinterApi &
  PrinterKnowledgeApi &
  PrinterTechnicalDataApi = Object.freeze({
  ...appInfoApi,
  ...featureFlagsApi,
  ...workspaceApi,
  ...printerApi,
  ...printerKnowledgeApi,
  ...printerTechnicalDataApi,
});

contextBridge.exposeInMainWorld("printTune", printTuneApi);
