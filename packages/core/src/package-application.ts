import type {
  PackageApplication,
  PackageApplicationKey,
  PackageKnowledgeTrust,
} from "@printtune/contracts";

import { isStrictIsoUtcTimestamp } from "./timestamp-validation.js";

export type CreatePackageApplicationInput = Omit<PackageApplication, "appliedAt"> & {
  readonly timestamp: string;
};

export class InvalidPackageApplicationError extends Error {
  override readonly name = "InvalidPackageApplicationError";
  constructor(
    readonly field: string,
    reason: string
  ) {
    super(`Invalid PackageApplication field "${field}": ${reason}`);
  }
}

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function value(field: string, candidate: unknown): string {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.trim() !== candidate) {
    throw new InvalidPackageApplicationError(field, "expected a non-empty trimmed string");
  }
  return candidate;
}

function model(candidate: unknown): string | undefined {
  return candidate === undefined ? undefined : value("modelDefinitionId", candidate);
}

function contractVersion(candidate: unknown): string {
  const version = value("coreContractVersion", candidate);
  if (!SEMVER.test(version)) {
    throw new InvalidPackageApplicationError("coreContractVersion", "expected SemVer 2.0.0");
  }
  return version;
}

function trust(candidate: unknown): PackageKnowledgeTrust {
  if (candidate !== "developer_verified" && candidate !== "customer_verified") {
    throw new InvalidPackageApplicationError("packageTrust", "unsupported package trust");
  }
  return candidate;
}

function validateShape(input: CreatePackageApplicationInput): void {
  const expected = [
    "id",
    "printerId",
    "printerStateId",
    "printerKnowledgeIdentityId",
    "packageId",
    "packageVersion",
    "seriesDefinitionId",
    "coreContractVersion",
    "packageTrust",
    "timestamp",
    ...(Object.prototype.hasOwnProperty.call(input, "modelDefinitionId")
      ? ["modelDefinitionId"]
      : []),
  ];
  const actual = Object.keys(input);
  if (actual.length !== expected.length || !expected.every((key) => actual.includes(key))) {
    throw new InvalidPackageApplicationError("shape", "expected only approved fields");
  }
  if (
    Object.prototype.hasOwnProperty.call(input, "modelDefinitionId") &&
    input.modelDefinitionId === undefined
  ) {
    throw new InvalidPackageApplicationError("modelDefinitionId", "omit when absent");
  }
}

export function createPackageApplication(input: CreatePackageApplicationInput): PackageApplication {
  validateShape(input);
  if (!isStrictIsoUtcTimestamp(input.timestamp)) {
    throw new InvalidPackageApplicationError(
      "appliedAt",
      "expected a valid ISO-8601 UTC timestamp"
    );
  }
  const modelDefinitionId = model(input.modelDefinitionId);
  return Object.freeze({
    id: value("id", input.id),
    printerId: value("printerId", input.printerId),
    printerStateId: value("printerStateId", input.printerStateId),
    printerKnowledgeIdentityId: value(
      "printerKnowledgeIdentityId",
      input.printerKnowledgeIdentityId
    ),
    packageId: value("packageId", input.packageId),
    packageVersion: value("packageVersion", input.packageVersion),
    seriesDefinitionId: value("seriesDefinitionId", input.seriesDefinitionId),
    ...(modelDefinitionId === undefined ? {} : { modelDefinitionId }),
    coreContractVersion: contractVersion(input.coreContractVersion),
    packageTrust: trust(input.packageTrust),
    appliedAt: input.timestamp,
  });
}

export function createPackageApplicationKey(input: PackageApplicationKey): PackageApplicationKey {
  const modelDefinitionId = model(input.modelDefinitionId);
  return Object.freeze({
    printerStateId: value("printerStateId", input.printerStateId),
    packageId: value("packageId", input.packageId),
    packageVersion: value("packageVersion", input.packageVersion),
    seriesDefinitionId: value("seriesDefinitionId", input.seriesDefinitionId),
    ...(modelDefinitionId === undefined ? {} : { modelDefinitionId }),
    coreContractVersion: contractVersion(input.coreContractVersion),
  });
}

export function getPackageApplicationKey(application: PackageApplication): PackageApplicationKey {
  return createPackageApplicationKey(application);
}
