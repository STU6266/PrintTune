import { randomUUID } from "node:crypto";

import type { Printer, PrinterState } from "@printtune/contracts";
import { createPrinter, createPrinterState } from "@printtune/core";
import type { PrinterCreationPersistence } from "@printtune/storage";

export interface CreatePrinterWithInitialStateInput {
  readonly workspaceId: string;
  readonly printerName: string;
}

export interface CreatedPrinterWithInitialState {
  readonly printer: Printer;
  readonly initialState: PrinterState;
}

interface PrinterApplicationServiceDependencies {
  readonly createPrinterId?: () => string;
  readonly createPrinterStateId?: () => string;
  readonly now?: () => string;
}

export class PrinterApplicationService {
  readonly #persistence: PrinterCreationPersistence;
  readonly #createPrinterId: () => string;
  readonly #createPrinterStateId: () => string;
  readonly #now: () => string;

  constructor(
    persistence: PrinterCreationPersistence,
    dependencies: PrinterApplicationServiceDependencies = {}
  ) {
    this.#persistence = persistence;
    this.#createPrinterId = dependencies.createPrinterId ?? randomUUID;
    this.#createPrinterStateId = dependencies.createPrinterStateId ?? randomUUID;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async createPrinterWithInitialState(
    input: CreatePrinterWithInitialStateInput
  ): Promise<CreatedPrinterWithInitialState> {
    const timestamp = this.#now();
    const printer = createPrinter({
      id: this.#createPrinterId(),
      workspaceId: input.workspaceId,
      name: input.printerName,
      timestamp,
    });
    const initialState = createPrinterState({
      id: this.#createPrinterStateId(),
      printerId: printer.id,
      timestamp,
    });

    await this.#persistence.createPrinterWithInitialState(printer, initialState);
    return { printer, initialState };
  }
}
