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
import { SqliteComponentInstallationRepository } from "./sqlite-component-installation-repository.js";
import { SqliteFieldClaimRepository } from "./sqlite-field-claim-repository.js";
import { SqlitePrinterKnowledgeIdentityRepository } from "./sqlite-printer-knowledge-identity-repository.js";
import { SqlitePrinterKnowledgeIdentitySelectionPersistence } from "./sqlite-printer-knowledge-identity-selection-persistence.js";
import { SqlitePrinterKnowledgeIdentityLifecyclePersistence } from "./sqlite-printer-knowledge-identity-lifecycle-persistence.js";
import { SqliteInstalledKnowledgePackageRepository } from "./sqlite-installed-knowledge-package-repository.js";
import { SqlitePackageApplicationRepository } from "./sqlite-package-application-repository.js";
import { SqlitePackageApplicationLifecyclePersistence } from "./sqlite-package-application-lifecycle-persistence.js";
import { SqlitePrinterStateSelectionPersistence } from "./sqlite-printer-state-selection-persistence.js";
import { SqlitePrinterStateTransitionLifecyclePersistence } from "./sqlite-printer-state-transition-lifecycle-persistence.js";

export interface PrintTuneDatabase {
  migrate(): void;
  schemaVersion(): number;
  createWorkspaceRepository(): SqliteWorkspaceRepository;
  createPrinterRepository(): SqlitePrinterRepository;
  createPrinterStateRepository(): SqlitePrinterStateRepository;
  createPrinterStateSelectionPersistence(): SqlitePrinterStateSelectionPersistence;
  createPrinterStateTransitionLifecyclePersistence(): SqlitePrinterStateTransitionLifecyclePersistence;
  createPrinterCreationPersistence(): SqlitePrinterCreationPersistence;
  createComponentInstallationRepository(): SqliteComponentInstallationRepository;
  createFieldClaimRepository(): SqliteFieldClaimRepository;
  createPrinterKnowledgeIdentityRepository(): SqlitePrinterKnowledgeIdentityRepository;
  createPrinterKnowledgeIdentitySelectionPersistence(): SqlitePrinterKnowledgeIdentitySelectionPersistence;
  createPrinterKnowledgeIdentityLifecyclePersistence(): SqlitePrinterKnowledgeIdentityLifecyclePersistence;
  createInstalledKnowledgePackageRepository(): SqliteInstalledKnowledgePackageRepository;
  createPackageApplicationRepository(): SqlitePackageApplicationRepository;
  createPackageApplicationLifecyclePersistence(): SqlitePackageApplicationLifecyclePersistence;
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

  createPrinterStateSelectionPersistence(): SqlitePrinterStateSelectionPersistence {
    return new SqlitePrinterStateSelectionPersistence(this.#database);
  }

  createPrinterStateTransitionLifecyclePersistence(): SqlitePrinterStateTransitionLifecyclePersistence {
    return new SqlitePrinterStateTransitionLifecyclePersistence(this.#database);
  }

  createPrinterCreationPersistence(): SqlitePrinterCreationPersistence {
    return new SqlitePrinterCreationPersistence(this.#database);
  }

  createComponentInstallationRepository(): SqliteComponentInstallationRepository {
    return new SqliteComponentInstallationRepository(this.#database);
  }

  createFieldClaimRepository(): SqliteFieldClaimRepository {
    return new SqliteFieldClaimRepository(this.#database);
  }

  createPrinterKnowledgeIdentityRepository(): SqlitePrinterKnowledgeIdentityRepository {
    return new SqlitePrinterKnowledgeIdentityRepository(this.#database);
  }

  createPrinterKnowledgeIdentitySelectionPersistence(): SqlitePrinterKnowledgeIdentitySelectionPersistence {
    return new SqlitePrinterKnowledgeIdentitySelectionPersistence(this.#database);
  }

  createPrinterKnowledgeIdentityLifecyclePersistence(): SqlitePrinterKnowledgeIdentityLifecyclePersistence {
    return new SqlitePrinterKnowledgeIdentityLifecyclePersistence(this.#database);
  }

  createInstalledKnowledgePackageRepository(): SqliteInstalledKnowledgePackageRepository {
    return new SqliteInstalledKnowledgePackageRepository(this.#database);
  }

  createPackageApplicationRepository(): SqlitePackageApplicationRepository {
    return new SqlitePackageApplicationRepository(this.#database);
  }

  createPackageApplicationLifecyclePersistence(): SqlitePackageApplicationLifecyclePersistence {
    return new SqlitePackageApplicationLifecyclePersistence(this.#database);
  }

  close(): void {
    this.#database.close();
  }
}

export function openPrintTuneDatabase(path: string): PrintTuneDatabase {
  return new PrintTuneSqliteDatabase(path);
}
