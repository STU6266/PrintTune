import { createInstalledKnowledgePackage } from "@printtune/core";
import type { InstalledKnowledgePackageRepository } from "@printtune/storage";

import { computeKnowledgePackageSha256 } from "./knowledge-package-sha256";
import type {
  AvailableKnowledgePackage,
  ExactKnowledgePackageReference,
  KnowledgePackageSource,
} from "./knowledge-package-source";

export class InstalledKnowledgePackageIntegrityError extends Error {
  override readonly name = "InstalledKnowledgePackageIntegrityError";

  constructor(
    readonly reference: ExactKnowledgePackageReference,
    readonly reason: "invalid_record" | "digest_mismatch",
    options?: ErrorOptions
  ) {
    super(
      `Installed Knowledge Package integrity failure for ${reference.packageId}/${reference.packageVersion}: ${reason}`,
      options
    );
  }
}

export class InstalledKnowledgePackageSource implements KnowledgePackageSource {
  readonly #repository: InstalledKnowledgePackageRepository;

  constructor(repository: InstalledKnowledgePackageRepository) {
    this.#repository = repository;
  }

  async getExactPackage(
    reference: ExactKnowledgePackageReference
  ): Promise<AvailableKnowledgePackage | undefined> {
    const record = await this.#repository.findExact(reference.packageId, reference.packageVersion);
    if (!record) return undefined;

    let validatedRecord;
    try {
      validatedRecord = createInstalledKnowledgePackage(record);
    } catch (cause) {
      throw new InstalledKnowledgePackageIntegrityError(reference, "invalid_record", { cause });
    }
    if (
      validatedRecord.packageId !== reference.packageId ||
      validatedRecord.packageVersion !== reference.packageVersion
    ) {
      throw new InstalledKnowledgePackageIntegrityError(reference, "invalid_record");
    }
    if (computeKnowledgePackageSha256(validatedRecord.rawText) !== validatedRecord.contentSha256) {
      throw new InstalledKnowledgePackageIntegrityError(reference, "digest_mismatch");
    }

    return Object.freeze({ text: validatedRecord.rawText, trust: validatedRecord.trust });
  }
}
