import type {
  InstalledKnowledgePackage,
  KnowledgePackageInstallationSource,
  PackageKnowledgeTrust,
} from "@printtune/contracts";

import { isStrictIsoUtcTimestamp } from "./timestamp-validation.js";

export type InstalledKnowledgePackageField = keyof InstalledKnowledgePackage | "record";

export class InvalidInstalledKnowledgePackageError extends Error {
  override readonly name = "InvalidInstalledKnowledgePackageError";

  constructor(
    readonly field: InstalledKnowledgePackageField,
    reason: string
  ) {
    super(`Invalid installed Knowledge Package field "${field}": ${reason}`);
  }
}

export class InvalidKnowledgePackageSourceTrustPairError extends Error {
  override readonly name = "InvalidKnowledgePackageSourceTrustPairError";

  constructor(
    readonly installationSource: unknown,
    readonly trust: unknown
  ) {
    super("Installed Knowledge Package source and trust are not an approved Alpha pair");
  }
}

const EXACT_FIELDS = [
  "packageId",
  "packageVersion",
  "formatVersion",
  "packageType",
  "rawText",
  "contentSha256",
  "installationSource",
  "trust",
  "installedAt",
] as const satisfies readonly (keyof InstalledKnowledgePackage)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNormalizedIdentity(value: unknown, field: "packageId" | "packageVersion"): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new InvalidInstalledKnowledgePackageError(field, "expected a non-empty trimmed string");
  }
  return value;
}

export function validateInstalledKnowledgePackageIdentity(
  packageId: unknown,
  packageVersion: unknown
): Readonly<{ packageId: string; packageVersion: string }> {
  return Object.freeze({
    packageId: readNormalizedIdentity(packageId, "packageId"),
    packageVersion: readNormalizedIdentity(packageVersion, "packageVersion"),
  });
}

function validateSourceTrustPair(
  source: unknown,
  trust: unknown
): {
  installationSource: KnowledgePackageInstallationSource;
  trust: PackageKnowledgeTrust;
} {
  if (source === "bundled_official" && trust === "developer_verified") {
    return { installationSource: source, trust };
  }
  if (source === "customer_verified_installation" && trust === "customer_verified") {
    return { installationSource: source, trust };
  }
  throw new InvalidKnowledgePackageSourceTrustPairError(source, trust);
}

export function createInstalledKnowledgePackage(
  input: InstalledKnowledgePackage
): InstalledKnowledgePackage {
  if (
    !isRecord(input) ||
    Object.keys(input).length !== EXACT_FIELDS.length ||
    !EXACT_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(input, field))
  ) {
    throw new InvalidInstalledKnowledgePackageError("record", "expected the exact approved shape");
  }
  const identity = validateInstalledKnowledgePackageIdentity(input.packageId, input.packageVersion);
  if (input.formatVersion !== 1) {
    throw new InvalidInstalledKnowledgePackageError("formatVersion", "expected numeric format 1");
  }
  if (input.packageType !== "printer_series") {
    throw new InvalidInstalledKnowledgePackageError("packageType", "expected printer_series");
  }
  if (typeof input.rawText !== "string" || input.rawText.length === 0) {
    throw new InvalidInstalledKnowledgePackageError("rawText", "expected a non-empty string");
  }
  if (typeof input.contentSha256 !== "string" || !/^[0-9a-f]{64}$/.test(input.contentSha256)) {
    throw new InvalidInstalledKnowledgePackageError(
      "contentSha256",
      "expected exactly 64 lowercase hexadecimal characters"
    );
  }
  if (!isStrictIsoUtcTimestamp(input.installedAt)) {
    throw new InvalidInstalledKnowledgePackageError(
      "installedAt",
      "expected a strict ISO-8601 UTC timestamp"
    );
  }
  const sourceTrust = validateSourceTrustPair(input.installationSource, input.trust);

  return Object.freeze({
    ...identity,
    formatVersion: 1,
    packageType: "printer_series",
    rawText: input.rawText,
    contentSha256: input.contentSha256,
    ...sourceTrust,
    installedAt: input.installedAt,
  });
}
