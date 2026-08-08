import type { Printer } from "@printtune/contracts";

import type { PrinterRepository } from "./printer-repository.js";

interface PrinterSqliteStatement {
  run(...values: string[]): { readonly changes: number | bigint };
  get(...values: string[]): unknown;
  all(...values: string[]): unknown[];
}

interface PrinterSqliteConnection {
  prepare(sql: string): PrinterSqliteStatement;
}

export class PrinterDataIntegrityError extends Error {
  override readonly name = "PrinterDataIntegrityError";

  constructor(
    readonly field: string,
    reason: string
  ) {
    super(`Invalid persisted Printer field "${field}": ${reason}`);
  }
}

function readString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new PrinterDataIntegrityError(field, "expected a string");
  }
  return value;
}

function validateId(value: string, field: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new PrinterDataIntegrityError(field, "expected a non-empty, trimmed ID");
  }
  return value;
}

function validateName(value: string): string {
  if (value.trim().length === 0 || value.trim() !== value) {
    throw new PrinterDataIntegrityError("name", "expected a non-empty, trimmed name");
  }
  return value;
}

function validateTimestamp(value: string, field: string): string {
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
    throw new PrinterDataIntegrityError(field, "expected a valid ISO-8601 UTC timestamp");
  }
  return value;
}

export function parsePrinterRow(value: unknown): Printer {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PrinterDataIntegrityError("row", "expected a SQLite row object");
  }
  const row = value as Record<string, unknown>;
  return {
    id: validateId(readString(row, "id"), "id"),
    workspaceId: validateId(readString(row, "workspace_id"), "workspace_id"),
    name: validateName(readString(row, "name")),
    createdAt: validateTimestamp(readString(row, "created_at"), "created_at"),
    updatedAt: validateTimestamp(readString(row, "updated_at"), "updated_at"),
  };
}

export class SqlitePrinterRepository implements PrinterRepository {
  readonly #save: PrinterSqliteStatement;
  readonly #find: PrinterSqliteStatement;
  readonly #list: PrinterSqliteStatement;
  readonly #delete: PrinterSqliteStatement;

  constructor(database: PrinterSqliteConnection) {
    this.#save = database.prepare(`
      INSERT INTO printers (id, workspace_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        name = excluded.name,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `);
    this.#find = database.prepare(`
      SELECT id, workspace_id, name, created_at, updated_at FROM printers WHERE id = ?
    `);
    this.#list = database.prepare(`
      SELECT id, workspace_id, name, created_at, updated_at
      FROM printers WHERE workspace_id = ? ORDER BY created_at, id
    `);
    this.#delete = database.prepare("DELETE FROM printers WHERE id = ?");
  }

  async save(printer: Printer): Promise<void> {
    this.#save.run(
      printer.id,
      printer.workspaceId,
      printer.name,
      printer.createdAt,
      printer.updatedAt
    );
  }

  async findById(id: string): Promise<Printer | undefined> {
    const row = this.#find.get(id);
    return row === undefined ? undefined : parsePrinterRow(row);
  }

  async listByWorkspaceId(workspaceId: string): Promise<Printer[]> {
    return this.#list.all(workspaceId).map(parsePrinterRow);
  }

  async delete(id: string): Promise<boolean> {
    return this.#delete.run(id).changes > 0;
  }
}
