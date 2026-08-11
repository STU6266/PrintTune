import type { PrinterState } from "@printtune/contracts";

import {
  DuplicatePrinterStateError,
  PrinterStateParentNotFoundError,
  PrinterStateParentOwnershipError,
  type PrinterStateRepository,
} from "./printer-state-repository.js";

interface PrinterStateSqliteStatement {
  run(...values: string[]): { readonly changes: number | bigint };
  get(...values: string[]): unknown;
  all(...values: string[]): unknown[];
}

interface PrinterStateSqliteConnection {
  exec(sql: string): void;
  prepare(sql: string): PrinterStateSqliteStatement;
}

export class PrinterStateDataIntegrityError extends Error {
  override readonly name = "PrinterStateDataIntegrityError";

  constructor(
    readonly field: string,
    reason: string
  ) {
    super(`Invalid persisted PrinterState field "${field}": ${reason}`);
  }
}

function readString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new PrinterStateDataIntegrityError(field, "expected a string");
  }
  return value;
}

function validateId(value: string, field: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new PrinterStateDataIntegrityError(field, "expected a non-empty, trimmed ID");
  }
  return value;
}

function validateTimestamp(value: string): string {
  const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
  const milliseconds = Date.parse(value);
  const normalized = value.includes(".")
    ? value.replace(/\.(\d{1,3})Z$/, (_, fraction: string) => `.${fraction.padEnd(3, "0")}Z`)
    : value.replace("Z", ".000Z");
  if (
    !pattern.test(value) ||
    Number.isNaN(milliseconds) ||
    new Date(milliseconds).toISOString() !== normalized
  ) {
    throw new PrinterStateDataIntegrityError(
      "created_at",
      "expected a valid ISO-8601 UTC timestamp"
    );
  }
  return value;
}

export function parsePrinterStateRow(value: unknown): PrinterState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PrinterStateDataIntegrityError("row", "expected a SQLite row object");
  }
  const row = value as Record<string, unknown>;
  const parentValue = row.parent_printer_state_id;
  if (parentValue !== undefined && parentValue !== null && typeof parentValue !== "string") {
    throw new PrinterStateDataIntegrityError(
      "parent_printer_state_id",
      "expected a string or null"
    );
  }
  const id = validateId(readString(row, "id"), "id");
  const printerId = validateId(readString(row, "printer_id"), "printer_id");
  const parentPrinterStateId =
    typeof parentValue === "string"
      ? validateId(parentValue, "parent_printer_state_id")
      : undefined;
  if (parentPrinterStateId !== undefined) {
    if (row.lineage_printer_id !== printerId || row.parent_printer_id !== printerId) {
      throw new PrinterStateDataIntegrityError(
        "parent_printer_state_id",
        "parent lineage must belong to the same Printer"
      );
    }
  } else if (
    (row.lineage_printer_id !== undefined && row.lineage_printer_id !== null) ||
    (row.parent_printer_id !== undefined && row.parent_printer_id !== null)
  ) {
    throw new PrinterStateDataIntegrityError("parent_printer_state_id", "malformed lineage row");
  }
  if (parentPrinterStateId === id) {
    throw new PrinterStateDataIntegrityError(
      "parent_printer_state_id",
      "a State cannot be its own parent"
    );
  }
  return {
    id,
    printerId,
    ...(parentPrinterStateId === undefined ? {} : { parentPrinterStateId }),
    createdAt: validateTimestamp(readString(row, "created_at")),
  };
}

export class SqlitePrinterStateRepository implements PrinterStateRepository {
  readonly #database: PrinterStateSqliteConnection;
  readonly #create: PrinterStateSqliteStatement;
  readonly #find: PrinterStateSqliteStatement;
  readonly #list: PrinterStateSqliteStatement;
  readonly #findOwner: PrinterStateSqliteStatement;
  readonly #createLineage: PrinterStateSqliteStatement;

  constructor(database: PrinterStateSqliteConnection) {
    this.#database = database;
    this.#create = database.prepare(`
      INSERT INTO printer_states (id, printer_id, created_at) VALUES (?, ?, ?)
    `);
    this.#find = database.prepare(`
      SELECT ps.id, ps.printer_id, ps.created_at,
             psl.printer_id AS lineage_printer_id, psl.parent_printer_state_id,
             parent.printer_id AS parent_printer_id
      FROM printer_states ps
      LEFT JOIN printer_state_lineage psl ON psl.child_printer_state_id = ps.id
      LEFT JOIN printer_states parent ON parent.id = psl.parent_printer_state_id
      WHERE ps.id = ?
    `);
    this.#list = database.prepare(`
      SELECT ps.id, ps.printer_id, ps.created_at,
             psl.printer_id AS lineage_printer_id, psl.parent_printer_state_id,
             parent.printer_id AS parent_printer_id
      FROM printer_states ps
      LEFT JOIN printer_state_lineage psl ON psl.child_printer_state_id = ps.id
      LEFT JOIN printer_states parent ON parent.id = psl.parent_printer_state_id
      WHERE ps.printer_id = ? ORDER BY ps.created_at, ps.id
    `);
    this.#findOwner = database.prepare(`SELECT printer_id FROM printer_states WHERE id = ?`);
    this.#createLineage = database.prepare(`
      INSERT INTO printer_state_lineage (
        printer_id, child_printer_state_id, parent_printer_state_id
      ) VALUES (?, ?, ?)
    `);
  }

  async create(state: PrinterState): Promise<void> {
    if (state.parentPrinterStateId !== undefined) {
      const parent = this.#findOwner.get(state.parentPrinterStateId);
      if (parent === undefined) {
        throw new PrinterStateParentNotFoundError(state.parentPrinterStateId);
      }
      if (
        typeof parent !== "object" ||
        parent === null ||
        Array.isArray(parent) ||
        typeof (parent as Record<string, unknown>).printer_id !== "string"
      ) {
        throw new PrinterStateDataIntegrityError("parent", "invalid persisted parent owner");
      }
      if ((parent as { printer_id: string }).printer_id !== state.printerId) {
        throw new PrinterStateParentOwnershipError(state.id, state.parentPrinterStateId);
      }
    }

    const usesSavepoint = state.parentPrinterStateId !== undefined;
    if (usesSavepoint) this.#database.exec("SAVEPOINT create_printer_state");
    try {
      this.#create.run(state.id, state.printerId, state.createdAt);
      if (state.parentPrinterStateId !== undefined) {
        this.#createLineage.run(state.printerId, state.id, state.parentPrinterStateId);
      }
      if (usesSavepoint) this.#database.exec("RELEASE SAVEPOINT create_printer_state");
    } catch (error) {
      if (usesSavepoint) {
        this.#database.exec("ROLLBACK TO SAVEPOINT create_printer_state");
        this.#database.exec("RELEASE SAVEPOINT create_printer_state");
      }
      if (this.#find.get(state.id) !== undefined) {
        throw new DuplicatePrinterStateError(state.id);
      }
      throw error;
    }
  }

  async findById(id: string): Promise<PrinterState | undefined> {
    const row = this.#find.get(id);
    return row === undefined ? undefined : parsePrinterStateRow(row);
  }

  async listByPrinterId(printerId: string): Promise<PrinterState[]> {
    return this.#list.all(printerId).map(parsePrinterStateRow);
  }
}
