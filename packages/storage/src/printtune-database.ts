import type { DatabaseSync } from "node:sqlite";

import { openConfiguredSqliteDatabase } from "./sqlite-connection.js";
import {
  PRINTTUNE_SQLITE_MIGRATIONS,
  readSchemaVersion,
  runSqliteMigrations,
} from "./sqlite-migrations.js";
import { SqliteWorkspaceRepository } from "./sqlite-workspace-repository.js";
import { SqlitePrinterRepository } from "./sqlite-printer-repository.js";
import { SqlitePrinterStateRepository } from "./sqlite-printer-state-repository.js";
import { SqlitePrinterCreationPersistence } from "./sqlite-printer-creation-persistence.js";

export interface PrintTuneDatabase {
  migrate(): void;
  schemaVersion(): number;
  createWorkspaceRepository(): SqliteWorkspaceRepository;
  createPrinterRepository(): SqlitePrinterRepository;
  createPrinterStateRepository(): SqlitePrinterStateRepository;
  createPrinterCreationPersistence(): SqlitePrinterCreationPersistence;
  close(): void;
}

class PrintTuneSqliteDatabase implements PrintTuneDatabase {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    this.#database = openConfiguredSqliteDatabase(path);
  }

  migrate(): void {
    runSqliteMigrations(this.#database, PRINTTUNE_SQLITE_MIGRATIONS);
  }

  schemaVersion(): number {
    return readSchemaVersion(this.#database);
  }

  createWorkspaceRepository(): SqliteWorkspaceRepository {
    return new SqliteWorkspaceRepository(this.#database);
  }

  createPrinterRepository(): SqlitePrinterRepository {
    return new SqlitePrinterRepository(this.#database);
  }

  createPrinterStateRepository(): SqlitePrinterStateRepository {
    return new SqlitePrinterStateRepository(this.#database);
  }

  createPrinterCreationPersistence(): SqlitePrinterCreationPersistence {
    return new SqlitePrinterCreationPersistence(this.#database);
  }

  close(): void {
    this.#database.close();
  }
}

export function openPrintTuneDatabase(path: string): PrintTuneDatabase {
  return new PrintTuneSqliteDatabase(path);
}
