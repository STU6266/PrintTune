import type { PrinterKnowledgeIdentity } from "@printtune/contracts";

export interface PrinterKnowledgeIdentityRepository {
  create(identity: PrinterKnowledgeIdentity): Promise<void>;
  findById(id: string): Promise<PrinterKnowledgeIdentity | undefined>;
  listByPrinterId(printerId: string): Promise<PrinterKnowledgeIdentity[]>;
}

export class DuplicatePrinterKnowledgeIdentityError extends Error {
  override readonly name = "DuplicatePrinterKnowledgeIdentityError";
  constructor(readonly identityId: string) {
    super(`PrinterKnowledgeIdentity already exists: ${identityId}`);
  }
}
