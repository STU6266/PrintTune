import type {
  CanonicalUnit,
  ClaimTrust,
  FieldClaim,
  FieldClaimTarget,
  ResolutionPolicy,
  ResolvedField,
} from "@printtune/contracts";

import { createFieldClaim } from "./field-claim.js";
import { isRecord } from "./field-claim-validation.js";
import { createResolutionPolicy, createResolvedField } from "./resolved-field.js";

export interface ResolveFieldClaimsInput {
  readonly target: FieldClaimTarget;
  readonly fieldPath: string;
  readonly claims: readonly FieldClaim[];
  readonly policy?: ResolutionPolicy;
}

type TrustGroup = "strong" | "observed" | "weak";

const STRONG_TRUST = new Set<ClaimTrust>([
  "developer_verified",
  "customer_verified",
  "user_confirmed",
]);

function targetMatches(value: unknown, target: FieldClaimTarget): boolean {
  if (!isRecord(value) || value.type !== target.type) return false;
  return target.type === "printer_state"
    ? value.printerStateId === target.printerStateId
    : value.componentInstallationId === target.componentInstallationId;
}

function isRelevant(value: unknown, target: FieldClaimTarget, fieldPath: string): boolean {
  return isRecord(value) && value.fieldPath === fieldPath && targetMatches(value.target, target);
}

function validateClaim(value: unknown): FieldClaim | undefined {
  if (!isRecord(value)) return undefined;
  try {
    return createFieldClaim({
      id: value.id as string,
      target: value.target as FieldClaimTarget,
      fieldPath: value.fieldPath as string,
      value: value.value as FieldClaim["value"],
      ...(value.unit === undefined ? {} : { unit: value.unit as CanonicalUnit }),
      provenance: value.provenance as FieldClaim["provenance"],
      trust: value.trust as ClaimTrust,
      ...(value.confidence === undefined ? {} : { confidence: value.confidence as number }),
      timestamp: value.createdAt as string,
    });
  } catch {
    return undefined;
  }
}

function compareClaims(left: FieldClaim, right: FieldClaim): number {
  return (
    Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id)
  );
}

function orderedUniqueIds(claims: readonly FieldClaim[]): string[] {
  return [...new Map(claims.map((claim) => [claim.id, claim])).values()]
    .sort(compareClaims)
    .map((claim) => claim.id);
}

function invalidEvidenceIds(values: readonly unknown[]): string[] {
  const candidates = values
    .filter(isRecord)
    .filter(
      (value): value is Record<string, unknown> & { id: string; createdAt: string } =>
        typeof value.id === "string" &&
        value.id.length > 0 &&
        value.id.trim() === value.id &&
        typeof value.createdAt === "string"
    )
    .sort(
      (left, right) =>
        (Number.isNaN(Date.parse(left.createdAt)) ? 0 : Date.parse(left.createdAt)) -
          (Number.isNaN(Date.parse(right.createdAt)) ? 0 : Date.parse(right.createdAt)) ||
        left.id.localeCompare(right.id)
    );
  return [...new Set(candidates.map((claim) => claim.id))];
}

function trustGroup(trust: ClaimTrust): TrustGroup {
  if (STRONG_TRUST.has(trust)) return "strong";
  return trust === "imported_observation" ? "observed" : "weak";
}

function sameRepresentation(left: FieldClaim, right: FieldClaim): boolean {
  return left.value.type === right.value.type && (left.unit ?? null) === (right.unit ?? null);
}

function sameValue(left: FieldClaim, right: FieldClaim): boolean {
  return sameRepresentation(left, right) && left.value.value === right.value.value;
}

function resolved(
  target: FieldClaimTarget,
  fieldPath: string,
  selected: FieldClaim,
  supportingClaims: readonly FieldClaim[],
  reasonCode:
    | "single_claim"
    | "claims_agree"
    | "stronger_evidence"
    | "newer_same_source"
    | "field_policy_selected"
    | "safety_conservative_bound"
): ResolvedField {
  return createResolvedField({
    target,
    fieldPath,
    status: "resolved",
    value: selected.value,
    ...(selected.unit === undefined ? {} : { unit: selected.unit }),
    supportingClaimIds: orderedUniqueIds(supportingClaims),
    reasonCode,
  });
}

function blocked(
  target: FieldClaimTarget,
  fieldPath: string,
  claims: readonly FieldClaim[],
  reasonCode:
    "insufficient_confirmation" | "incompatible_claim_representations" | "safety_policy_blocked"
): ResolvedField {
  return createResolvedField({
    target,
    fieldPath,
    status: "blocked",
    supportingClaimIds: orderedUniqueIds(claims),
    reasonCode,
  });
}

function conflict(
  target: FieldClaimTarget,
  fieldPath: string,
  claims: readonly FieldClaim[]
): ResolvedField {
  return createResolvedField({
    target,
    fieldPath,
    status: "conflict",
    supportingClaimIds: orderedUniqueIds(claims),
    reasonCode: "unresolved_conflict",
  });
}

function exactMatch(
  target: FieldClaimTarget,
  fieldPath: string,
  claims: readonly FieldClaim[]
): ResolvedField {
  const usable = claims.filter((claim) => trustGroup(claim.trust) !== "weak");
  if (usable.length === 0) return blocked(target, fieldPath, claims, "insufficient_confirmation");

  const first = usable[0];
  if (!first || usable.some((claim) => !sameRepresentation(first, claim))) {
    return blocked(target, fieldPath, usable, "incompatible_claim_representations");
  }
  if (usable.some((claim) => !sameValue(first, claim))) {
    return conflict(target, fieldPath, usable);
  }

  const agreeingWeak = claims.filter(
    (claim) => trustGroup(claim.trust) === "weak" && sameValue(first, claim)
  );
  const disagreeingWeak = claims.some(
    (claim) => trustGroup(claim.trust) === "weak" && !sameValue(first, claim)
  );
  return resolved(
    target,
    fieldPath,
    first,
    [...usable, ...agreeingWeak],
    disagreeingWeak ? "stronger_evidence" : usable.length === 1 ? "single_claim" : "claims_agree"
  );
}

function isUserHardwareConfirmation(claim: FieldClaim): boolean {
  return claim.trust === "user_confirmed" && claim.provenance.sourceType === "user_confirmed";
}

function isCatalogClaim(claim: FieldClaim): boolean {
  return (
    claim.provenance.sourceType === "knowledge_package" ||
    claim.provenance.sourceType === "component_definition"
  );
}

function installedHardwareConfirmation(
  target: FieldClaimTarget,
  fieldPath: string,
  claims: readonly FieldClaim[]
): ResolvedField {
  const confirmations = claims.filter(isUserHardwareConfirmation);
  if (confirmations.length === 0) return exactMatch(target, fieldPath, claims);

  const firstConfirmation = confirmations[0];
  if (
    !firstConfirmation ||
    confirmations.some((claim) => !sameRepresentation(firstConfirmation, claim))
  ) {
    return blocked(target, fieldPath, confirmations, "incompatible_claim_representations");
  }
  const latestTimestamp = Date.parse(confirmations[confirmations.length - 1]?.createdAt ?? "");
  const latestConfirmations = confirmations.filter(
    (confirmation) => Date.parse(confirmation.createdAt) === latestTimestamp
  );
  const selected = latestConfirmations[0];
  if (!selected) return blocked(target, fieldPath, confirmations, "insufficient_confirmation");
  if (latestConfirmations.some((confirmation) => !sameValue(selected, confirmation))) {
    return conflict(target, fieldPath, latestConfirmations);
  }
  const confirmationsDisagree = confirmations.some((claim) => !sameValue(selected, claim));

  const catalog = claims.filter(isCatalogClaim);
  if (catalog.some((claim) => !sameRepresentation(selected, claim))) {
    return blocked(target, fieldPath, [selected, ...catalog], "incompatible_claim_representations");
  }
  const otherUsable = claims.filter(
    (claim) =>
      trustGroup(claim.trust) !== "weak" &&
      !isUserHardwareConfirmation(claim) &&
      !isCatalogClaim(claim)
  );
  if (otherUsable.some((claim) => !sameRepresentation(selected, claim))) {
    return blocked(
      target,
      fieldPath,
      [selected, ...otherUsable],
      "incompatible_claim_representations"
    );
  }
  const conflictingOther = otherUsable.filter((claim) => !sameValue(selected, claim));
  if (conflictingOther.length > 0) {
    return conflict(target, fieldPath, [selected, ...conflictingOther]);
  }

  const supporting = claims.filter((claim) => sameValue(selected, claim));
  const catalogDisagrees = catalog.some((claim) => !sameValue(selected, claim));
  const weakDisagrees = claims.some(
    (claim) => trustGroup(claim.trust) === "weak" && !sameValue(selected, claim)
  );
  return resolved(
    target,
    fieldPath,
    selected,
    supporting,
    confirmationsDisagree
      ? "newer_same_source"
      : catalogDisagrees
        ? "field_policy_selected"
        : weakDisagrees
          ? "stronger_evidence"
          : supporting.filter((claim) => trustGroup(claim.trust) !== "weak").length > 1
            ? "claims_agree"
            : "single_claim"
  );
}

function safetyBound(
  target: FieldClaimTarget,
  fieldPath: string,
  claims: readonly FieldClaim[],
  direction: "upper" | "lower"
): ResolvedField {
  const reliable = claims.filter((claim) => trustGroup(claim.trust) !== "weak");
  if (reliable.length === 0) return blocked(target, fieldPath, claims, "safety_policy_blocked");

  const numeric = reliable.filter((claim) => claim.value.type === "number");
  if (numeric.length === 0) return blocked(target, fieldPath, reliable, "safety_policy_blocked");
  const first = reliable[0];
  if (
    !first ||
    reliable.some((claim) => claim.value.type !== "number" || !sameRepresentation(first, claim))
  ) {
    return blocked(target, fieldPath, reliable, "incompatible_claim_representations");
  }

  const selected = reliable.reduce((current, claim) => {
    const currentValue = current.value.value as number;
    const claimValue = claim.value.value as number;
    return direction === "upper"
      ? claimValue < currentValue
        ? claim
        : current
      : claimValue > currentValue
        ? claim
        : current;
  });
  const allAgree = reliable.every((claim) => sameValue(selected, claim));
  return resolved(
    target,
    fieldPath,
    selected,
    reliable,
    reliable.length === 1 ? "single_claim" : allAgree ? "claims_agree" : "safety_conservative_bound"
  );
}

export function resolveFieldClaims(input: ResolveFieldClaimsInput): ResolvedField {
  const policy = createResolutionPolicy(input.policy ?? { kind: "exact_match" });
  const relevantRaw = (input.claims as readonly unknown[]).filter((claim) =>
    isRelevant(claim, input.target, input.fieldPath)
  );

  if (relevantRaw.length === 0) {
    return createResolvedField({
      target: input.target,
      fieldPath: input.fieldPath,
      status: "missing",
      supportingClaimIds: [],
      reasonCode: "no_usable_claims",
    });
  }

  const validated = relevantRaw.map(validateClaim);
  if (validated.some((claim) => claim === undefined)) {
    return createResolvedField({
      target: input.target,
      fieldPath: input.fieldPath,
      status: "blocked",
      supportingClaimIds: invalidEvidenceIds(relevantRaw),
      reasonCode: "invalid_claim_evidence",
    });
  }

  const claims = (validated as FieldClaim[]).sort(compareClaims);
  if (new Set(claims.map((claim) => claim.id)).size !== claims.length) {
    return createResolvedField({
      target: input.target,
      fieldPath: input.fieldPath,
      status: "blocked",
      supportingClaimIds: orderedUniqueIds(claims),
      reasonCode: "invalid_claim_evidence",
    });
  }

  switch (policy.kind) {
    case "exact_match":
      return exactMatch(input.target, input.fieldPath, claims);
    case "installed_hardware_confirmation":
      return installedHardwareConfirmation(input.target, input.fieldPath, claims);
    case "safety_upper_bound":
      return safetyBound(input.target, input.fieldPath, claims, "upper");
    case "safety_lower_bound":
      return safetyBound(input.target, input.fieldPath, claims, "lower");
  }
}
