import type { Printer, PrinterState } from "@printtune/contracts";

import type { PrinterCreationPersistence } from "./printer-creation-persistence.js";
import { SqlitePrinterRepository } from "./sqlite-printer-repository.js";
import { SqlitePrinterStateRepository } from "./sqlite-printer-state-repository.js";

interface PrinterCreationSqliteConnection {
  readonly isTransaction: boolean;
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: string[]): { readonly changes: number | bigint };
    get(...values: string[]): unknown;
    all(...values: string[]): unknown[];
  };
}

export class SqlitePrinterCreationPersistence implements PrinterCreationPersistence {
  readonly #database: PrinterCreationSqliteConnection;
  readonly #printers: SqlitePrinterRepository;
  readonly #states: SqlitePrinterStateRepository;

  constructor(database: PrinterCreationSqliteConnection) {
    this.#database = database;
    this.#printers = new SqlitePrinterRepository(database);
    this.#states = new SqlitePrinterStateRepository(database);
  }

  async createPrinterWithInitialState(printer: Printer, initialState: PrinterState): Promise<void> {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      await this.#printers.save(printer);
      await this.#states.create(initialState);
      this.#database.exec("COMMIT");
    } catch (error) {
      if (this.#database.isTransaction) {
        this.#database.exec("ROLLBACK");
      }
      throw error;
    }
  }
}
