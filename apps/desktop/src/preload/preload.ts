import { contextBridge, ipcRenderer } from "electron";

import { APP_INFO_CHANNEL, assertAppInfo, type AppInfoApi } from "../shared/app-info";

const appInfoApi: AppInfoApi = {
  async getAppInfo() {
    return assertAppInfo(await ipcRenderer.invoke(APP_INFO_CHANNEL));
  },
};

contextBridge.exposeInMainWorld("printTune", appInfoApi);
