import { join } from "node:path";

import { ALPHA_FEATURE_FLAGS, type FeatureFlags } from "@printtune/contracts";
import { app, BrowserWindow, ipcMain } from "electron";

import { APP_INFO_CHANNEL, type AppInfo } from "../shared/app-info";
import { FEATURE_FLAGS_CHANNEL } from "../shared/feature-flags-api";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

function registerAppInfoHandler(): void {
  ipcMain.handle(APP_INFO_CHANNEL, (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
    };
  });
}

function registerFeatureFlagsHandler(): void {
  ipcMain.handle(FEATURE_FLAGS_CHANNEL, (): FeatureFlags => ALPHA_FEATURE_FLAGS);
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const developmentUrl = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);

    if (!["localhost", "127.0.0.1"].includes(developmentUrl.hostname)) {
      throw new Error("Desktop development server must use a loopback address");
    }

    await window.loadURL(developmentUrl.toString());
    return;
  }

  await window.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
}

async function createWindow(): Promise<void> {
  const mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 480,
    title: "PrintTune Alpha",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await loadRenderer(mainWindow);
}

app.whenReady().then(async () => {
  registerAppInfoHandler();
  registerFeatureFlagsHandler();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
