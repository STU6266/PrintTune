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

function compare(left: InstalledKnowledgePackage, right: InstalledKnowledgePackage): number {
  return (
    left.packageId.localeCompare(right.packageId) ||
    left.packageVersion.localeCompare(right.packageVersion)
  );
}

export class InMemoryInstalledKnowledgePackageRepository implements InstalledKnowledgePackageRepository {
  readonly #packages = new Map<string, Map<string, InstalledKnowledgePackage>>();

  async accept(
    installedPackage: InstalledKnowledgePackage
  ): Promise<InstalledKnowledgePackageAcceptanceResult> {
    const incoming = createInstalledKnowledgePackage(installedPackage);
    const versions = this.#packages.get(incoming.packageId);
    const existing = versions?.get(incoming.packageVersion);
    if (existing) return compareInstalledKnowledgePackageAcceptance(existing, incoming);

    if (versions) {
      versions.set(incoming.packageVersion, incoming);
    } else {
      this.#packages.set(incoming.packageId, new Map([[incoming.packageVersion, incoming]]));
    }
    return "installed";
  }

  async findExact(
    packageId: string,
    packageVersion: string
  ): Promise<InstalledKnowledgePackage | undefined> {
    const identity = validateInstalledKnowledgePackageIdentity(packageId, packageVersion);
    const value = this.#packages.get(identity.packageId)?.get(identity.packageVersion);
    return value ? createInstalledKnowledgePackage(value) : undefined;
  }

  async list(): Promise<readonly InstalledKnowledgePackage[]> {
    return Object.freeze(
      [...this.#packages.values()]
        .flatMap((versions) => [...versions.values()])
        .sort(compare)
        .map(createInstalledKnowledgePackage)
    );
  }
}
