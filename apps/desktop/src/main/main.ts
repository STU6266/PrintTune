import { join } from "node:path";

import { ALPHA_FEATURE_FLAGS, type FeatureFlags } from "@printtune/contracts";
import { app, BrowserWindow, ipcMain, type WebContents } from "electron";

import { APP_INFO_CHANNEL, type AppInfo } from "../shared/app-info";
import { FEATURE_FLAGS_CHANNEL } from "../shared/feature-flags-api";
import { ActiveWorkspaceSession } from "./active-workspace-session";
import { FieldResolutionService } from "./field-resolution-service";
import { initializeApplicationStorage, type ApplicationStorage } from "./application-storage";
import { PrinterApplicationService } from "./printer-application-service";
import { PrinterFlowApplicationService } from "./printer-flow-application-service";
import { registerPrinterIpcHandlers } from "./printer-ipc";
import { InstalledKnowledgePackageSource } from "./installed-knowledge-package-source";
import { PrinterKnowledgeClassificationService } from "./printer-knowledge-classification-service";
import { PrinterKnowledgeApplicationService } from "./printer-knowledge-application-service";
import { PrinterKnowledgeIdentityApplicationService } from "./printer-knowledge-identity-application-service";
import { registerPrinterKnowledgeIpcHandlers } from "./printer-knowledge-ipc";
import { PrinterKnowledgeUiService } from "./printer-knowledge-ui-service";
import { registerPrinterTechnicalDataIpcHandlers } from "./printer-technical-data-ipc";
import { PrinterTechnicalDataService } from "./printer-technical-data-service";
import { PrinterStateLifecycleApplicationService } from "./printer-state-lifecycle-application-service";
import { registerPrinterStateLifecycleIpcHandlers } from "./printer-state-lifecycle-ipc";
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
  const printerRepository = applicationStorage.database.createPrinterRepository();
  const printerStateRepository = applicationStorage.database.createPrinterStateRepository();
  const printerStateSelection =
    applicationStorage.database.createPrinterStateSelectionPersistence();
  const printerFlowService = new PrinterFlowApplicationService(
    new PrinterApplicationService(applicationStorage.database.createPrinterCreationPersistence()),
    printerRepository,
    printerStateRepository,
    printerStateSelection,
    activeWorkspaceSession
  );
  const fieldClaimRepository = applicationStorage.database.createFieldClaimRepository();
  const printerStateLifecycleService = new PrinterStateLifecycleApplicationService(
    activeWorkspaceSession,
    printerRepository,
    printerStateRepository,
    printerStateSelection,
    applicationStorage.database.createComponentInstallationRepository(),
    fieldClaimRepository,
    applicationStorage.database.createPrinterStateTransitionLifecyclePersistence()
  );
  const printerTechnicalDataService = new PrinterTechnicalDataService(
    printerFlowService,
    fieldClaimRepository,
    new FieldResolutionService(fieldClaimRepository)
  );
  const identityRepository = applicationStorage.database.createPrinterKnowledgeIdentityRepository();
  const identitySelection =
    applicationStorage.database.createPrinterKnowledgeIdentitySelectionPersistence();
  const identityApplicationService = new PrinterKnowledgeIdentityApplicationService(
    applicationStorage.database.createPrinterKnowledgeIdentityLifecyclePersistence(),
    identityRepository,
    identitySelection,
    printerRepository,
    activeWorkspaceSession
  );
  const installedPackages = applicationStorage.database.createInstalledKnowledgePackageRepository();
  const packageSource = new InstalledKnowledgePackageSource(installedPackages);
  const printerKnowledgeUiService = new PrinterKnowledgeUiService(
    installedPackages,
    packageSource,
    identityRepository,
    identitySelection,
    printerRepository,
    printerStateRepository,
    printerStateSelection,
    activeWorkspaceSession
  );
  const printerKnowledgeClassificationService = new PrinterKnowledgeClassificationService(
    packageSource,
    identityApplicationService
  );
  const printerKnowledgeApplicationService = new PrinterKnowledgeApplicationService(
    printerRepository,
    printerStateRepository,
    identityRepository,
    identitySelection,
    packageSource,
    applicationStorage.database.createPackageApplicationRepository(),
    applicationStorage.database.createPackageApplicationLifecyclePersistence(),
    printerStateSelection,
    activeWorkspaceSession
  );
  registerAppInfoHandler();
  registerFeatureFlagsHandler();
  registerWorkspaceIpcHandlers(
    ipcMain,
    workspaceService,
    activeWorkspaceSession,
    () => trustedRenderer
  );
  registerPrinterIpcHandlers(ipcMain, printerFlowService, () => trustedRenderer);
  registerPrinterStateLifecycleIpcHandlers(
    ipcMain,
    printerStateLifecycleService,
    () => trustedRenderer
  );
  registerPrinterKnowledgeIpcHandlers(
    ipcMain,
    printerKnowledgeUiService,
    printerKnowledgeClassificationService,
    printerKnowledgeApplicationService,
    () => trustedRenderer
  );
  registerPrinterTechnicalDataIpcHandlers(
    ipcMain,
    printerTechnicalDataService,
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
