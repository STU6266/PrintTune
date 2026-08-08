import type { Printer } from "@printtune/contracts";

import type { PrinterRepository } from "./printer-repository.js";

function copyPrinter(printer: Printer): Printer {
  return { ...printer };
}

function compare(left: Printer, right: Printer): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export class InMemoryPrinterRepository implements PrinterRepository {
  readonly #printers = new Map<string, Printer>();

  async save(printer: Printer): Promise<void> {
    this.#printers.set(printer.id, copyPrinter(printer));
  }

  async findById(id: string): Promise<Printer | undefined> {
    const printer = this.#printers.get(id);
    return printer ? copyPrinter(printer) : undefined;
  }

  async listByWorkspaceId(workspaceId: string): Promise<Printer[]> {
    return [...this.#printers.values()]
      .filter((printer) => printer.workspaceId === workspaceId)
      .sort(compare)
      .map(copyPrinter);
  }

  async delete(id: string): Promise<boolean> {
    return this.#printers.delete(id);
  }
}
