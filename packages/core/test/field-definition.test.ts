import type {
  CanonicalUnit,
  FieldDefinition,
  FieldDefinitionTargetType,
  FieldDefinitionValueType,
  ResolutionPolicyKind,
} from "@printtune/contracts";
import { describe, expect, it } from "vitest";

import {
  InvalidFieldDefinitionPathError,
  InvalidFieldDefinitionShapeError,
  InvalidFieldDefinitionTargetTypeError,
  InvalidFieldDefinitionUnitError,
  InvalidFieldDefinitionValueTypeError,
  InvalidResolutionPolicyError,
  createFieldDefinition,
  findCoreFieldDefinition,
  listCoreFieldDefinitions,
} from "../src/index.js";
import {
  DuplicateCoreFieldDefinitionError,
  createReadOnlyFieldDefinitionRegistry,
} from "../src/core-field-definition-registry.js";

function definitionInput(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    fieldPath: "printer.nozzle.diameter",
    targetType: "printer_state",
    valueType: "number",
    unit: "mm",
    resolutionPolicy: { kind: "exact_match" },
    ...overrides,
  };
}

describe("createFieldDefinition", () => {
  it("creates a deeply frozen defensive copy for a numeric unit definition", () => {
    const resolutionPolicy = { kind: "safety_upper_bound" as const };
    const input = definitionInput({ resolutionPolicy });
    const result = createFieldDefinition(input);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.resolutionPolicy).not.toBe(resolutionPolicy);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.resolutionPolicy)).toBe(true);
  });

  it.each<[FieldDefinitionValueType]>([["string"], ["boolean"]])(
    "accepts a unitless %s definition",
    (valueType) => {
      expect(createFieldDefinition(definitionInput({ valueType, unit: undefined }))).toEqual({
        fieldPath: "printer.nozzle.diameter",
        targetType: "printer_state",
        valueType,
        resolutionPolicy: { kind: "exact_match" },
      });
    }
  );

  it.each<FieldDefinitionTargetType>(["printer_state", "component_installation"])(
    "accepts target type %s",
    (targetType) => {
      expect(createFieldDefinition(definitionInput({ targetType })).targetType).toBe(targetType);
    }
  );

  it.each<ResolutionPolicyKind>([
    "exact_match",
    "installed_hardware_confirmation",
    "safety_upper_bound",
    "safety_lower_bound",
  ])("accepts policy %s", (kind) => {
    expect(
      createFieldDefinition(definitionInput({ resolutionPolicy: { kind } })).resolutionPolicy.kind
    ).toBe(kind);
  });

  it.each(["field", ".printer.nozzle", "Printer.nozzle", "printer..nozzle"])(
    "rejects malformed path %s",
    (fieldPath) => {
      expect(() => createFieldDefinition(definitionInput({ fieldPath }))).toThrow(
        InvalidFieldDefinitionPathError
      );
    }
  );

  it("rejects invalid runtime target and value types", () => {
    expect(() =>
      createFieldDefinition(definitionInput({ targetType: "printer" as FieldDefinitionTargetType }))
    ).toThrow(InvalidFieldDefinitionTargetTypeError);
    expect(() =>
      createFieldDefinition(definitionInput({ valueType: "object" as FieldDefinitionValueType }))
    ).toThrow(InvalidFieldDefinitionValueTypeError);
  });

  it("rejects unsupported and scalar-incompatible units", () => {
    expect(() => createFieldDefinition(definitionInput({ unit: "cm" as CanonicalUnit }))).toThrow(
      InvalidFieldDefinitionUnitError
    );
    expect(() =>
      createFieldDefinition(definitionInput({ valueType: "string", unit: "mm" }))
    ).toThrow(InvalidFieldDefinitionUnitError);
    expect(() =>
      createFieldDefinition(definitionInput({ valueType: "boolean", unit: "ratio" }))
    ).toThrow(InvalidFieldDefinitionUnitError);
  });

  it("rejects malformed policies and unsupported extra semantics", () => {
    expect(() =>
      createFieldDefinition(
        definitionInput({ resolutionPolicy: { kind: "callback" as ResolutionPolicyKind } })
      )
    ).toThrow(InvalidResolutionPolicyError);
    expect(() =>
      createFieldDefinition({ ...definitionInput(), label: "Nozzle" } as FieldDefinition)
    ).toThrow(InvalidFieldDefinitionShapeError);
  });
});

const EXPECTED_CORE_DEFINITIONS = [
  ["component.probe.offset.x", "component_installation", "number", "mm", "exact_match"],
  ["firmware.motion.max-acceleration", "printer_state", "number", "mm/s2", "exact_match"],
  ["firmware.motion.max-velocity", "printer_state", "number", "mm/s", "exact_match"],
  ["firmware.type", "printer_state", "string", undefined, "exact_match"],
  ["printer.bed.max-temperature", "printer_state", "number", "degC", "safety_upper_bound"],
  [
    "printer.extruder.type",
    "printer_state",
    "string",
    undefined,
    "installed_hardware_confirmation",
  ],
  ["printer.hotend.max-temperature", "printer_state", "number", "degC", "safety_upper_bound"],
  ["printer.nozzle.diameter", "printer_state", "number", "mm", "installed_hardware_confirmation"],
  ["slicer.layer-height", "printer_state", "number", "mm", "exact_match"],
  ["slicer.retraction.distance", "printer_state", "number", "mm", "exact_match"],
  ["slicer.retraction.speed", "printer_state", "number", "mm/s", "exact_match"],
] as const;

describe("Core FieldDefinition registry", () => {
  it("contains exactly the documented definitions in fieldPath order", () => {
    const actual = listCoreFieldDefinitions().map((definition) => [
      definition.fieldPath,
      definition.targetType,
      definition.valueType,
      definition.unit,
      definition.resolutionPolicy.kind,
    ]);
    expect(actual).toEqual(EXPECTED_CORE_DEFINITIONS);
  });

  it.each(EXPECTED_CORE_DEFINITIONS)("finds the exact definition for %s", (fieldPath) => {
    expect(findCoreFieldDefinition(fieldPath)?.fieldPath).toBe(fieldPath);
  });

  it("returns undefined for valid unknown and extension paths", () => {
    expect(findCoreFieldDefinition("printer.unknown.field")).toBeUndefined();
    expect(findCoreFieldDefinition("extension.klipper.some-field")).toBeUndefined();
  });

  it("rejects malformed lookup paths without normalizing them", () => {
    expect(() => findCoreFieldDefinition(" printer.nozzle.diameter")).toThrow(
      InvalidFieldDefinitionPathError
    );
  });

  it("does not expose mutable registry state", () => {
    const definitions = listCoreFieldDefinitions();
    expect(Object.isFrozen(definitions)).toBe(true);
    expect(definitions.every(Object.isFrozen)).toBe(true);
    expect(definitions.every((definition) => Object.isFrozen(definition.resolutionPolicy))).toBe(
      true
    );
    expect(() => (definitions as FieldDefinition[]).pop()).toThrow(TypeError);
  });

  it("rejects duplicate paths during construction", () => {
    const definition = definitionInput();
    expect(() => createReadOnlyFieldDefinitionRegistry([definition, definition])).toThrow(
      DuplicateCoreFieldDefinitionError
    );
  });

  it("keeps documented safety fields on the safety upper-bound policy", () => {
    expect(findCoreFieldDefinition("printer.hotend.max-temperature")?.resolutionPolicy.kind).toBe(
      "safety_upper_bound"
    );
    expect(findCoreFieldDefinition("printer.bed.max-temperature")?.resolutionPolicy.kind).toBe(
      "safety_upper_bound"
    );
  });
});
