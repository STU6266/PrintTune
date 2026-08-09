import type { PrinterKnowledgeIdentity } from "@printtune/contracts";
import { createPrinterKnowledgeIdentity } from "@printtune/core";

import {
  DuplicatePrinterKnowledgeIdentityError,
  type PrinterKnowledgeIdentityRepository,
} from "./printer-knowledge-identity-repository.js";

type SqliteValue = string | null;

interface IdentityStatement {
  run(...values: SqliteValue[]): { readonly changes: number | bigint };
  get(...values: string[]): unknown;
  all(...values: string[]): unknown[];
}

interface IdentityConnection {
  prepare(sql: string): IdentityStatement;
}

export class PrinterKnowledgeIdentityDataIntegrityError extends Error {
  override readonly name = "PrinterKnowledgeIdentityDataIntegrityError";
  constructor(
    readonly field: string,
    reason: string
  ) {
    super(`Invalid persisted PrinterKnowledgeIdentity field "${field}": ${reason}`);
  }
}

const SELECT_COLUMNS = `
  id, printer_id, kind, selected_at,
  definition_package_id, definition_package_version, series_definition_id,
  model_definition_id, manufacturer_display_name, series_display_name, model_display_name
`;

function asRow(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PrinterKnowledgeIdentityDataIntegrityError("row", "expected a SQLite row object");
  }
  return value as Record<string, unknown>;
}

function readString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new PrinterKnowledgeIdentityDataIntegrityError(field, "expected a string");
  }
  return value;
}

function readNullableString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value !== null && typeof value !== "string") {
    throw new PrinterKnowledgeIdentityDataIntegrityError(field, "expected a string or NULL");
  }
  return value;
}

function requireNull(row: Record<string, unknown>, fields: readonly string[]): void {
  for (const field of fields) {
    if (readNullableString(row, field) !== null) {
      throw new PrinterKnowledgeIdentityDataIntegrityError(
        field,
        "expected NULL for unclassified identity"
      );
    }
  }
}

export function parsePrinterKnowledgeIdentityRow(value: unknown): PrinterKnowledgeIdentity {
  const row = asRow(value);
  const kind = readString(row, "kind");
  const base = {
    id: readString(row, "id"),
    printerId: readString(row, "printer_id"),
    selectedAt: readString(row, "selected_at"),
  };
  try {
    if (kind === "unclassified") {
      requireNull(row, [
        "definition_package_id",
        "definition_package_version",
        "series_definition_id",
        "model_definition_id",
        "manufacturer_display_name",
        "series_display_name",
        "model_display_name",
      ]);
      return createPrinterKnowledgeIdentity({ ...base, kind });
    }
    if (kind !== "known") {
      throw new PrinterKnowledgeIdentityDataIntegrityError("kind", "unsupported kind");
    }
    const modelDefinitionId = readNullableString(row, "model_definition_id");
    const modelDisplayName = readNullableString(row, "model_display_name");
    if ((modelDefinitionId === null) !== (modelDisplayName === null)) {
      throw new PrinterKnowledgeIdentityDataIntegrityError(
        "model",
        "expected model ID and display name together"
      );
    }
    return createPrinterKnowledgeIdentity({
      ...base,
      kind,
      definitionRef: {
        packageId: readString(row, "definition_package_id"),
        packageVersion: readString(row, "definition_package_version"),
        seriesDefinitionId: readString(row, "series_definition_id"),
        ...(modelDefinitionId === null ? {} : { modelDefinitionId }),
      },
      manufacturerDisplayName: readString(row, "manufacturer_display_name"),
      seriesDisplayName: readString(row, "series_display_name"),
      ...(modelDisplayName === null ? {} : { modelDisplayName }),
    });
  } catch (error) {
    if (error instanceof PrinterKnowledgeIdentityDataIntegrityError) throw error;
    throw new PrinterKnowledgeIdentityDataIntegrityError(
      "row",
      error instanceof Error ? error.message : "failed domain validation"
    );
  }
}

export class SqlitePrinterKnowledgeIdentityRepository implements PrinterKnowledgeIdentityRepository {
  readonly #create: IdentityStatement;
  readonly #find: IdentityStatement;
  readonly #list: IdentityStatement;

  constructor(database: IdentityConnection) {
    this.#create = database.prepare(`
      INSERT INTO printer_knowledge_identities (
        id, printer_id, kind, selected_at,
        definition_package_id, definition_package_version, series_definition_id,
        model_definition_id, manufacturer_display_name, series_display_name, model_display_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#find = database.prepare(`
      SELECT ${SELECT_COLUMNS} FROM printer_knowledge_identities WHERE id = ?
    `);
    this.#list = database.prepare(`
      SELECT ${SELECT_COLUMNS} FROM printer_knowledge_identities
      WHERE printer_id = ? ORDER BY selected_at, id
    `);
  }

  async create(identity: PrinterKnowledgeIdentity): Promise<void> {
    const known = identity.kind === "known" ? identity : undefined;
    try {
      this.#create.run(
        identity.id,
        identity.printerId,
        identity.kind,
        identity.selectedAt,
        known?.definitionRef.packageId ?? null,
        known?.definitionRef.packageVersion ?? null,
        known?.definitionRef.seriesDefinitionId ?? null,
        known?.definitionRef.modelDefinitionId ?? null,
        known?.manufacturerDisplayName ?? null,
        known?.seriesDisplayName ?? null,
        known?.modelDisplayName ?? null
      );
    } catch (error) {
      if (this.#find.get(identity.id) !== undefined) {
        throw new DuplicatePrinterKnowledgeIdentityError(identity.id);
      }
      throw error;
    }
  }

  async findById(id: string): Promise<PrinterKnowledgeIdentity | undefined> {
    const row = this.#find.get(id);
    return row === undefined ? undefined : parsePrinterKnowledgeIdentityRow(row);
  }

  async listByPrinterId(printerId: string): Promise<PrinterKnowledgeIdentity[]> {
    return this.#list.all(printerId).map(parsePrinterKnowledgeIdentityRow);
  }
}
