import type {
  PackageApplication,
  PackageApplicationKey,
  PackageKnowledgeTrust,
} from "@printtune/contracts";
import { createPackageApplication, createPackageApplicationKey } from "@printtune/core";

import type {
  PackageApplicationClaimRepository,
  PackageApplicationRepository,
} from "./package-application-repository.js";

type Statement = {
  get(...values: string[]): unknown;
  all(...values: string[]): unknown[];
};
export type PackageApplicationSqliteConnection = {
  prepare(sql: string): Statement;
};

export class PackageApplicationDataIntegrityError extends Error {
  override readonly name = "PackageApplicationDataIntegrityError";
  constructor(
    readonly field: string,
    reason: string
  ) {
    super(`Invalid persisted PackageApplication field "${field}": ${reason}`);
  }
}

const COLUMNS = `
  id, printer_id, printer_state_id, printer_knowledge_identity_id,
  package_id, package_version, series_definition_id, model_definition_id,
  core_contract_version, package_trust, applied_at
`;

function row(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PackageApplicationDataIntegrityError("row", "expected a SQLite row object");
  }
  return value as Record<string, unknown>;
}
function text(value: Record<string, unknown>, field: string): string {
  if (typeof value[field] !== "string") {
    throw new PackageApplicationDataIntegrityError(field, "expected a string");
  }
  return value[field];
}

export function parsePackageApplicationRow(value: unknown): PackageApplication {
  const data = row(value);
  const model = data.model_definition_id;
  if (model !== null && typeof model !== "string") {
    throw new PackageApplicationDataIntegrityError(
      "model_definition_id",
      "expected string or NULL"
    );
  }
  try {
    return createPackageApplication({
      id: text(data, "id"),
      printerId: text(data, "printer_id"),
      printerStateId: text(data, "printer_state_id"),
      printerKnowledgeIdentityId: text(data, "printer_knowledge_identity_id"),
      packageId: text(data, "package_id"),
      packageVersion: text(data, "package_version"),
      seriesDefinitionId: text(data, "series_definition_id"),
      ...(model === null ? {} : { modelDefinitionId: model }),
      coreContractVersion: text(data, "core_contract_version"),
      packageTrust: text(data, "package_trust") as PackageKnowledgeTrust,
      timestamp: text(data, "applied_at"),
    });
  } catch (error) {
    if (error instanceof PackageApplicationDataIntegrityError) throw error;
    throw new PackageApplicationDataIntegrityError(
      "row",
      error instanceof Error ? error.message : "failed domain validation"
    );
  }
}

export class SqlitePackageApplicationRepository
  implements PackageApplicationRepository, PackageApplicationClaimRepository
{
  readonly #findById: Statement;
  readonly #findSeries: Statement;
  readonly #findModel: Statement;
  readonly #list: Statement;
  readonly #claims: Statement;

  constructor(database: PackageApplicationSqliteConnection) {
    this.#findById = database.prepare(`SELECT ${COLUMNS} FROM package_applications WHERE id = ?`);
    this.#findSeries = database.prepare(`
      SELECT ${COLUMNS} FROM package_applications
      WHERE printer_state_id = ? AND package_id = ? AND package_version = ?
        AND series_definition_id = ? AND model_definition_id IS NULL
        AND core_contract_version = ?
    `);
    this.#findModel = database.prepare(`
      SELECT ${COLUMNS} FROM package_applications
      WHERE printer_state_id = ? AND package_id = ? AND package_version = ?
        AND series_definition_id = ? AND model_definition_id = ?
        AND core_contract_version = ?
    `);
    this.#list = database.prepare(`
      SELECT ${COLUMNS} FROM package_applications
      WHERE printer_state_id = ? ORDER BY applied_at, id
    `);
    this.#claims = database.prepare(`
      SELECT claim_id FROM package_application_claims
      WHERE application_id = ? ORDER BY claim_order
    `);
  }

  async findById(id: string): Promise<PackageApplication | undefined> {
    const value = this.#findById.get(id);
    return value === undefined ? undefined : parsePackageApplicationRow(value);
  }

  async findBySemanticKey(input: PackageApplicationKey): Promise<PackageApplication | undefined> {
    const key = createPackageApplicationKey(input);
    const values = [key.printerStateId, key.packageId, key.packageVersion, key.seriesDefinitionId];
    const value = key.modelDefinitionId
      ? this.#findModel.get(...values, key.modelDefinitionId, key.coreContractVersion)
      : this.#findSeries.get(...values, key.coreContractVersion);
    return value === undefined ? undefined : parsePackageApplicationRow(value);
  }

  async listForPrinterState(printerStateId: string): Promise<readonly PackageApplication[]> {
    return this.#list.all(printerStateId).map(parsePackageApplicationRow);
  }

  async listClaimIds(applicationId: string): Promise<readonly string[]> {
    return this.#claims.all(applicationId).map((value) => {
      const data = row(value);
      return text(data, "claim_id");
    });
  }
}
