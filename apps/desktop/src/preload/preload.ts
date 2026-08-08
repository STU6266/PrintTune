import { contextBridge, ipcRenderer } from "electron";

import { APP_INFO_CHANNEL, assertAppInfo, type AppInfoApi } from "../shared/app-info";
import { createFeatureFlagsApi, type FeatureFlagsApi } from "../shared/feature-flags-api";
import { createWorkspaceApi, type WorkspaceApi } from "../shared/workspace-api";

const appInfoApi: AppInfoApi = {
  async getAppInfo() {
    return assertAppInfo(await ipcRenderer.invoke(APP_INFO_CHANNEL));
  },
};

const featureFlagsApi = createFeatureFlagsApi((channel) => ipcRenderer.invoke(channel));
const workspaceApi = createWorkspaceApi((channel, payload) => ipcRenderer.invoke(channel, payload));

const printTuneApi: AppInfoApi & FeatureFlagsApi & WorkspaceApi = Object.freeze({
  ...appInfoApi,
  ...featureFlagsApi,
  ...workspaceApi,
});

contextBridge.exposeInMainWorld("printTune", printTuneApi);
