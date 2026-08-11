import type {
  CanonicalUnit,
  ClaimProvenance,
  ClaimSourceReference,
  ClaimSourceType,
  ClaimTrust,
  FieldClaim,
  FieldClaimTarget,
  FieldClaimValue,
} from "@printtune/contracts";

import {
  copyFieldTarget,
  copyFieldValue,
  hasExactKeys,
  isRecord,
  validateFieldPath,
  validateFieldUnit,
  validateNormalizedId,
} from "./field-claim-validation.js";

export interface CreateFieldClaimInput {
  readonly id: string;
  readonly target: FieldClaimTarget;
  readonly fieldPath: string;
  readonly value: FieldClaimValue;
  readonly unit?: CanonicalUnit;
  readonly provenance: ClaimProvenance;
  readonly trust: ClaimTrust;
  readonly confidence?: number;
  readonly timestamp: string;
}

export class InvalidFieldClaimIdError extends Error {
  override readonly name = "InvalidFieldClaimIdError";

  constructor() {
    super("FieldClaim ID must be a non-empty trimmed string");
  }
}

export class InvalidFieldClaimTargetError extends Error {
  override readonly name = "InvalidFieldClaimTargetError";

  constructor() {
    super("FieldClaim target must identify one supported target");
  }
}

export class InvalidFieldClaimPathError extends Error {
  override readonly name = "InvalidFieldClaimPathError";

  constructor() {
    super("FieldClaim field path must be a canonical dotted identifier");
  }
}

export class InvalidFieldClaimValueError extends Error {
  override readonly name = "InvalidFieldClaimValueError";

  constructor() {
    super("FieldClaim value must be a supported typed scalar");
  }
}

export class InvalidFieldClaimUnitError extends Error {
  override readonly name = "InvalidFieldClaimUnitError";

  constructor() {
    super("FieldClaim unit must be a supported canonical numeric unit");
  }
}

export class InvalidFieldClaimProvenanceError extends Error {
  override readonly name = "InvalidFieldClaimProvenanceError";

  constructor() {
    super("FieldClaim provenance must contain a supported source and reference");
  }
}

export class InvalidFieldClaimTrustError extends Error {
  override readonly name = "InvalidFieldClaimTrustError";

  constructor() {
    super("FieldClaim trust must be a supported category");
  }
}

export class InvalidFieldClaimConfidenceError extends Error {
  override readonly name = "InvalidFieldClaimConfidenceError";

  constructor() {
    super("FieldClaim confidence must be a finite number from 0 through 1");
  }
}

export class InvalidFieldClaimTimestampError extends Error {
  override readonly name = "InvalidFieldClaimTimestampError";

  constructor() {
    super("FieldClaim timestamp must be an ISO-8601 UTC string");
  }
}

const ISO_UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
const CLAIM_TRUST_VALUES = new Set<ClaimTrust>([
  "developer_verified",
  "customer_verified",
  "user_confirmed",
  "user_entered",
  "imported_observation",
  "ai_generated_unverified",
]);
const REFERENCE_TYPE_BY_SOURCE = {
  imported_file: "import_snapshot",
  slicer_profile: "slicer_profile_snapshot",
  firmware_read: "firmware_snapshot",
  knowledge_package: "knowledge_package",
  component_definition: "component_definition",
  test_result: "test_run",
  state_transition: "state_transition",
} as const satisfies Partial<Record<ClaimSourceType, ClaimSourceReference["type"]>>;
const SOURCES_WITHOUT_REFERENCE = new Set<ClaimSourceType>([
  "user_confirmed",
  "user_entered",
  "ai_unverified",
]);

function copySourceReference(reference: unknown): ClaimSourceReference {
  if (!isRecord(reference) || typeof reference.type !== "string") {
    throw new InvalidFieldClaimProvenanceError();
  }
  const copyIdReference = (
    type: "import_snapshot" | "slicer_profile_snapshot" | "firmware_snapshot" | "test_run"
  ): ClaimSourceReference => {
    if (reference.type !== type || !hasExactKeys(reference, ["type", "id"])) {
      throw new InvalidFieldClaimProvenanceError();
    }
    return Object.freeze({
      type,
      id: validateNormalizedId(reference.id, () => new InvalidFieldClaimProvenanceError()),
    });
  };

  switch (reference.type) {
    case "import_snapshot":
    case "slicer_profile_snapshot":
    case "firmware_snapshot":
    case "test_run":
      return copyIdReference(reference.type);
    case "knowledge_package":
      const hasHistoricalKeys = hasExactKeys(reference, ["type", "packageId", "packageVersion"]);
      const hasFactKeys = hasExactKeys(reference, [
        "type",
        "packageId",
        "packageVersion",
        "factId",
      ]);
      if (!hasHistoricalKeys && !hasFactKeys) {
        throw new InvalidFieldClaimProvenanceError();
      }
      const factId = hasFactKeys
        ? validateNormalizedId(reference.factId, () => new InvalidFieldClaimProvenanceError())
        : undefined;
      return Object.freeze({
        type: "knowledge_package",
        packageId: validateNormalizedId(
          reference.packageId,
          () => new InvalidFieldClaimProvenanceError()
        ),
        packageVersion: validateNormalizedId(
          reference.packageVersion,
          () => new InvalidFieldClaimProvenanceError()
        ),
        ...(factId === undefined ? {} : { factId }),
      });
    case "component_definition":
      if (!hasExactKeys(reference, ["type", "packageId", "packageVersion", "definitionId"])) {
        throw new InvalidFieldClaimProvenanceError();
      }
      return Object.freeze({
        type: "component_definition",
        packageId: validateNormalizedId(
          reference.packageId,
          () => new InvalidFieldClaimProvenanceError()
        ),
        packageVersion: validateNormalizedId(
          reference.packageVersion,
          () => new InvalidFieldClaimProvenanceError()
        ),
        definitionId: validateNormalizedId(
          reference.definitionId,
          () => new InvalidFieldClaimProvenanceError()
        ),
      });
    case "state_transition":
      if (!hasExactKeys(reference, ["type", "sourceClaimId", "transitionCommandId"])) {
        throw new InvalidFieldClaimProvenanceError();
      }
      return Object.freeze({
        type: "state_transition",
        sourceClaimId: validateNormalizedId(
          reference.sourceClaimId,
          () => new InvalidFieldClaimProvenanceError()
        ),
        transitionCommandId: validateNormalizedId(
          reference.transitionCommandId,
          () => new InvalidFieldClaimProvenanceError()
        ),
      });
    default:
      throw new InvalidFieldClaimProvenanceError();
  }
}

function copyProvenance(provenance: unknown): ClaimProvenance {
  if (!isRecord(provenance) || typeof provenance.sourceType !== "string") {
    throw new InvalidFieldClaimProvenanceError();
  }
  const sourceType = provenance.sourceType as ClaimSourceType;
  if (SOURCES_WITHOUT_REFERENCE.has(sourceType)) {
    if (!hasExactKeys(provenance, ["sourceType"])) {
      throw new InvalidFieldClaimProvenanceError();
    }
    return Object.freeze({ sourceType });
  }

  const expectedReferenceType =
    REFERENCE_TYPE_BY_SOURCE[sourceType as keyof typeof REFERENCE_TYPE_BY_SOURCE];
  if (!expectedReferenceType || !hasExactKeys(provenance, ["sourceType", "sourceRef"])) {
    throw new InvalidFieldClaimProvenanceError();
  }
  const sourceRef = copySourceReference(provenance.sourceRef);
  if (sourceRef.type !== expectedReferenceType) {
    throw new InvalidFieldClaimProvenanceError();
  }
  return Object.freeze({ sourceType, sourceRef });
}

function validateTrust(value: unknown): ClaimTrust {
  if (!CLAIM_TRUST_VALUES.has(value as ClaimTrust)) {
    throw new InvalidFieldClaimTrustError();
  }
  return value as ClaimTrust;
}

function validateConfidence(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new InvalidFieldClaimConfidenceError();
  }
  return value;
}

function validateTimestamp(timestamp: unknown): string {
  if (typeof timestamp !== "string") {
    throw new InvalidFieldClaimTimestampError();
  }
  const match = ISO_UTC_TIMESTAMP_PATTERN.exec(timestamp);
  const parsedTimestamp = Date.parse(timestamp);
  if (!match || Number.isNaN(parsedTimestamp)) {
    throw new InvalidFieldClaimTimestampError();
  }
  const parsedDate = new Date(parsedTimestamp);
  const [, year, month, day, hour, minute, second, fraction = "0"] = match;
  if (
    parsedDate.getUTCFullYear() !== Number(year) ||
    parsedDate.getUTCMonth() + 1 !== Number(month) ||
    parsedDate.getUTCDate() !== Number(day) ||
    parsedDate.getUTCHours() !== Number(hour) ||
    parsedDate.getUTCMinutes() !== Number(minute) ||
    parsedDate.getUTCSeconds() !== Number(second) ||
    parsedDate.getUTCMilliseconds() !== Number(fraction.padEnd(3, "0"))
  ) {
    throw new InvalidFieldClaimTimestampError();
  }
  return timestamp;
}

export function createFieldClaim(input: CreateFieldClaimInput): FieldClaim {
  const target = copyFieldTarget(input.target, () => new InvalidFieldClaimTargetError());
  const value = copyFieldValue(input.value, () => new InvalidFieldClaimValueError());
  const unit = validateFieldUnit(input.unit, value, () => new InvalidFieldClaimUnitError());
  const provenance = copyProvenance(input.provenance);
  const confidence = validateConfidence(input.confidence);

  return Object.freeze({
    id: validateNormalizedId(input.id, () => new InvalidFieldClaimIdError()),
    target,
    fieldPath: validateFieldPath(input.fieldPath, () => new InvalidFieldClaimPathError()),
    value,
    ...(unit === undefined ? {} : { unit }),
    provenance,
    trust: validateTrust(input.trust),
    ...(confidence === undefined ? {} : { confidence }),
    createdAt: validateTimestamp(input.timestamp),
  });
}
