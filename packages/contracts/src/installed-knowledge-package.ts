import type { ClaimTrust } from "./field-claim.js";

export type PackageKnowledgeTrust = Extract<ClaimTrust, "developer_verified" | "customer_verified">;

export type KnowledgePackageInstallationSource =
  "bundled_official" | "customer_verified_installation";

export interface InstalledKnowledgePackage {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly formatVersion: 1;
  readonly packageType: "printer_series";
  readonly rawText: string;
  readonly contentSha256: string;
  readonly installationSource: KnowledgePackageInstallationSource;
  readonly trust: PackageKnowledgeTrust;
  readonly installedAt: string;
}
