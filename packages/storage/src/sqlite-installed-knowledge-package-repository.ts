import type { InstalledKnowledgePackage } from "@printtune/contracts";
import {
  createInstalledKnowledgePackage,
  validateInstalledKnowledgePackageIdentity,
} from "@printtune/core";

import {
  compareInstalledKnowledgePackageAcceptance,
  type InstalledKnowledgePackageAcceptanceResult,
  type InstalledKnowledgePackageRepository,
} from "./installed-knowledge-package-repository.js";

type SqliteValue = string | number;

interface InstalledPackageStatement {
  run(...values: SqliteValue[]): { readonly changes: number | bigint };
  get(...values: string[]): unknown;
  all(): unknown[];
}

interface InstalledPackageConnection {
  readonly isTransaction: boolean;
  exec(sql: string): void;
  prepare(sql: string): InstalledPackageStatement;
}

export class InstalledKnowledgePackageDataIntegrityError extends Error {
  override readonly name = "InstalledKnowledgePackageDataIntegrityError";

  constructor(
    readonly field: string,
    reason: string
  ) {
    super(`Invalid persisted installed Knowledge Package field "${field}": ${reason}`);
  }
}

const SELECT_COLUMNS = `
  package_id, package_version, format_version, package_type, raw_text, content_sha256,
  installation_source, trust, installed_at
`;

function asRow(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InstalledKnowledgePackageDataIntegrityError("row", "expected a SQLite row object");
  }
  return value as Record<string, unknown>;
}

function readString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new InstalledKnowledgePackageDataIntegrityError(field, "expected a string");
  }
  return value;
}

function readNumber(row: Record<string, unknown>, field: string): number {
  const value = row[field];
  if (typeof value !== "number") {
    throw new InstalledKnowledgePackageDataIntegrityError(field, "expected a number");
  }
  return value;
}

export function parseInstalledKnowledgePackageRow(value: unknown): InstalledKnowledgePackage {
  const row = asRow(value);
  try {
    return createInstalledKnowledgePackage({
      packageId: readString(row, "package_id"),
      packageVersion: readString(row, "package_version"),
      formatVersion: readNumber(row, "format_version") as 1,
      packageType: readString(row, "package_type") as "printer_series",
      rawText: readString(row, "raw_text"),
      contentSha256: readString(row, "content_sha256"),
      installationSource: readString(
        row,
        "installation_source"
      ) as InstalledKnowledgePackage["installationSource"],
      trust: readString(row, "trust") as InstalledKnowledgePackage["trust"],
      installedAt: readString(row, "installed_at"),
    });
  } catch (error) {
    if (error instanceof InstalledKnowledgePackageDataIntegrityError) throw error;
    throw new InstalledKnowledgePackageDataIntegrityError(
      "row",
      error instanceof Error ? error.message : "failed domain validation"
    );
  }
}

export class SqliteInstalledKnowledgePackageRepository implements InstalledKnowledgePackageRepository {
  readonly #database: InstalledPackageConnection;
  readonly #insert: InstalledPackageStatement;
  readonly #find: InstalledPackageStatement;
  readonly #list: InstalledPackageStatement;

  constructor(database: InstalledPackageConnection) {
    this.#database = database;
    this.#insert = database.prepare(`
      INSERT INTO installed_knowledge_packages (
        package_id, package_version, format_version, package_type, raw_text, content_sha256,
        installation_source, trust, installed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#find = database.prepare(`
      SELECT ${SELECT_COLUMNS} FROM installed_knowledge_packages
      WHERE package_id = ? AND package_version = ?
    `);
    this.#list = database.prepare(`
      SELECT ${SELECT_COLUMNS} FROM installed_knowledge_packages
      ORDER BY package_id, package_version
    `);
  }

  async accept(
    installedPackage: InstalledKnowledgePackage
  ): Promise<InstalledKnowledgePackageAcceptanceResult> {
    const incoming = createInstalledKnowledgePackage(installedPackage);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#find.get(incoming.packageId, incoming.packageVersion);
      if (row !== undefined) {
        const result = compareInstalledKnowledgePackageAcceptance(
          parseInstalledKnowledgePackageRow(row),
          incoming
        );
        this.#database.exec("COMMIT");
        return result;
      }
      this.#insert.run(
        incoming.packageId,
        incoming.packageVersion,
        incoming.formatVersion,
        incoming.packageType,
        incoming.rawText,
        incoming.contentSha256,
        incoming.installationSource,
        incoming.trust,
        incoming.installedAt
      );
      this.#database.exec("COMMIT");
      return "installed";
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  async findExact(
    packageId: string,
    packageVersion: string
  ): Promise<InstalledKnowledgePackage | undefined> {
    const identity = validateInstalledKnowledgePackageIdentity(packageId, packageVersion);
    const row = this.#find.get(identity.packageId, identity.packageVersion);
    return row === undefined ? undefined : parseInstalledKnowledgePackageRow(row);
  }

  async list(): Promise<readonly InstalledKnowledgePackage[]> {
    return Object.freeze(this.#list.all().map(parseInstalledKnowledgePackageRow));
  }
}
