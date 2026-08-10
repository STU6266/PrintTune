import type { FieldClaim, PackageApplication } from "@printtune/contracts";
import { getPackageApplicationKey } from "@printtune/core";

import { DuplicateFieldClaimError } from "./field-claim-repository.js";
import {
  PackageApplicationMetadataConflictError,
  type PackageApplicationApplyOnceResult,
  type PackageApplicationLifecyclePersistence,
  validatePackageApplicationBatch,
} from "./package-application-lifecycle-persistence.js";
import {
  insertFieldClaim,
  prepareFieldClaimInsert,
  type FieldClaimSqliteConnection,
} from "./sqlite-field-claim-repository.js";
import { SqlitePackageApplicationRepository } from "./sqlite-package-application-repository.js";

type Connection = FieldClaimSqliteConnection;

function isSemanticUniquenessError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      "UNIQUE constraint failed: package_applications.printer_state_id, package_applications.package_id"
    )
  );
}

export class SqlitePackageApplicationLifecyclePersistence implements PackageApplicationLifecyclePersistence {
  readonly #database: Connection;

  constructor(database: Connection) {
    this.#database = database;
  }

  async applyOnce(
    application: PackageApplication,
    claims: readonly FieldClaim[]
  ): Promise<PackageApplicationApplyOnceResult> {
    validatePackageApplicationBatch(application, claims);
    const repository = new SqlitePackageApplicationRepository(this.#database);
    const insertApplication = this.#database.prepare(`
      INSERT INTO package_applications (
        id, printer_id, printer_state_id, printer_knowledge_identity_id,
        package_id, package_version, series_definition_id, model_definition_id,
        core_contract_version, package_trust, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertClaim = prepareFieldClaimInsert(this.#database);
    const insertLink = this.#database.prepare(`
      INSERT INTO package_application_claims (application_id, claim_id, claim_order)
      VALUES (?, ?, ?)
    `);
    const findClaim = this.#database.prepare("SELECT id FROM field_claims WHERE id = ?");

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existing = await repository.findBySemanticKey(getPackageApplicationKey(application));
      if (existing) {
        if (existing.packageTrust !== application.packageTrust) {
          throw new PackageApplicationMetadataConflictError(existing.id);
        }
        this.#database.exec("COMMIT");
        return { status: "already_applied", application: existing };
      }
      for (const claim of claims) {
        if (findClaim.get(claim.id) !== undefined) throw new DuplicateFieldClaimError(claim.id);
      }
      insertApplication.run(
        application.id,
        application.printerId,
        application.printerStateId,
        application.printerKnowledgeIdentityId,
        application.packageId,
        application.packageVersion,
        application.seriesDefinitionId,
        application.modelDefinitionId ?? null,
        application.coreContractVersion,
        application.packageTrust,
        application.appliedAt
      );
      for (const [index, claim] of claims.entries()) {
        insertFieldClaim(insertClaim, claim);
        insertLink.run(application.id, claim.id, index);
      }
      this.#database.exec("COMMIT");
      return { status: "applied", application };
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
      if (isSemanticUniquenessError(error)) {
        const existing = await repository.findBySemanticKey(getPackageApplicationKey(application));
        if (existing) {
          if (existing.packageTrust !== application.packageTrust) {
            throw new PackageApplicationMetadataConflictError(existing.id);
          }
          return { status: "already_applied", application: existing };
        }
      }
      throw error;
    }
  }
}
