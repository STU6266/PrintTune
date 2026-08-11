import {
  PrinterStateSelectionOwnershipError,
  PrinterStateSelectionStateNotFoundError,
  type PrinterStateSelectionPersistence,
} from "./printer-state-selection-persistence.js";

interface SelectionStatement {
  run(...values: string[]): { readonly changes: number | bigint };
  get(...values: string[]): unknown;
}

interface SelectionConnection {
  prepare(sql: string): SelectionStatement;
}

export class PrinterStateSelectionDataIntegrityError extends Error {
  override readonly name = "PrinterStateSelectionDataIntegrityError";
}

function readOwner(row: unknown): string {
  if (
    typeof row !== "object" ||
    row === null ||
    Array.isArray(row) ||
    typeof (row as Record<string, unknown>).printer_id !== "string"
  ) {
    throw new PrinterStateSelectionDataIntegrityError("Invalid persisted PrinterState owner");
  }
  return (row as { printer_id: string }).printer_id;
}

export class SqlitePrinterStateSelectionPersistence implements PrinterStateSelectionPersistence {
  readonly #getSelection: SelectionStatement;
  readonly #findStateOwner: SelectionStatement;
  readonly #setSelection: SelectionStatement;

  constructor(database: SelectionConnection) {
    this.#getSelection = database.prepare(`
      SELECT printer_state_id FROM printer_state_selections WHERE printer_id = ?
    `);
    this.#findStateOwner = database.prepare(`
      SELECT printer_id FROM printer_states WHERE id = ?
    `);
    this.#setSelection = database.prepare(`
      INSERT INTO printer_state_selections (printer_id, printer_state_id)
      VALUES (?, ?)
      ON CONFLICT (printer_id) DO UPDATE SET printer_state_id = excluded.printer_state_id
    `);
  }

  async getSelectedStateId(printerId: string): Promise<string | undefined> {
    const row = this.#getSelection.get(printerId);
    if (row === undefined) return undefined;
    if (
      typeof row !== "object" ||
      row === null ||
      Array.isArray(row) ||
      typeof (row as Record<string, unknown>).printer_state_id !== "string"
    ) {
      throw new PrinterStateSelectionDataIntegrityError(
        "Invalid persisted PrinterState working selection"
      );
    }
    const stateId = (row as { printer_state_id: string }).printer_state_id;
    if (stateId.length === 0 || stateId.trim() !== stateId) {
      throw new PrinterStateSelectionDataIntegrityError(
        "Invalid persisted PrinterState working selection ID"
      );
    }
    return stateId;
  }

  async setSelectedState(printerId: string, printerStateId: string): Promise<void> {
    const ownerRow = this.#findStateOwner.get(printerStateId);
    if (ownerRow === undefined) throw new PrinterStateSelectionStateNotFoundError(printerStateId);
    if (readOwner(ownerRow) !== printerId) {
      throw new PrinterStateSelectionOwnershipError(printerId, printerStateId);
    }
    this.#setSelection.run(printerId, printerStateId);
  }
}
