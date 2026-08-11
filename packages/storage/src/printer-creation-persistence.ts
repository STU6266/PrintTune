import type { Printer, PrinterState } from "@printtune/contracts";

import type { PrinterRepository } from "./printer-repository.js";
import {
  InMemoryPrinterStateRepository,
  deletePrinterStateForRollback,
} from "./in-memory-printer-state-repository.js";
import {
  InMemoryPrinterStateSelectionPersistence,
  deletePrinterStateSelectionForRollback,
} from "./printer-state-selection-persistence.js";

export interface PrinterCreationPersistence {
  createPrinterWithInitialState(printer: Printer, initialState: PrinterState): Promise<void>;
}

export class InvalidInitialPrinterStateError extends Error {
  override readonly name = "InvalidInitialPrinterStateError";

  constructor() {
    super("Initial PrinterState must belong to the new Printer and have no parent");
  }
}

export function validateInitialPrinterState(printer: Printer, state: PrinterState): void {
  if (state.printerId !== printer.id || state.parentPrinterStateId !== undefined) {
    throw new InvalidInitialPrinterStateError();
  }
}

export class InMemoryPrinterCreationPersistence implements PrinterCreationPersistence {
  readonly #printers: PrinterRepository;
  readonly #states: InMemoryPrinterStateRepository;
  readonly #selection: InMemoryPrinterStateSelectionPersistence;

  constructor(
    printers: PrinterRepository,
    states: InMemoryPrinterStateRepository,
    selection: InMemoryPrinterStateSelectionPersistence
  ) {
    this.#printers = printers;
    this.#states = states;
    this.#selection = selection;
  }

  async createPrinterWithInitialState(printer: Printer, initialState: PrinterState): Promise<void> {
    validateInitialPrinterState(printer, initialState);
    const previousPrinter = await this.#printers.findById(printer.id);
    const previousSelection = await this.#selection.getSelectedStateId(printer.id);
    let stateCreated = false;
    await this.#printers.save(printer);

    try {
      await this.#states.create(initialState);
      stateCreated = true;
      await this.#selection.setSelectedState(printer.id, initialState.id);
    } catch (error) {
      if (previousSelection === undefined) {
        this.#selection[deletePrinterStateSelectionForRollback](printer.id);
      } else {
        await this.#selection.setSelectedState(printer.id, previousSelection);
      }
      if (stateCreated) this.#states[deletePrinterStateForRollback](initialState.id);
      if (previousPrinter) {
        await this.#printers.save(previousPrinter);
      } else {
        await this.#printers.delete(printer.id);
      }
      throw error;
    }
  }
}
