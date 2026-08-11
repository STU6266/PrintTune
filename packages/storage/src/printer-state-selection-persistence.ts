import type { PrinterStateRepository } from "./printer-state-repository.js";

export interface PrinterStateSelectionPersistence {
  getSelectedStateId(printerId: string): Promise<string | undefined>;
  setSelectedState(printerId: string, printerStateId: string): Promise<void>;
}

export class PrinterStateSelectionStateNotFoundError extends Error {
  override readonly name = "PrinterStateSelectionStateNotFoundError";

  constructor(readonly printerStateId: string) {
    super(`PrinterState not found for working-state selection: ${printerStateId}`);
  }
}

export class PrinterStateSelectionOwnershipError extends Error {
  override readonly name = "PrinterStateSelectionOwnershipError";

  constructor(
    readonly printerId: string,
    readonly printerStateId: string
  ) {
    super(`PrinterState ${printerStateId} does not belong to Printer ${printerId}`);
  }
}

export const deletePrinterStateSelectionForRollback = Symbol(
  "deletePrinterStateSelectionForRollback"
);

export class InMemoryPrinterStateSelectionPersistence implements PrinterStateSelectionPersistence {
  readonly #states: PrinterStateRepository;
  readonly #selections = new Map<string, string>();

  constructor(states: PrinterStateRepository) {
    this.#states = states;
  }

  async getSelectedStateId(printerId: string): Promise<string | undefined> {
    return this.#selections.get(printerId);
  }

  async setSelectedState(printerId: string, printerStateId: string): Promise<void> {
    const state = await this.#states.findById(printerStateId);
    if (!state) throw new PrinterStateSelectionStateNotFoundError(printerStateId);
    if (state.printerId !== printerId) {
      throw new PrinterStateSelectionOwnershipError(printerId, printerStateId);
    }
    this.#selections.set(printerId, printerStateId);
  }

  [deletePrinterStateSelectionForRollback](printerId: string): void {
    this.#selections.delete(printerId);
  }
}
