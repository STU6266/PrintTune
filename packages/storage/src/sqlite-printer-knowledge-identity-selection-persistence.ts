import {
  PrinterKnowledgeIdentityNotFoundError,
  PrinterKnowledgeIdentityOwnershipError,
  type PrinterKnowledgeIdentitySelectionPersistence,
} from "./printer-knowledge-identity-selection-persistence.js";

interface SelectionStatement {
  run(...values: string[]): { readonly changes: number | bigint };
  get(...values: string[]): unknown;
}

interface SelectionConnection {
  prepare(sql: string): SelectionStatement;
}

export class PrinterKnowledgeIdentitySelectionDataIntegrityError extends Error {
  override readonly name = "PrinterKnowledgeIdentitySelectionDataIntegrityError";
}

export class SqlitePrinterKnowledgeIdentitySelectionPersistence implements PrinterKnowledgeIdentitySelectionPersistence {
  readonly #getSelection: SelectionStatement;
  readonly #findIdentityOwner: SelectionStatement;
  readonly #setSelection: SelectionStatement;
  readonly #clearSelection: SelectionStatement;

  constructor(database: SelectionConnection) {
    this.#getSelection = database.prepare(`
      SELECT identity_id FROM printer_knowledge_identity_selections WHERE printer_id = ?
    `);
    this.#findIdentityOwner = database.prepare(`
      SELECT printer_id FROM printer_knowledge_identities WHERE id = ?
    `);
    this.#setSelection = database.prepare(`
      INSERT INTO printer_knowledge_identity_selections (printer_id, identity_id)
      VALUES (?, ?)
      ON CONFLICT (printer_id) DO UPDATE SET identity_id = excluded.identity_id
    `);
    this.#clearSelection = database.prepare(`
      DELETE FROM printer_knowledge_identity_selections WHERE printer_id = ?
    `);
  }

  async getSelectedIdentityId(printerId: string): Promise<string | undefined> {
    const row = this.#getSelection.get(printerId);
    if (row === undefined) return undefined;
    if (
      typeof row !== "object" ||
      row === null ||
      Array.isArray(row) ||
      typeof (row as Record<string, unknown>).identity_id !== "string"
    ) {
      throw new PrinterKnowledgeIdentitySelectionDataIntegrityError(
        "Invalid persisted PrinterKnowledgeIdentity selection"
      );
    }
    return (row as { identity_id: string }).identity_id;
  }

  async setSelectedIdentity(printerId: string, identityId: string): Promise<void> {
    const ownerRow = this.#findIdentityOwner.get(identityId);
    if (ownerRow === undefined) throw new PrinterKnowledgeIdentityNotFoundError(identityId);
    if (
      typeof ownerRow !== "object" ||
      ownerRow === null ||
      Array.isArray(ownerRow) ||
      typeof (ownerRow as Record<string, unknown>).printer_id !== "string"
    ) {
      throw new PrinterKnowledgeIdentitySelectionDataIntegrityError(
        "Invalid persisted PrinterKnowledgeIdentity owner"
      );
    }
    if ((ownerRow as { printer_id: string }).printer_id !== printerId) {
      throw new PrinterKnowledgeIdentityOwnershipError(printerId, identityId);
    }
    this.#setSelection.run(printerId, identityId);
  }

  async clearSelection(printerId: string): Promise<void> {
    this.#clearSelection.run(printerId);
  }
}
