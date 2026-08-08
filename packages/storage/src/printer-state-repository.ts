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
