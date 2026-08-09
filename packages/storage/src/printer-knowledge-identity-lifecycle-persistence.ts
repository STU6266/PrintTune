import type { PrinterKnowledgeIdentity } from "@printtune/contracts";
import { createPrinterKnowledgeIdentity } from "@printtune/core";

import {
  DuplicatePrinterKnowledgeIdentityError,
  type PrinterKnowledgeIdentityRepository,
} from "./printer-knowledge-identity-repository.js";
import {
  PrinterKnowledgeIdentityNotFoundError,
  PrinterKnowledgeIdentityOwnershipError,
  type PrinterKnowledgeIdentitySelectionPersistence,
} from "./printer-knowledge-identity-selection-persistence.js";

export interface PrinterKnowledgeIdentityLifecyclePersistence {
  createAndSelect(identity: PrinterKnowledgeIdentity): Promise<void>;
}

interface InMemoryLifecycleDependencies {
  readonly beforeSelection?: (identity: PrinterKnowledgeIdentity) => void | Promise<void>;
}

/**
 * Purpose-built atomic in-memory store. Product correction workflows should use createAndSelect;
 * repository and selection methods are exposed only as the matching read/test boundaries.
 */
export class InMemoryPrinterKnowledgeIdentityLifecyclePersistence
  implements
    PrinterKnowledgeIdentityLifecyclePersistence,
    PrinterKnowledgeIdentityRepository,
    PrinterKnowledgeIdentitySelectionPersistence
{
  readonly #identities = new Map<string, PrinterKnowledgeIdentity>();
  readonly #selections = new Map<string, string>();
  readonly #beforeSelection: (identity: PrinterKnowledgeIdentity) => void | Promise<void>;

  constructor(dependencies: InMemoryLifecycleDependencies = {}) {
    this.#beforeSelection = dependencies.beforeSelection ?? (() => undefined);
  }

  async createAndSelect(identity: PrinterKnowledgeIdentity): Promise<void> {
    if (this.#identities.has(identity.id)) {
      throw new DuplicatePrinterKnowledgeIdentityError(identity.id);
    }
    const stored = createPrinterKnowledgeIdentity(identity);
    await this.#beforeSelection(stored);

    this.#identities.set(stored.id, stored);
    this.#selections.set(stored.printerId, stored.id);
  }

  async create(identity: PrinterKnowledgeIdentity): Promise<void> {
    if (this.#identities.has(identity.id)) {
      throw new DuplicatePrinterKnowledgeIdentityError(identity.id);
    }
    const stored = createPrinterKnowledgeIdentity(identity);
    this.#identities.set(stored.id, stored);
  }

  async findById(id: string): Promise<PrinterKnowledgeIdentity | undefined> {
    const identity = this.#identities.get(id);
    return identity ? createPrinterKnowledgeIdentity(identity) : undefined;
  }

  async listByPrinterId(printerId: string): Promise<PrinterKnowledgeIdentity[]> {
    return [...this.#identities.values()]
      .filter((identity) => identity.printerId === printerId)
      .sort(
        (left, right) =>
          left.selectedAt.localeCompare(right.selectedAt) || left.id.localeCompare(right.id)
      )
      .map((identity) => createPrinterKnowledgeIdentity(identity));
  }

  async getSelectedIdentityId(printerId: string): Promise<string | undefined> {
    return this.#selections.get(printerId);
  }

  async setSelectedIdentity(printerId: string, identityId: string): Promise<void> {
    const identity = this.#identities.get(identityId);
    if (!identity) throw new PrinterKnowledgeIdentityNotFoundError(identityId);
    if (identity.printerId !== printerId) {
      throw new PrinterKnowledgeIdentityOwnershipError(printerId, identityId);
    }
    this.#selections.set(printerId, identityId);
  }

  async clearSelection(printerId: string): Promise<void> {
    this.#selections.delete(printerId);
  }
}
