import type { FieldClaim, FieldDefinition } from "@printtune/contracts";

import { createFieldClaim } from "./field-claim.js";
import { createFieldDefinition } from "./field-definition.js";
import { findCoreFieldDefinition } from "./core-field-definition-registry.js";

export type FieldClaimCarryForwardAssessment =
  | { readonly status: "auto_carry" }
  | {
      readonly status: "confirmation_required";
      readonly reason: "component_dependency" | "configuration_dependency";
    }
  | {
      readonly status: "reconfirmation_required";
      readonly reason: "field_policy" | "weak_evidence";
    }
  | {
      readonly status: "not_carryable";
      readonly reason: "knowledge_package_claim" | "component_target_mapping_required";
    };

export interface AssessFieldClaimCarryForwardInput {
  readonly claim: FieldClaim;
  readonly fieldDefinition: FieldDefinition;
}

export type FieldClaimCarryForwardErrorCode =
  | "unknown_field_definition"
  | "incompatible_claim_representation"
  | "source_state_mismatch"
  | "same_source_and_target_state"
  | "invalid_transition_command_id"
  | "carry_not_allowed"
  | "applicability_confirmation_required"
  | "duplicate_generated_claim_id";

export class FieldClaimCarryForwardError extends Error {
  override readonly name = "FieldClaimCarryForwardError";
  constructor(readonly code: FieldClaimCarryForwardErrorCode) {
    super(`FieldClaim carry-forward failed: ${code}`);
  }
}

export interface CreateCarriedForwardFieldClaimInput {
  readonly sourceClaim: FieldClaim;
  readonly sourcePrinterStateId: string;
  readonly targetPrinterStateId: string;
  readonly transitionCommandId: string;
  readonly createdAt: string;
  readonly createClaimId: () => string;
  readonly applicabilityConfirmed?: boolean;
}

export interface CreateCarriedForwardFieldClaimsInput {
  readonly sourceClaims: readonly FieldClaim[];
  readonly sourcePrinterStateId: string;
  readonly targetPrinterStateId: string;
  readonly transitionCommandId: string;
  readonly createdAt: string;
  readonly createClaimId: () => string;
  readonly applicabilityConfirmedClaimIds?: ReadonlySet<string>;
}

export function assessFieldClaimCarryForward({
  claim,
  fieldDefinition,
}: AssessFieldClaimCarryForwardInput): FieldClaimCarryForwardAssessment {
  const definition = createFieldDefinition(fieldDefinition);
  if (claim.provenance.sourceType === "knowledge_package") {
    return { status: "not_carryable", reason: "knowledge_package_claim" };
  }
  if (claim.target.type === "component_installation") {
    return { status: "not_carryable", reason: "component_target_mapping_required" };
  }
  if (claim.trust === "user_entered" || claim.trust === "ai_generated_unverified") {
    return { status: "reconfirmation_required", reason: "weak_evidence" };
  }
  switch (definition.transitionPolicy) {
    case "safe_to_carry":
      return { status: "auto_carry" };
    case "component_dependent":
      return { status: "confirmation_required", reason: "component_dependency" };
    case "configuration_dependent":
      return { status: "confirmation_required", reason: "configuration_dependency" };
    case "require_reconfirmation":
      return { status: "reconfirmation_required", reason: "field_policy" };
  }
}

function validatePlan(input: CreateCarriedForwardFieldClaimInput): FieldDefinition {
  const definition = findCoreFieldDefinition(input.sourceClaim.fieldPath);
  if (!definition) throw new FieldClaimCarryForwardError("unknown_field_definition");
  if (
    input.sourceClaim.target.type !== "printer_state" ||
    input.sourceClaim.target.printerStateId !== input.sourcePrinterStateId
  ) {
    throw new FieldClaimCarryForwardError("source_state_mismatch");
  }
  if (input.sourcePrinterStateId === input.targetPrinterStateId) {
    throw new FieldClaimCarryForwardError("same_source_and_target_state");
  }
  if (
    definition.targetType !== input.sourceClaim.target.type ||
    definition.valueType !== input.sourceClaim.value.type ||
    definition.unit !== input.sourceClaim.unit
  ) {
    throw new FieldClaimCarryForwardError("incompatible_claim_representation");
  }
  if (
    typeof input.transitionCommandId !== "string" ||
    input.transitionCommandId.length === 0 ||
    input.transitionCommandId.trim() !== input.transitionCommandId
  ) {
    throw new FieldClaimCarryForwardError("invalid_transition_command_id");
  }
  const assessment = assessFieldClaimCarryForward({
    claim: input.sourceClaim,
    fieldDefinition: definition,
  });
  if (assessment.status === "confirmation_required" && input.applicabilityConfirmed !== true) {
    throw new FieldClaimCarryForwardError("applicability_confirmation_required");
  }
  if (assessment.status === "reconfirmation_required" || assessment.status === "not_carryable") {
    throw new FieldClaimCarryForwardError("carry_not_allowed");
  }
  return definition;
}

export function createCarriedForwardFieldClaim(
  input: CreateCarriedForwardFieldClaimInput
): FieldClaim {
  validatePlan(input);
  return createFieldClaim({
    id: input.createClaimId(),
    target: { type: "printer_state", printerStateId: input.targetPrinterStateId },
    fieldPath: input.sourceClaim.fieldPath,
    value: input.sourceClaim.value,
    ...(input.sourceClaim.unit === undefined ? {} : { unit: input.sourceClaim.unit }),
    provenance: {
      sourceType: "state_transition",
      sourceRef: {
        type: "state_transition",
        sourceClaimId: input.sourceClaim.id,
        transitionCommandId: input.transitionCommandId,
      },
    },
    trust: input.sourceClaim.trust,
    ...(input.sourceClaim.confidence === undefined
      ? {}
      : { confidence: input.sourceClaim.confidence }),
    timestamp: input.createdAt,
  });
}

export function createCarriedForwardFieldClaims(
  input: CreateCarriedForwardFieldClaimsInput
): readonly FieldClaim[] {
  const plans = input.sourceClaims.map((sourceClaim) => ({
    sourceClaim,
    sourcePrinterStateId: input.sourcePrinterStateId,
    targetPrinterStateId: input.targetPrinterStateId,
    transitionCommandId: input.transitionCommandId,
    createdAt: input.createdAt,
    createClaimId: input.createClaimId,
    applicabilityConfirmed: input.applicabilityConfirmedClaimIds?.has(sourceClaim.id) ?? false,
  }));
  for (const plan of plans) validatePlan(plan);
  const claims = plans.map(createCarriedForwardFieldClaim);
  const ids = new Set<string>();
  for (const claim of claims) {
    if (ids.has(claim.id)) throw new FieldClaimCarryForwardError("duplicate_generated_claim_id");
    ids.add(claim.id);
  }
  return Object.freeze(claims);
}
