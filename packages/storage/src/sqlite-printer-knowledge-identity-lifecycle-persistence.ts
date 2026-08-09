import type { PrinterKnowledgeIdentity } from "@printtune/contracts";

import type { PrinterKnowledgeIdentityLifecyclePersistence } from "./printer-knowledge-identity-lifecycle-persistence.js";
import { SqlitePrinterKnowledgeIdentityRepository } from "./sqlite-printer-knowledge-identity-repository.js";
import { SqlitePrinterKnowledgeIdentitySelectionPersistence } from "./sqlite-printer-knowledge-identity-selection-persistence.js";

interface LifecycleSqliteConnection {
  readonly isTransaction: boolean;
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: (string | null)[]): { readonly changes: number | bigint };
    get(...values: string[]): unknown;
    all(...values: string[]): unknown[];
  };
}

export class SqlitePrinterKnowledgeIdentityLifecyclePersistence implements PrinterKnowledgeIdentityLifecyclePersistence {
  readonly #database: LifecycleSqliteConnection;
  readonly #identities: SqlitePrinterKnowledgeIdentityRepository;
  readonly #selection: SqlitePrinterKnowledgeIdentitySelectionPersistence;

  constructor(database: LifecycleSqliteConnection) {
    this.#database = database;
    this.#identities = new SqlitePrinterKnowledgeIdentityRepository(database);
    this.#selection = new SqlitePrinterKnowledgeIdentitySelectionPersistence(database);
  }

  async createAndSelect(identity: PrinterKnowledgeIdentity): Promise<void> {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      await this.#identities.create(identity);
      await this.#selection.setSelectedIdentity(identity.printerId, identity.id);
      this.#database.exec("COMMIT");
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}
