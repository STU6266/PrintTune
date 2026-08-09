import type { InstalledKnowledgePackage } from "@printtune/contracts";

export type InstalledKnowledgePackageAcceptanceResult = "installed" | "already_installed";

export interface InstalledKnowledgePackageRepository {
  accept(
    installedPackage: InstalledKnowledgePackage
  ): Promise<InstalledKnowledgePackageAcceptanceResult>;
  findExact(
    packageId: string,
    packageVersion: string
  ): Promise<InstalledKnowledgePackage | undefined>;
  list(): Promise<readonly InstalledKnowledgePackage[]>;
}

export class ImmutableKnowledgePackageCollisionError extends Error {
  override readonly name = "ImmutableKnowledgePackageCollisionError";

  constructor(
    readonly packageId: string,
    readonly packageVersion: string
  ) {
    super(`Installed Knowledge Package content collision: ${packageId}/${packageVersion}`);
  }
}

export class InstalledKnowledgePackageMetadataConflictError extends Error {
  override readonly name = "InstalledKnowledgePackageMetadataConflictError";

  constructor(
    readonly packageId: string,
    readonly packageVersion: string
  ) {
    super(`Installed Knowledge Package metadata conflict: ${packageId}/${packageVersion}`);
  }
}

export function compareInstalledKnowledgePackageAcceptance(
  existing: InstalledKnowledgePackage,
  incoming: InstalledKnowledgePackage
): InstalledKnowledgePackageAcceptanceResult {
  if (
    existing.rawText !== incoming.rawText ||
    existing.contentSha256 !== incoming.contentSha256 ||
    existing.formatVersion !== incoming.formatVersion ||
    existing.packageType !== incoming.packageType
  ) {
    throw new ImmutableKnowledgePackageCollisionError(existing.packageId, existing.packageVersion);
  }
  if (
    existing.installationSource !== incoming.installationSource ||
    existing.trust !== incoming.trust
  ) {
    throw new InstalledKnowledgePackageMetadataConflictError(
      existing.packageId,
      existing.packageVersion
    );
  }
  return "already_installed";
}
