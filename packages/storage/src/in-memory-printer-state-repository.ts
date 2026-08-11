import type { PrinterState } from "@printtune/contracts";

import {
  DuplicatePrinterStateError,
  PrinterStateParentNotFoundError,
  PrinterStateParentOwnershipError,
  type PrinterStateRepository,
} from "./printer-state-repository.js";

function copyState(state: PrinterState): PrinterState {
  return { ...state };
}

export const deletePrinterStateForRollback = Symbol("deletePrinterStateForRollback");

function compare(left: PrinterState, right: PrinterState): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export class InMemoryPrinterStateRepository implements PrinterStateRepository {
  readonly #states = new Map<string, PrinterState>();

  async create(state: PrinterState): Promise<void> {
    if (this.#states.has(state.id)) {
      throw new DuplicatePrinterStateError(state.id);
    }

    if (state.parentPrinterStateId !== undefined) {
      const parent = this.#states.get(state.parentPrinterStateId);
      if (!parent) throw new PrinterStateParentNotFoundError(state.parentPrinterStateId);
      if (parent.printerId !== state.printerId) {
        throw new PrinterStateParentOwnershipError(state.id, state.parentPrinterStateId);
      }
    }

    this.#states.set(state.id, copyState(state));
  }

  [deletePrinterStateForRollback](stateId: string): void {
    this.#states.delete(stateId);
  }

  async findById(id: string): Promise<PrinterState | undefined> {
    const state = this.#states.get(id);
    return state ? copyState(state) : undefined;
  }

  async listByPrinterId(printerId: string): Promise<PrinterState[]> {
    return [...this.#states.values()]
      .filter((state) => state.printerId === printerId)
      .sort(compare)
      .map(copyState);
  }
}
