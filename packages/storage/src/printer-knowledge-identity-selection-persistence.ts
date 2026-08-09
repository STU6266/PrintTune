import type { PrinterKnowledgeIdentityRepository } from "./printer-knowledge-identity-repository.js";

export interface PrinterKnowledgeIdentitySelectionPersistence {
  getSelectedIdentityId(printerId: string): Promise<string | undefined>;
  setSelectedIdentity(printerId: string, identityId: string): Promise<void>;
  clearSelection(printerId: string): Promise<void>;
}

export class PrinterKnowledgeIdentityNotFoundError extends Error {
  override readonly name = "PrinterKnowledgeIdentityNotFoundError";
  constructor(readonly identityId: string) {
    super(`PrinterKnowledgeIdentity not found: ${identityId}`);
  }
}

export class PrinterKnowledgeIdentityOwnershipError extends Error {
  override readonly name = "PrinterKnowledgeIdentityOwnershipError";
  constructor(
    readonly printerId: string,
    readonly identityId: string
  ) {
    super(`PrinterKnowledgeIdentity ${identityId} does not belong to Printer ${printerId}`);
  }
}

export class InMemoryPrinterKnowledgeIdentitySelectionPersistence implements PrinterKnowledgeIdentitySelectionPersistence {
  readonly #identities: PrinterKnowledgeIdentityRepository;
  readonly #selections = new Map<string, string>();

  constructor(identities: PrinterKnowledgeIdentityRepository) {
    this.#identities = identities;
  }

  async getSelectedIdentityId(printerId: string): Promise<string | undefined> {
    return this.#selections.get(printerId);
  }

  async setSelectedIdentity(printerId: string, identityId: string): Promise<void> {
    const identity = await this.#identities.findById(identityId);
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
