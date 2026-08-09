import type {
  CanonicalUnit,
  FieldClaimTarget,
  FieldClaimValue,
  ResolutionPolicy,
  ResolutionPolicyKind,
  ResolvedField,
  ResolvedFieldReasonCode,
  ResolvedFieldStatus,
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

interface CreateResolvedFieldBaseInput {
  readonly target: FieldClaimTarget;
  readonly fieldPath: string;
  readonly supportingClaimIds: readonly string[];
  readonly reasonCode: ResolvedFieldReasonCode;
}

export type CreateResolvedFieldInput =
  | (CreateResolvedFieldBaseInput & {
      readonly status: "resolved";
      readonly value: FieldClaimValue;
      readonly unit?: CanonicalUnit;
    })
  | (CreateResolvedFieldBaseInput & {
      readonly status: "missing" | "conflict" | "blocked";
    });

export interface CreateResolutionPolicyInput {
  readonly kind: ResolutionPolicyKind;
}

export class InvalidResolvedFieldStatusError extends Error {
  override readonly name = "InvalidResolvedFieldStatusError";
  constructor() {
    super("ResolvedField status must be a supported status");
  }
}

export class InvalidResolvedFieldTargetError extends Error {
  override readonly name = "InvalidResolvedFieldTargetError";
  constructor() {
    super("ResolvedField target must identify one supported target");
  }
}

export class InvalidResolvedFieldPathError extends Error {
  override readonly name = "InvalidResolvedFieldPathError";
  constructor() {
    super("ResolvedField path must be a canonical field path");
  }
}

export class InvalidResolvedFieldValueError extends Error {
  override readonly name = "InvalidResolvedFieldValueError";
  constructor() {
    super("ResolvedField value must match its status and be a supported scalar");
  }
}

export class InvalidResolvedFieldUnitError extends Error {
  override readonly name = "InvalidResolvedFieldUnitError";
  constructor() {
    super("ResolvedField unit must be a supported canonical numeric unit");
  }
}

export class InvalidResolvedFieldSupportingClaimIdsError extends Error {
  override readonly name = "InvalidResolvedFieldSupportingClaimIdsError";
  constructor() {
    super("ResolvedField supporting Claim IDs are invalid for its status");
  }
}

export class InvalidResolvedFieldReasonCodeError extends Error {
  override readonly name = "InvalidResolvedFieldReasonCodeError";
  constructor() {
    super("ResolvedField reason code must be a supported reason code");
  }
}

export class InvalidResolutionPolicyError extends Error {
  override readonly name = "InvalidResolutionPolicyError";
  constructor() {
    super("ResolutionPolicy must contain exactly one supported kind");
  }
}

const STATUSES = new Set<ResolvedFieldStatus>(["resolved", "missing", "conflict", "blocked"]);
const REASON_CODES = new Set<ResolvedFieldReasonCode>([
  "single_claim",
  "claims_agree",
  "stronger_evidence",
  "newer_same_source",
  "field_policy_selected",
  "safety_conservative_bound",
  "safety_policy_blocked",
  "no_usable_claims",
  "insufficient_confirmation",
  "unresolved_conflict",
  "incompatible_claim_representations",
  "invalid_claim_evidence",
]);
const POLICY_KINDS = new Set<ResolutionPolicyKind>([
  "exact_match",
  "installed_hardware_confirmation",
  "safety_upper_bound",
  "safety_lower_bound",
]);

function validateStatus(value: unknown): ResolvedFieldStatus {
  if (!STATUSES.has(value as ResolvedFieldStatus)) {
    throw new InvalidResolvedFieldStatusError();
  }
  return value as ResolvedFieldStatus;
}

function validateReasonCode(value: unknown): ResolvedFieldReasonCode {
  if (!REASON_CODES.has(value as ResolvedFieldReasonCode)) {
    throw new InvalidResolvedFieldReasonCodeError();
  }
  return value as ResolvedFieldReasonCode;
}

function copySupportingClaimIds(value: unknown, status: ResolvedFieldStatus): readonly string[] {
  if (!Array.isArray(value)) {
    throw new InvalidResolvedFieldSupportingClaimIdsError();
  }
  const ids = value.map((id) =>
    validateNormalizedId(id, () => new InvalidResolvedFieldSupportingClaimIdsError())
  );
  if (new Set(ids).size !== ids.length) {
    throw new InvalidResolvedFieldSupportingClaimIdsError();
  }
  if ((status === "missing" && ids.length !== 0) || (status !== "missing" && ids.length === 0)) {
    throw new InvalidResolvedFieldSupportingClaimIdsError();
  }
  return Object.freeze(ids);
}

export function createResolvedField(input: CreateResolvedFieldInput): ResolvedField {
  if (!isRecord(input)) {
    throw new InvalidResolvedFieldStatusError();
  }
  const status = validateStatus(input.status);
  const base = {
    target: copyFieldTarget(input.target, () => new InvalidResolvedFieldTargetError()),
    fieldPath: validateFieldPath(input.fieldPath, () => new InvalidResolvedFieldPathError()),
    supportingClaimIds: copySupportingClaimIds(input.supportingClaimIds, status),
    reasonCode: validateReasonCode(input.reasonCode),
  };

  if (status !== "resolved") {
    if ("value" in input || "unit" in input) {
      throw new InvalidResolvedFieldValueError();
    }
    return Object.freeze({ ...base, status });
  }

  if (!("value" in input)) {
    throw new InvalidResolvedFieldValueError();
  }
  const value = copyFieldValue(input.value, () => new InvalidResolvedFieldValueError());
  const unit = validateFieldUnit(input.unit, value, () => new InvalidResolvedFieldUnitError());
  return Object.freeze({
    ...base,
    status,
    value,
    ...(unit === undefined ? {} : { unit }),
  });
}

export function createResolutionPolicy(input: CreateResolutionPolicyInput): ResolutionPolicy {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ["kind"]) ||
    !POLICY_KINDS.has(input.kind as ResolutionPolicyKind)
  ) {
    throw new InvalidResolutionPolicyError();
  }
  return Object.freeze({ kind: input.kind as ResolutionPolicyKind });
}
