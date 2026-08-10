import type { PackageKnowledgeTrust } from "./installed-knowledge-package.js";

export interface PackageApplication {
  readonly id: string;
  readonly printerId: string;
  readonly printerStateId: string;
  readonly printerKnowledgeIdentityId: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly seriesDefinitionId: string;
  readonly modelDefinitionId?: string;
  readonly coreContractVersion: string;
  readonly packageTrust: PackageKnowledgeTrust;
  readonly appliedAt: string;
}

export interface PackageApplicationKey {
  readonly printerStateId: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly seriesDefinitionId: string;
  readonly modelDefinitionId?: string;
  readonly coreContractVersion: string;
}
