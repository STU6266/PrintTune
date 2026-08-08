import type { Printer, PrinterState } from "@printtune/contracts";

import type { PrinterRepository } from "./printer-repository.js";
import type { PrinterStateRepository } from "./printer-state-repository.js";

export interface PrinterCreationPersistence {
  createPrinterWithInitialState(printer: Printer, initialState: PrinterState): Promise<void>;
}

export class InMemoryPrinterCreationPersistence implements PrinterCreationPersistence {
  readonly #printers: PrinterRepository;
  readonly #states: PrinterStateRepository;

  constructor(printers: PrinterRepository, states: PrinterStateRepository) {
    this.#printers = printers;
    this.#states = states;
  }

  async createPrinterWithInitialState(printer: Printer, initialState: PrinterState): Promise<void> {
    const previousPrinter = await this.#printers.findById(printer.id);
    await this.#printers.save(printer);

    try {
      await this.#states.create(initialState);
    } catch (error) {
      if (previousPrinter) {
        await this.#printers.save(previousPrinter);
      } else {
        await this.#printers.delete(printer.id);
      }
      throw error;
    }
  }
}
