import { contextBridge, ipcRenderer } from "electron";

import { APP_INFO_CHANNEL, assertAppInfo, type AppInfoApi } from "../shared/app-info";
import { createFeatureFlagsApi, type FeatureFlagsApi } from "../shared/feature-flags-api";

const appInfoApi: AppInfoApi = {
  async getAppInfo() {
    return assertAppInfo(await ipcRenderer.invoke(APP_INFO_CHANNEL));
  },
};

const featureFlagsApi = createFeatureFlagsApi((channel) => ipcRenderer.invoke(channel));

const printTuneApi: AppInfoApi & FeatureFlagsApi = Object.freeze({
  ...appInfoApi,
  ...featureFlagsApi,
});

contextBridge.exposeInMainWorld("printTune", printTuneApi);
