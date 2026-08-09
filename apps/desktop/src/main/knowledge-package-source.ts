import type { PackageKnowledgeTrust } from "@printtune/contracts";

export interface ExactKnowledgePackageReference {
  readonly packageId: string;
  readonly packageVersion: string;
}

export interface AvailableKnowledgePackage {
  readonly text: string;
  readonly trust: PackageKnowledgeTrust;
}

export interface KnowledgePackageSource {
  getExactPackage(
    reference: ExactKnowledgePackageReference
  ): Promise<AvailableKnowledgePackage | undefined>;
}
