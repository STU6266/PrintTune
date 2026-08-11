import type { Printer, PrinterState } from "@printtune/contracts";

import {
  type PrinterCreationPersistence,
  validateInitialPrinterState,
} from "./printer-creation-persistence.js";
import { SqlitePrinterRepository } from "./sqlite-printer-repository.js";
import { SqlitePrinterStateRepository } from "./sqlite-printer-state-repository.js";
import { SqlitePrinterStateSelectionPersistence } from "./sqlite-printer-state-selection-persistence.js";

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
  readonly #selection: SqlitePrinterStateSelectionPersistence;

  constructor(database: PrinterCreationSqliteConnection) {
    this.#database = database;
    this.#printers = new SqlitePrinterRepository(database);
    this.#states = new SqlitePrinterStateRepository(database);
    this.#selection = new SqlitePrinterStateSelectionPersistence(database);
  }

  async createPrinterWithInitialState(printer: Printer, initialState: PrinterState): Promise<void> {
    validateInitialPrinterState(printer, initialState);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      await this.#printers.save(printer);
      await this.#states.create(initialState);
      await this.#selection.setSelectedState(printer.id, initialState.id);
      this.#database.exec("COMMIT");
    } catch (error) {
      if (this.#database.isTransaction) {
        this.#database.exec("ROLLBACK");
      }
      throw error;
    }
  }
}
