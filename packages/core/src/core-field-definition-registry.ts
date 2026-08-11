import type { FieldDefinition } from "@printtune/contracts";

import { createFieldDefinition, type CreateFieldDefinitionInput } from "./field-definition.js";
import { validateFieldPath } from "./field-claim-validation.js";
import { InvalidFieldDefinitionPathError } from "./field-definition.js";

export class DuplicateCoreFieldDefinitionError extends Error {
  override readonly name = "DuplicateCoreFieldDefinitionError";
  constructor(fieldPath: string) {
    super(`Duplicate Core FieldDefinition: ${fieldPath}`);
  }
}

interface ReadOnlyFieldDefinitionRegistry {
  readonly find: (fieldPath: string) => FieldDefinition | undefined;
  readonly list: () => readonly FieldDefinition[];
}

export function createReadOnlyFieldDefinitionRegistry(
  inputs: readonly CreateFieldDefinitionInput[]
): ReadOnlyFieldDefinitionRegistry {
  const definitions = inputs
    .map(createFieldDefinition)
    .sort((left, right) => left.fieldPath.localeCompare(right.fieldPath));
  const byPath = new Map<string, FieldDefinition>();
  for (const definition of definitions) {
    if (byPath.has(definition.fieldPath)) {
      throw new DuplicateCoreFieldDefinitionError(definition.fieldPath);
    }
    byPath.set(definition.fieldPath, definition);
  }
  const immutableDefinitions = Object.freeze(definitions);

  return Object.freeze({
    find(fieldPath: string): FieldDefinition | undefined {
      const canonicalPath = validateFieldPath(
        fieldPath,
        () => new InvalidFieldDefinitionPathError()
      );
      return byPath.get(canonicalPath);
    },
    list(): readonly FieldDefinition[] {
      return immutableDefinitions;
    },
  });
}

const CORE_FIELD_DEFINITION_INPUTS = [
  {
    fieldPath: "printer.nozzle.diameter",
    targetType: "printer_state",
    valueType: "number",
    unit: "mm",
    resolutionPolicy: { kind: "installed_hardware_confirmation" },
    transitionPolicy: "component_dependent",
  },
  {
    fieldPath: "printer.extruder.type",
    targetType: "printer_state",
    valueType: "string",
    resolutionPolicy: { kind: "installed_hardware_confirmation" },
    transitionPolicy: "component_dependent",
  },
  {
    fieldPath: "printer.hotend.max-temperature",
    targetType: "printer_state",
    valueType: "number",
    unit: "degC",
    resolutionPolicy: { kind: "safety_upper_bound" },
    transitionPolicy: "require_reconfirmation",
  },
  {
    fieldPath: "printer.bed.max-temperature",
    targetType: "printer_state",
    valueType: "number",
    unit: "degC",
    resolutionPolicy: { kind: "safety_upper_bound" },
    transitionPolicy: "require_reconfirmation",
  },
  {
    fieldPath: "firmware.type",
    targetType: "printer_state",
    valueType: "string",
    resolutionPolicy: { kind: "exact_match" },
    transitionPolicy: "configuration_dependent",
  },
  {
    fieldPath: "firmware.motion.max-velocity",
    targetType: "printer_state",
    valueType: "number",
    unit: "mm/s",
    resolutionPolicy: { kind: "exact_match" },
    transitionPolicy: "require_reconfirmation",
  },
  {
    fieldPath: "firmware.motion.max-acceleration",
    targetType: "printer_state",
    valueType: "number",
    unit: "mm/s2",
    resolutionPolicy: { kind: "exact_match" },
    transitionPolicy: "require_reconfirmation",
  },
  {
    fieldPath: "slicer.retraction.distance",
    targetType: "printer_state",
    valueType: "number",
    unit: "mm",
    resolutionPolicy: { kind: "exact_match" },
    transitionPolicy: "require_reconfirmation",
  },
  {
    fieldPath: "slicer.retraction.speed",
    targetType: "printer_state",
    valueType: "number",
    unit: "mm/s",
    resolutionPolicy: { kind: "exact_match" },
    transitionPolicy: "require_reconfirmation",
  },
  {
    fieldPath: "slicer.layer-height",
    targetType: "printer_state",
    valueType: "number",
    unit: "mm",
    resolutionPolicy: { kind: "exact_match" },
    transitionPolicy: "require_reconfirmation",
  },
  {
    fieldPath: "component.probe.offset.x",
    targetType: "component_installation",
    valueType: "number",
    unit: "mm",
    resolutionPolicy: { kind: "exact_match" },
    transitionPolicy: "require_reconfirmation",
  },
] as const satisfies readonly CreateFieldDefinitionInput[];

const CORE_FIELD_DEFINITION_REGISTRY = createReadOnlyFieldDefinitionRegistry(
  CORE_FIELD_DEFINITION_INPUTS
);

export function findCoreFieldDefinition(fieldPath: string): FieldDefinition | undefined {
  return CORE_FIELD_DEFINITION_REGISTRY.find(fieldPath);
}

export function listCoreFieldDefinitions(): readonly FieldDefinition[] {
  return CORE_FIELD_DEFINITION_REGISTRY.list();
}
