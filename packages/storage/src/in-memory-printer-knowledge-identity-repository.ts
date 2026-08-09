import type { PrinterKnowledgeIdentity } from "@printtune/contracts";
import { createPrinterKnowledgeIdentity } from "@printtune/core";

import {
  DuplicatePrinterKnowledgeIdentityError,
  type PrinterKnowledgeIdentityRepository,
} from "./printer-knowledge-identity-repository.js";

function copyIdentity(identity: PrinterKnowledgeIdentity): PrinterKnowledgeIdentity {
  return createPrinterKnowledgeIdentity(identity);
}

function compare(left: PrinterKnowledgeIdentity, right: PrinterKnowledgeIdentity): number {
  return left.selectedAt.localeCompare(right.selectedAt) || left.id.localeCompare(right.id);
}

export class InMemoryPrinterKnowledgeIdentityRepository implements PrinterKnowledgeIdentityRepository {
  readonly #identities = new Map<string, PrinterKnowledgeIdentity>();

  async create(identity: PrinterKnowledgeIdentity): Promise<void> {
    if (this.#identities.has(identity.id)) {
      throw new DuplicatePrinterKnowledgeIdentityError(identity.id);
    }
    this.#identities.set(identity.id, copyIdentity(identity));
  }

  async findById(id: string): Promise<PrinterKnowledgeIdentity | undefined> {
    const identity = this.#identities.get(id);
    return identity ? copyIdentity(identity) : undefined;
  }

  async listByPrinterId(printerId: string): Promise<PrinterKnowledgeIdentity[]> {
    return [...this.#identities.values()]
      .filter((identity) => identity.printerId === printerId)
      .sort(compare)
      .map(copyIdentity);
  }
}
