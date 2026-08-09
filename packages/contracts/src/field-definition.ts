import type { CanonicalUnit, FieldClaimTarget, FieldClaimValue } from "./field-claim.js";
import type { ResolutionPolicy } from "./resolved-field.js";

export type FieldDefinitionTargetType = FieldClaimTarget["type"];
export type FieldDefinitionValueType = FieldClaimValue["type"];

export interface FieldDefinition {
  readonly fieldPath: string;
  readonly targetType: FieldDefinitionTargetType;
  readonly valueType: FieldDefinitionValueType;
  readonly unit?: CanonicalUnit;
  readonly resolutionPolicy: ResolutionPolicy;
}
