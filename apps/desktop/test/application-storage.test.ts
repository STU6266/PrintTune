import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PrintTuneDatabase } from "@printtune/storage";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  initializeApplicationStorage,
  resolveApplicationStoragePaths,
} from "../src/main/application-storage";

const temporaryDirectories: string[] = [];

function createTemporaryAppDataDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "printtune-app-data-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("application storage paths", () => {
  it("constructs deterministic PrintTune paths from an app-data directory", () => {
    expect(resolveApplicationStoragePaths(join("root", "app-data"))).toEqual({
      dataDirectory: join("root", "app-data", "PrintTune"),
      databasePath: join("root", "app-data", "PrintTune", "printtune.sqlite"),
    });
  });
});

describe("application storage lifecycle", () => {
  it("creates the data directory, opens the database and migrates before repository use", async () => {
    const appDataDirectory = createTemporaryAppDataDirectory();
    const paths = resolveApplicationStoragePaths(appDataDirectory);
    const storage = initializeApplicationStorage(appDataDirectory);

    try {
      expect(existsSync(paths.dataDirectory)).toBe(true);
      expect(existsSync(paths.databasePath)).toBe(true);
      expect(storage.database.schemaVersion()).toBe(4);
      await expect(storage.database.createWorkspaceRepository().list()).resolves.toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("reopens and migrates an existing database successfully", () => {
    const appDataDirectory = createTemporaryAppDataDirectory();
    const firstStorage = initializeApplicationStorage(appDataDirectory);
    firstStorage.close();

    const secondStorage = initializeApplicationStorage(appDataDirectory);
    try {
      expect(secondStorage.database.schemaVersion()).toBe(4);
    } finally {
      secondStorage.close();
    }
  });

  it("closes safely more than once", () => {
    const storage = initializeApplicationStorage(createTemporaryAppDataDirectory());

    storage.close();

    expect(() => storage.close()).not.toThrow();
    expect(() => storage.database).toThrow("Application storage is closed");
  });

  it("closes a database whose initialization fails and returns no storage handle", () => {
    const migrationError = new Error("migration failed");
    const close = vi.fn();
    const database: PrintTuneDatabase = {
      migrate() {
        throw migrationError;
      },
      schemaVersion: vi.fn(),
      createWorkspaceRepository: vi.fn(),
      createPrinterRepository: vi.fn(),
      createPrinterStateRepository: vi.fn(),
      createPrinterCreationPersistence: vi.fn(),
      createComponentInstallationRepository: vi.fn(),
      close,
    };
    let storage: ReturnType<typeof initializeApplicationStorage> | undefined;

    expect(() => {
      storage = initializeApplicationStorage(createTemporaryAppDataDirectory(), {
        openDatabase: () => database,
      });
    }).toThrow(migrationError);

    expect(storage).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });

  it("uses and cleans up only the supplied temporary app-data directory", () => {
    const appDataDirectory = createTemporaryAppDataDirectory();
    const storage = initializeApplicationStorage(appDataDirectory);
    storage.close();

    rmSync(appDataDirectory, { force: true, recursive: true });

    expect(existsSync(appDataDirectory)).toBe(false);
    temporaryDirectories.splice(temporaryDirectories.indexOf(appDataDirectory), 1);
  });
});
