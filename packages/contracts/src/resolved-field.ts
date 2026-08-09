import type { CanonicalUnit, FieldClaimTarget, FieldClaimValue } from "./field-claim.js";

export type ResolvedFieldStatus = "resolved" | "missing" | "conflict" | "blocked";

export type ResolvedFieldReasonCode =
  | "single_claim"
  | "claims_agree"
  | "stronger_evidence"
  | "newer_same_source"
  | "field_policy_selected"
  | "safety_conservative_bound"
  | "safety_policy_blocked"
  | "no_usable_claims"
  | "insufficient_confirmation"
  | "unresolved_conflict"
  | "incompatible_claim_representations"
  | "invalid_claim_evidence";

interface ResolvedFieldBase {
  readonly target: FieldClaimTarget;
  readonly fieldPath: string;
  readonly supportingClaimIds: readonly string[];
  readonly reasonCode: ResolvedFieldReasonCode;
}

export type ResolvedField =
  | (ResolvedFieldBase & {
      readonly status: "resolved";
      readonly value: FieldClaimValue;
      readonly unit?: CanonicalUnit;
    })
  | (ResolvedFieldBase & {
      readonly status: "missing" | "conflict" | "blocked";
    });

export type ResolutionPolicyKind =
  "exact_match" | "installed_hardware_confirmation" | "safety_upper_bound" | "safety_lower_bound";

export interface ResolutionPolicy {
  readonly kind: ResolutionPolicyKind;
}
