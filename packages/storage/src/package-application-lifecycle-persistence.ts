import type { FieldClaim, PackageApplication } from "@printtune/contracts";
import { createFieldClaim, createPackageApplication } from "@printtune/core";

export type PackageApplicationApplyOnceResult =
  | { readonly status: "applied"; readonly application: PackageApplication }
  | { readonly status: "already_applied"; readonly application: PackageApplication };

export interface PackageApplicationLifecyclePersistence {
  applyOnce(
    application: PackageApplication,
    claims: readonly FieldClaim[]
  ): Promise<PackageApplicationApplyOnceResult>;
}

export class InvalidPackageApplicationBatchError extends Error {
  override readonly name = "InvalidPackageApplicationBatchError";
  constructor(
    readonly claimId: string,
    reason: string
  ) {
    super(`Invalid PackageApplication Claim batch at "${claimId}": ${reason}`);
  }
}

export class PackageApplicationMetadataConflictError extends Error {
  override readonly name = "PackageApplicationMetadataConflictError";
  constructor(readonly applicationId: string) {
    super(`PackageApplication ${applicationId} conflicts with existing immutable package trust`);
  }
}

export function validatePackageApplicationBatch(
  application: PackageApplication,
  claims: readonly FieldClaim[]
): void {
  createPackageApplication({
    id: application.id,
    printerId: application.printerId,
    printerStateId: application.printerStateId,
    printerKnowledgeIdentityId: application.printerKnowledgeIdentityId,
    packageId: application.packageId,
    packageVersion: application.packageVersion,
    seriesDefinitionId: application.seriesDefinitionId,
    ...(application.modelDefinitionId === undefined
      ? {}
      : { modelDefinitionId: application.modelDefinitionId }),
    coreContractVersion: application.coreContractVersion,
    packageTrust: application.packageTrust,
    timestamp: application.appliedAt,
  });
  const ids = new Set<string>();
  for (const claim of claims) {
    createFieldClaim({ ...claim, timestamp: claim.createdAt });
    if (ids.has(claim.id)) {
      throw new InvalidPackageApplicationBatchError(claim.id, "duplicate Claim ID");
    }
    ids.add(claim.id);
    if (
      claim.target.type !== "printer_state" ||
      claim.target.printerStateId !== application.printerStateId
    ) {
      throw new InvalidPackageApplicationBatchError(
        claim.id,
        "Claim must target the exact PrinterState"
      );
    }
    const reference = claim.provenance.sourceRef;
    if (
      claim.provenance.sourceType !== "knowledge_package" ||
      reference?.type !== "knowledge_package" ||
      reference.packageId !== application.packageId ||
      reference.packageVersion !== application.packageVersion ||
      reference.factId === undefined
    ) {
      throw new InvalidPackageApplicationBatchError(
        claim.id,
        "Claim package provenance does not match"
      );
    }
    if (claim.trust !== application.packageTrust) {
      throw new InvalidPackageApplicationBatchError(claim.id, "Claim trust does not match");
    }
    if (claim.createdAt !== application.appliedAt) {
      throw new InvalidPackageApplicationBatchError(claim.id, "Claim timestamp does not match");
    }
  }
}
