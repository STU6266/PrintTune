import type {
  CanonicalUnit,
  FieldClaimValue,
  PackageFieldFactV1,
  PrinterSeriesKnowledgePackageV1,
} from "@printtune/contracts";
import { describe, expect, it } from "vitest";

import {
  InvalidPrinterSeriesEffectiveFactsError,
  InvalidPrinterSeriesPackageCoreCompatibilityError,
  UnknownPrinterSeriesModelError,
  getEffectivePrinterSeriesFacts,
  validatePrinterSeriesPackageCoreCompatibility,
} from "../src/index";

function fact(
  factId: string,
  fieldPath: string,
  value: FieldClaimValue,
  unit?: CanonicalUnit
): PackageFieldFactV1 {
  return { factId, fieldPath, value, ...(unit === undefined ? {} : { unit }) };
}

function syntheticPackage(): PrinterSeriesKnowledgePackageV1 {
  return {
    formatVersion: 1,
    packageId: "example.synthetic-printer-series",
    packageVersion: "synthetic-v1",
    packageType: "printer_series",
    displayName: "Synthetic Printer Series",
    publisher: {
      publisherId: "example.synthetic-publisher",
      publisherDisplayName: "Synthetic Publisher",
    },
    coreCompatibility: { minimumVersion: "1.0.0" },
    payload: {
      series: {
        seriesDefinitionId: "synthetic-series",
        manufacturerDisplayName: "Synthetic Manufacturer",
        seriesDisplayName: "Synthetic Series",
        facts: [
          fact("series-nozzle", "printer.nozzle.diameter", { type: "number", value: 12 }, "mm"),
          fact("series-extruder", "printer.extruder.type", {
            type: "string",
            value: "synthetic-extruder",
          }),
          fact(
            "series-hotend-limit",
            "printer.hotend.max-temperature",
            { type: "number", value: 123 },
            "degC"
          ),
          fact("series-firmware", "firmware.type", { type: "string", value: "synthetic" }),
          fact(
            "series-retraction",
            "slicer.retraction.distance",
            { type: "number", value: 7 },
            "mm"
          ),
        ],
        models: [
          {
            modelDefinitionId: "pt-demo-a",
            modelDisplayName: "PT-Demo A",
            facts: [
              fact(
                "model-a-nozzle",
                "printer.nozzle.diameter",
                { type: "number", value: 34 },
                "mm"
              ),
              fact(
                "model-a-velocity",
                "firmware.motion.max-velocity",
                { type: "number", value: 56 },
                "mm/s"
              ),
            ],
          },
          {
            modelDefinitionId: "pt-demo-b",
            modelDisplayName: "PT-Demo B",
            facts: [
              fact(
                "model-b-hotend-limit",
                "printer.hotend.max-temperature",
                { type: "number", value: 111 },
                "degC"
              ),
            ],
          },
        ],
      },
    },
  };
}

function mutablePackage(): PrinterSeriesKnowledgePackageV1 {
  return structuredClone(syntheticPackage());
}

function expectCompatibilityIssue(
  value: PrinterSeriesKnowledgePackageV1,
  code: string
): InvalidPrinterSeriesPackageCoreCompatibilityError {
  try {
    validatePrinterSeriesPackageCoreCompatibility(value);
    expect.fail("Expected Core compatibility validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidPrinterSeriesPackageCoreCompatibilityError);
    const typed = error as InvalidPrinterSeriesPackageCoreCompatibilityError;
    expect(typed.issues.map((current) => current.code)).toContain(code);
    return typed;
  }
}

describe("printer-series Core FieldDefinition compatibility", () => {
  it("accepts numeric mm, numeric degC, string, and all model facts", () => {
    const value = syntheticPackage();
    expect(validatePrinterSeriesPackageCoreCompatibility(value)).toBe(value);
  });

  it("rejects a syntactically valid unknown Core field", () => {
    const value = mutablePackage();
    (value.payload.series.facts[0] as { fieldPath: string }).fieldPath =
      "extension.synthetic.future-value";
    const error = expectCompatibilityIssue(value, "unknown_field_definition");
    expect(error.issues[0]).toMatchObject({
      factId: "series-nozzle",
      fieldPath: "extension.synthetic.future-value",
    });
  });

  it("rejects a Core field targeting component_installation", () => {
    const value = mutablePackage();
    const target = value.payload.series.facts[0] as {
      fieldPath: string;
      value: FieldClaimValue;
      unit?: CanonicalUnit;
    };
    target.fieldPath = "component.probe.offset.x";
    target.value = { type: "number", value: 1 };
    target.unit = "mm";
    expectCompatibilityIssue(value, "invalid_target_type");
  });

  it.each([
    ["number field with string", "printer.nozzle.diameter", { type: "string", value: "12" }],
    ["string field with number", "printer.extruder.type", { type: "number", value: 12 }],
  ] as const)("rejects %s", (_label, fieldPath, incompatibleValue) => {
    const value = mutablePackage();
    const target = value.payload.series.facts[0] as {
      fieldPath: string;
      value: FieldClaimValue;
      unit?: CanonicalUnit;
    };
    target.fieldPath = fieldPath;
    target.value = incompatibleValue;
    delete target.unit;
    expectCompatibilityIssue(value, "incompatible_value_type");
  });

  it("rejects a wrong canonical unit", () => {
    const value = mutablePackage();
    (value.payload.series.facts[0] as { unit: CanonicalUnit }).unit = "degC";
    expectCompatibilityIssue(value, "incompatible_unit");
  });

  it("rejects a missing required canonical unit", () => {
    const value = mutablePackage();
    delete (value.payload.series.facts[0] as { unit?: CanonicalUnit }).unit;
    expectCompatibilityIssue(value, "incompatible_unit");
  });

  it("fails safely if an unsafe caller supplies a unit on a unitless string fact", () => {
    const value = mutablePackage();
    (value.payload.series.facts[1] as unknown as { unit: CanonicalUnit }).unit = "mm";
    expectCompatibilityIssue(value, "incompatible_unit");
  });

  it("validates incompatible facts in unselected model variants", () => {
    const value = mutablePackage();
    (value.payload.series.models[1].facts[0] as { value: FieldClaimValue }).value = {
      type: "string",
      value: "not-a-number",
    };
    expectCompatibilityIssue(value, "incompatible_value_type");
  });

  it("returns multiple issues in deterministic path/code order with fact identity", () => {
    const value = mutablePackage();
    (value.payload.series.facts[0] as { value: FieldClaimValue }).value = {
      type: "string",
      value: "wrong",
    };
    (value.payload.series.models[0].facts[1] as { fieldPath: string }).fieldPath =
      "extension.synthetic.unknown";

    const error = expectCompatibilityIssue(value, "unknown_field_definition");
    expect(error.issues).toEqual([
      {
        path: "/payload/series/facts/0",
        factId: "series-nozzle",
        fieldPath: "printer.nozzle.diameter",
        code: "incompatible_value_type",
        message: "Fact scalar type does not match the Core FieldDefinition",
      },
      {
        path: "/payload/series/models/0/facts/1",
        factId: "model-a-velocity",
        fieldPath: "extension.synthetic.unknown",
        code: "unknown_field_definition",
        message: "Core FieldDefinition is unknown",
      },
    ]);
    expect(Object.isFrozen(error.issues)).toBe(true);
    expect(error.issues.every(Object.isFrozen)).toBe(true);
  });
});

describe("deterministic effective printer-series facts", () => {
  it("returns exactly series facts without a model selection, sorted by fieldPath", () => {
    const value = syntheticPackage();
    const effective = getEffectivePrinterSeriesFacts(value);
    expect(effective.map(({ factId }) => factId)).toEqual([
      "series-firmware",
      "series-extruder",
      "series-hotend-limit",
      "series-nozzle",
      "series-retraction",
    ]);
  });

  it("adds model-only facts and replaces a matching series fact", () => {
    const effective = getEffectivePrinterSeriesFacts(syntheticPackage(), "pt-demo-a");
    expect(effective.map(({ factId }) => factId)).toEqual([
      "model-a-velocity",
      "series-firmware",
      "series-extruder",
      "series-hotend-limit",
      "model-a-nozzle",
      "series-retraction",
    ]);
    expect(effective.find(({ fieldPath }) => fieldPath === "printer.nozzle.diameter")).toEqual(
      fact("model-a-nozzle", "printer.nozzle.diameter", { type: "number", value: 34 }, "mm")
    );
  });

  it("applies multiple selected-model overrides while preserving every winning factId", () => {
    const value = mutablePackage();
    (value.payload.series.models[0].facts as PackageFactArray).push(
      fact(
        "model-a-hotend",
        "printer.hotend.max-temperature",
        { type: "number", value: 99 },
        "degC"
      )
    );
    const effective = getEffectivePrinterSeriesFacts(value, "pt-demo-a");
    expect(
      effective.filter(({ factId }) => factId.startsWith("model-a")).map(({ factId }) => factId)
    ).toEqual(["model-a-velocity", "model-a-hotend", "model-a-nozzle"]);
  });

  it("does not include facts from unselected model variants", () => {
    const effective = getEffectivePrinterSeriesFacts(syntheticPackage(), "pt-demo-a");
    expect(effective.some(({ factId }) => factId.startsWith("model-b"))).toBe(false);
  });

  it("rejects an unknown model without falling back", () => {
    expect(() => getEffectivePrinterSeriesFacts(syntheticPackage(), "missing-model")).toThrow(
      UnknownPrinterSeriesModelError
    );
  });

  it("returns frozen defensive facts and leaves the package unchanged", () => {
    const value = mutablePackage();
    const before = structuredClone(value);
    const effective = getEffectivePrinterSeriesFacts(value, "pt-demo-a");

    expect(value).toEqual(before);
    expect(Object.isFrozen(effective)).toBe(true);
    expect(effective.every(Object.isFrozen)).toBe(true);
    expect(effective.every(({ value: scalar }) => Object.isFrozen(scalar))).toBe(true);
    (value.payload.series.facts[1].value as { value: string }).value = "mutated";
    expect(effective.find(({ factId }) => factId === "series-extruder")?.value).toEqual({
      type: "string",
      value: "synthetic-extruder",
    });
    expect(effective.find(({ factId }) => factId === "model-a-nozzle")?.value).toEqual({
      type: "number",
      value: 34,
    });
  });

  it("has stable semantic output when authored fact order changes", () => {
    const first = mutablePackage();
    const reordered = mutablePackage();
    (reordered.payload.series.facts as PackageFactArray).reverse();
    (reordered.payload.series.models[0].facts as PackageFactArray).reverse();

    expect(getEffectivePrinterSeriesFacts(reordered, "pt-demo-a")).toEqual(
      getEffectivePrinterSeriesFacts(first, "pt-demo-a")
    );
  });

  it("fails safely rather than choosing duplicate paths by array order", () => {
    const value = mutablePackage();
    (value.payload.series.facts as PackageFactArray).push({
      ...value.payload.series.facts[0],
      factId: "unsafe-duplicate",
    });
    expect(() => getEffectivePrinterSeriesFacts(value)).toThrow(
      InvalidPrinterSeriesEffectiveFactsError
    );
  });
});

type PackageFactArray = PackageFieldFactV1[];
