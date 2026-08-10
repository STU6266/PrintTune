import type { PackageApplication, PackageApplicationKey } from "@printtune/contracts";

export interface PackageApplicationRepository {
  findById(id: string): Promise<PackageApplication | undefined>;
  findBySemanticKey(key: PackageApplicationKey): Promise<PackageApplication | undefined>;
  listForPrinterState(printerStateId: string): Promise<readonly PackageApplication[]>;
}

export interface PackageApplicationClaimRepository {
  listClaimIds(applicationId: string): Promise<readonly string[]>;
}
