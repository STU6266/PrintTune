import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { openPrintTuneDatabase, type PrintTuneDatabase } from "@printtune/storage";

const PRINTTUNE_DATA_DIRECTORY_NAME = "PrintTune";
const PRINTTUNE_DATABASE_FILENAME = "printtune.sqlite";

export interface ApplicationStoragePaths {
  readonly dataDirectory: string;
  readonly databasePath: string;
}

interface ApplicationStorageDependencies {
  readonly createDirectory?: (path: string) => void;
  readonly openDatabase?: (path: string) => PrintTuneDatabase;
}

export interface ApplicationStorage {
  readonly database: PrintTuneDatabase;
  close(): void;
}

class MainProcessApplicationStorage implements ApplicationStorage {
  #database: PrintTuneDatabase | undefined;

  constructor(database: PrintTuneDatabase) {
    this.#database = database;
  }

  get database(): PrintTuneDatabase {
    if (!this.#database) {
      throw new Error("Application storage is closed");
    }

    return this.#database;
  }

  close(): void {
    const database = this.#database;
    if (!database) {
      return;
    }

    this.#database = undefined;
    database.close();
  }
}

export function resolveApplicationStoragePaths(appDataDirectory: string): ApplicationStoragePaths {
  const dataDirectory = join(appDataDirectory, PRINTTUNE_DATA_DIRECTORY_NAME);

  return {
    dataDirectory,
    databasePath: join(dataDirectory, PRINTTUNE_DATABASE_FILENAME),
  };
}

export function initializeApplicationStorage(
  appDataDirectory: string,
  dependencies: ApplicationStorageDependencies = {}
): ApplicationStorage {
  const paths = resolveApplicationStoragePaths(appDataDirectory);
  const createDirectory =
    dependencies.createDirectory ?? ((path) => mkdirSync(path, { recursive: true }));
  const openDatabase = dependencies.openDatabase ?? openPrintTuneDatabase;

  createDirectory(paths.dataDirectory);

  const database = openDatabase(paths.databasePath);
  try {
    database.migrate();
    return new MainProcessApplicationStorage(database);
  } catch (error) {
    database.close();
    throw error;
  }
}
