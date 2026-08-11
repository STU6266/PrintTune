import type { CanonicalUnit, FieldClaimTarget, FieldClaimValue } from "./field-claim.js";
import type { ResolutionPolicy } from "./resolved-field.js";

export type FieldDefinitionTargetType = FieldClaimTarget["type"];
export type FieldDefinitionValueType = FieldClaimValue["type"];
export type FieldTransitionPolicy =
  "safe_to_carry" | "component_dependent" | "configuration_dependent" | "require_reconfirmation";

export interface FieldDefinition {
  readonly fieldPath: string;
  readonly targetType: FieldDefinitionTargetType;
  readonly valueType: FieldDefinitionValueType;
  readonly unit?: CanonicalUnit;
  readonly resolutionPolicy: ResolutionPolicy;
  readonly transitionPolicy: FieldTransitionPolicy;
}
