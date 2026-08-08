import { join } from "node:path";

import { ALPHA_FEATURE_FLAGS, type FeatureFlags } from "@printtune/contracts";
import { app, BrowserWindow, ipcMain, type WebContents } from "electron";

import { APP_INFO_CHANNEL, type AppInfo } from "../shared/app-info";
import { FEATURE_FLAGS_CHANNEL } from "../shared/feature-flags-api";
import { ActiveWorkspaceSession } from "./active-workspace-session";
import { initializeApplicationStorage, type ApplicationStorage } from "./application-storage";
import {
  NODE_SQLITE_SMOKE_ARGUMENT,
  NODE_SQLITE_SMOKE_RESULT_PREFIX,
  runNodeSqliteCompatibilityCheck,
} from "./spikes/node-sqlite-compatibility";
import { WorkspaceApplicationService } from "./workspace-application-service";
import { registerWorkspaceIpcHandlers } from "./workspace-ipc";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let applicationStorage: ApplicationStorage | undefined;
let trustedRenderer: WebContents | undefined;

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

  trustedRenderer = mainWindow.webContents;
  mainWindow.on("closed", () => {
    if (trustedRenderer === mainWindow.webContents) {
      trustedRenderer = undefined;
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await loadRenderer(mainWindow);
}

function runNodeSqliteSmokeIfRequested(): boolean {
  if (!process.argv.includes(NODE_SQLITE_SMOKE_ARGUMENT)) {
    return false;
  }

  try {
    const result = runNodeSqliteCompatibilityCheck();
    process.stdout.write(`${NODE_SQLITE_SMOKE_RESULT_PREFIX}${JSON.stringify(result)}\n`);
    app.quit();
  } catch (error) {
    const message = error instanceof Error ? error.stack : String(error);
    process.stderr.write(`node:sqlite Electron smoke check failed: ${message}\n`);
    app.exit(1);
  }

  return true;
}

function closeApplicationStorage(): void {
  trustedRenderer = undefined;
  applicationStorage?.close();
  applicationStorage = undefined;
}

function reportStartupFailure(error: unknown): void {
  closeApplicationStorage();
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`PrintTune startup failed: ${message}\n`);
  app.exit(1);
}

async function startApplication(): Promise<void> {
  if (runNodeSqliteSmokeIfRequested()) {
    return;
  }

  applicationStorage = initializeApplicationStorage(app.getPath("appData"));
  const workspaceRepository = applicationStorage.database.createWorkspaceRepository();
  const workspaceService = new WorkspaceApplicationService(workspaceRepository);
  const activeWorkspaceSession = new ActiveWorkspaceSession(workspaceRepository);
  registerAppInfoHandler();
  registerFeatureFlagsHandler();
  registerWorkspaceIpcHandlers(
    ipcMain,
    workspaceService,
    activeWorkspaceSession,
    () => trustedRenderer
  );
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
}

void app.whenReady().then(startApplication).catch(reportStartupFailure);

app.on("before-quit", closeApplicationStorage);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
