import type { Printer, PrinterState, Workspace } from "@printtune/contracts";
import type { PrinterRepository, PrinterStateRepository } from "@printtune/storage";

import type { ActiveWorkspaceSession } from "./active-workspace-session";
import type { PrinterApplicationService } from "./printer-application-service";

export class NoActiveWorkspaceError extends Error {
  override readonly name = "NoActiveWorkspaceError";
}

export class PrinterNotFoundError extends Error {
  override readonly name = "PrinterNotFoundError";

  constructor(readonly printerId: string) {
    super(`Printer not found in active Workspace: ${printerId}`);
  }
}

export interface ActiveWorkspacePrinterList {
  readonly activeWorkspace: Workspace | undefined;
  readonly printers: readonly Printer[];
}

export interface PrinterDetail {
  readonly printer: Printer;
  readonly initialState: PrinterState;
}

export class PrinterFlowApplicationService {
  readonly #printerCreation: PrinterApplicationService;
  readonly #printers: PrinterRepository;
  readonly #states: PrinterStateRepository;
  readonly #activeWorkspace: ActiveWorkspaceSession;

  constructor(
    printerCreation: PrinterApplicationService,
    printers: PrinterRepository,
    states: PrinterStateRepository,
    activeWorkspace: ActiveWorkspaceSession
  ) {
    this.#printerCreation = printerCreation;
    this.#printers = printers;
    this.#states = states;
    this.#activeWorkspace = activeWorkspace;
  }

  async listPrinters(): Promise<ActiveWorkspacePrinterList> {
    const activeWorkspace = await this.#activeWorkspace.getActiveWorkspace();
    return {
      activeWorkspace,
      printers: activeWorkspace ? await this.#printers.listByWorkspaceId(activeWorkspace.id) : [],
    };
  }

  async createPrinter(name: string): Promise<PrinterDetail> {
    const workspace = await this.#requireActiveWorkspace();
    const created = await this.#printerCreation.createPrinterWithInitialState({
      workspaceId: workspace.id,
      printerName: name,
    });
    return { printer: created.printer, initialState: created.initialState };
  }

  async getPrinterDetail(id: string): Promise<PrinterDetail> {
    const workspace = await this.#requireActiveWorkspace();
    const printer = await this.#printers.findById(id);
    if (!printer || printer.workspaceId !== workspace.id) {
      throw new PrinterNotFoundError(id);
    }

    const initialState = (await this.#states.listByPrinterId(printer.id))[0];
    if (!initialState) {
      throw new PrinterNotFoundError(id);
    }

    return { printer, initialState };
  }

  async #requireActiveWorkspace(): Promise<Workspace> {
    const workspace = await this.#activeWorkspace.getActiveWorkspace();
    if (!workspace) {
      throw new NoActiveWorkspaceError();
    }
    return workspace;
  }
}
