import type { PrinterState } from "@printtune/contracts";

import {
  DuplicatePrinterStateError,
  type PrinterStateRepository,
} from "./printer-state-repository.js";

interface PrinterStateSqliteStatement {
  run(...values: string[]): { readonly changes: number | bigint };
  get(...values: string[]): unknown;
  all(...values: string[]): unknown[];
}

interface PrinterStateSqliteConnection {
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
  return {
    id: validateId(readString(row, "id"), "id"),
    printerId: validateId(readString(row, "printer_id"), "printer_id"),
    createdAt: validateTimestamp(readString(row, "created_at")),
  };
}

export class SqlitePrinterStateRepository implements PrinterStateRepository {
  readonly #create: PrinterStateSqliteStatement;
  readonly #find: PrinterStateSqliteStatement;
  readonly #list: PrinterStateSqliteStatement;

  constructor(database: PrinterStateSqliteConnection) {
    this.#create = database.prepare(`
      INSERT INTO printer_states (id, printer_id, created_at) VALUES (?, ?, ?)
    `);
    this.#find = database.prepare(`
      SELECT id, printer_id, created_at FROM printer_states WHERE id = ?
    `);
    this.#list = database.prepare(`
      SELECT id, printer_id, created_at
      FROM printer_states WHERE printer_id = ? ORDER BY created_at, id
    `);
  }

  async create(state: PrinterState): Promise<void> {
    try {
      this.#create.run(state.id, state.printerId, state.createdAt);
    } catch (error) {
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
