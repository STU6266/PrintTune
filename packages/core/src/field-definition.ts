import type {
  CanonicalUnit,
  FieldDefinition,
  FieldDefinitionTargetType,
  FieldTransitionPolicy,
  FieldDefinitionValueType,
} from "@printtune/contracts";

import { hasExactKeys, isRecord, validateFieldPath } from "./field-claim-validation.js";
import { createResolutionPolicy } from "./resolved-field.js";

export type CreateFieldDefinitionInput = FieldDefinition;

export class InvalidFieldDefinitionPathError extends Error {
  override readonly name = "InvalidFieldDefinitionPathError";
  constructor() {
    super("FieldDefinition path must be a canonical field path");
  }
}

export class InvalidFieldDefinitionTargetTypeError extends Error {
  override readonly name = "InvalidFieldDefinitionTargetTypeError";
  constructor() {
    super("FieldDefinition target type must be supported");
  }
}

export class InvalidFieldDefinitionValueTypeError extends Error {
  override readonly name = "InvalidFieldDefinitionValueTypeError";
  constructor() {
    super("FieldDefinition value type must be a supported scalar type");
  }
}

export class InvalidFieldDefinitionUnitError extends Error {
  override readonly name = "InvalidFieldDefinitionUnitError";
  constructor() {
    super("FieldDefinition unit must be canonical and compatible with its value type");
  }
}

export class InvalidFieldDefinitionShapeError extends Error {
  override readonly name = "InvalidFieldDefinitionShapeError";
  constructor() {
    super("FieldDefinition must contain only the approved semantics");
  }
}

export class InvalidFieldTransitionPolicyError extends Error {
  override readonly name = "InvalidFieldTransitionPolicyError";
  constructor() {
    super("FieldDefinition transition policy must be supported");
  }
}

const TARGET_TYPES = new Set<FieldDefinitionTargetType>([
  "printer_state",
  "component_installation",
]);
const VALUE_TYPES = new Set<FieldDefinitionValueType>(["string", "number", "boolean"]);
const CANONICAL_UNITS = new Set<CanonicalUnit>(["mm", "mm/s", "mm/s2", "degC", "mm3/s", "ratio"]);
const TRANSITION_POLICIES = new Set<FieldTransitionPolicy>([
  "safe_to_carry",
  "component_dependent",
  "configuration_dependent",
  "require_reconfirmation",
]);

export function createFieldDefinition(input: CreateFieldDefinitionInput): FieldDefinition {
  if (!isRecord(input)) {
    throw new InvalidFieldDefinitionShapeError();
  }
  const hasUnitlessShape = hasExactKeys(input, [
    "fieldPath",
    "targetType",
    "valueType",
    "resolutionPolicy",
    "transitionPolicy",
  ]);
  const hasUnitShape = hasExactKeys(input, [
    "fieldPath",
    "targetType",
    "valueType",
    "unit",
    "resolutionPolicy",
    "transitionPolicy",
  ]);
  if (!hasUnitlessShape && !hasUnitShape) {
    throw new InvalidFieldDefinitionShapeError();
  }

  const fieldPath = validateFieldPath(input.fieldPath, () => new InvalidFieldDefinitionPathError());
  if (!TARGET_TYPES.has(input.targetType as FieldDefinitionTargetType)) {
    throw new InvalidFieldDefinitionTargetTypeError();
  }
  if (!VALUE_TYPES.has(input.valueType as FieldDefinitionValueType)) {
    throw new InvalidFieldDefinitionValueTypeError();
  }
  if (
    (input.unit !== undefined && !CANONICAL_UNITS.has(input.unit as CanonicalUnit)) ||
    (input.valueType !== "number" && input.unit !== undefined)
  ) {
    throw new InvalidFieldDefinitionUnitError();
  }

  const resolutionPolicy = createResolutionPolicy(input.resolutionPolicy);
  if (!TRANSITION_POLICIES.has(input.transitionPolicy as FieldTransitionPolicy)) {
    throw new InvalidFieldTransitionPolicyError();
  }
  return Object.freeze({
    fieldPath,
    targetType: input.targetType as FieldDefinitionTargetType,
    valueType: input.valueType as FieldDefinitionValueType,
    ...(input.unit === undefined ? {} : { unit: input.unit as CanonicalUnit }),
    resolutionPolicy,
    transitionPolicy: input.transitionPolicy as FieldTransitionPolicy,
  });
}
