import type {
  KnowledgePackageInstallationSource,
  PackageKnowledgeTrust,
} from "@printtune/contracts";
import { createInstalledKnowledgePackage } from "@printtune/core";
import {
  InvalidPrinterSeriesPackageCoreCompatibilityError,
  validatePrinterSeriesPackageCoreCompatibility,
} from "@printtune/knowledge-engine";
import { parseKnowledgePackageV1 } from "@printtune/package-engine";
import type {
  InstalledKnowledgePackageAcceptanceResult,
  InstalledKnowledgePackageRepository,
} from "@printtune/storage";

import { computeKnowledgePackageSha256 } from "./knowledge-package-sha256";

export interface InstallTrustedKnowledgePackageInput {
  readonly rawText: string;
  readonly installationSource: KnowledgePackageInstallationSource;
}

export interface KnowledgePackageInstallationResult {
  readonly status: InstalledKnowledgePackageAcceptanceResult;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly contentSha256: string;
}

export type KnowledgePackageInstallationErrorCode =
  | "invalid_installation_source"
  | "invalid_package"
  | "incompatible_package"
  | "invalid_installation_context";

export class KnowledgePackageInstallationError extends Error {
  override readonly name = "KnowledgePackageInstallationError";

  constructor(
    readonly code: KnowledgePackageInstallationErrorCode,
    options?: ErrorOptions
  ) {
    super(`Unable to install trusted Knowledge Package: ${code}`, options);
  }
}

interface KnowledgePackageInstallationServiceDependencies {
  readonly now?: () => string;
}

function trustForSource(source: unknown): PackageKnowledgeTrust {
  if (source === "bundled_official") return "developer_verified";
  if (source === "customer_verified_installation") return "customer_verified";
  throw new KnowledgePackageInstallationError("invalid_installation_source");
}

export class KnowledgePackageInstallationService {
  readonly #repository: InstalledKnowledgePackageRepository;
  readonly #now: () => string;

  constructor(
    repository: InstalledKnowledgePackageRepository,
    dependencies: KnowledgePackageInstallationServiceDependencies = {}
  ) {
    this.#repository = repository;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async installTrustedPackage(
    input: InstallTrustedKnowledgePackageInput
  ): Promise<KnowledgePackageInstallationResult> {
    let knowledgePackage;
    try {
      knowledgePackage = parseKnowledgePackageV1(input.rawText);
    } catch (cause) {
      throw new KnowledgePackageInstallationError("invalid_package", { cause });
    }

    try {
      validatePrinterSeriesPackageCoreCompatibility(knowledgePackage);
    } catch (cause) {
      if (cause instanceof InvalidPrinterSeriesPackageCoreCompatibilityError) {
        throw new KnowledgePackageInstallationError("incompatible_package", { cause });
      }
      throw cause;
    }

    const trust = trustForSource(input.installationSource);
    const contentSha256 = computeKnowledgePackageSha256(input.rawText);
    let installedPackage;
    try {
      installedPackage = createInstalledKnowledgePackage({
        packageId: knowledgePackage.packageId,
        packageVersion: knowledgePackage.packageVersion,
        formatVersion: knowledgePackage.formatVersion,
        packageType: knowledgePackage.packageType,
        rawText: input.rawText,
        contentSha256,
        installationSource: input.installationSource,
        trust,
        installedAt: this.#now(),
      });
    } catch (cause) {
      throw new KnowledgePackageInstallationError("invalid_installation_context", { cause });
    }

    const status = await this.#repository.accept(installedPackage);
    return Object.freeze({
      status,
      packageId: installedPackage.packageId,
      packageVersion: installedPackage.packageVersion,
      contentSha256: installedPackage.contentSha256,
    });
  }
}
