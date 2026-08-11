import type { PrinterState } from "@printtune/contracts";

export interface PrinterStateRepository {
  create(state: PrinterState): Promise<void>;
  findById(id: string): Promise<PrinterState | undefined>;
  listByPrinterId(printerId: string): Promise<PrinterState[]>;
}

export class DuplicatePrinterStateError extends Error {
  override readonly name = "DuplicatePrinterStateError";

  constructor(readonly stateId: string) {
    super(`PrinterState already exists: ${stateId}`);
  }
}

export class PrinterStateParentNotFoundError extends Error {
  override readonly name = "PrinterStateParentNotFoundError";

  constructor(readonly parentStateId: string) {
    super(`PrinterState parent not found: ${parentStateId}`);
  }
}

export class PrinterStateParentOwnershipError extends Error {
  override readonly name = "PrinterStateParentOwnershipError";

  constructor(
    readonly stateId: string,
    readonly parentStateId: string
  ) {
    super(`PrinterState parent ${parentStateId} does not belong to State ${stateId}'s Printer`);
  }
}
