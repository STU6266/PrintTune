import type { PrinterSeriesKnowledgePackageV1 } from "@printtune/contracts";
import { describe, expect, it } from "vitest";

import {
  InvalidKnowledgePackageSemanticsError,
  InvalidKnowledgePackageStructureError,
  MalformedKnowledgePackageJsonError,
  UnsupportedKnowledgePackageFormatVersionError,
  UnsupportedKnowledgePackageTypeError,
  parseKnowledgePackageV1,
  validateKnowledgePackageV1,
} from "../src/index";

function syntheticPackage(models = 1): PrinterSeriesKnowledgePackageV1 {
  return {
    formatVersion: 1,
    packageId: "example.synthetic-printer-series",
    packageVersion: "release/alpha+opaque",
    packageType: "printer_series",
    displayName: "Synthetic Printer Series",
    description: "Synthetic validation fixture",
    publisher: {
      publisherId: "example.synthetic-publisher",
      publisherDisplayName: "Synthetic Publisher",
    },
    coreCompatibility: {
      minimumVersion: "1.0.0",
      maximumVersionExclusive: "2.0.0",
    },
    payload: {
      series: {
        seriesDefinitionId: "synthetic-series",
        manufacturerDisplayName: "Synthetic Manufacturer",
        seriesDisplayName: "Synthetic Printer Series",
        facts: [
          {
            factId: "series-nozzle",
            fieldPath: "printer.nozzle.diameter",
            value: { type: "number", value: 0.4 },
            unit: "mm",
          },
          {
            factId: "series-extruder",
            fieldPath: "printer.extruder.type",
            value: { type: "string", value: "synthetic" },
          },
          {
            factId: "series-feature",
            fieldPath: "printer.synthetic.enabled",
            value: { type: "boolean", value: true },
          },
        ],
        models: Array.from({ length: models }, (_, index) => ({
          modelDefinitionId: `pt-demo-${index + 100}`,
          modelDisplayName: `PT-Demo${index + 100}`,
          facts: [
            {
              factId: `model-${index + 100}-nozzle`,
              fieldPath: "printer.nozzle.diameter",
              value: { type: "number" as const, value: 0.5 + index / 10 },
              unit: "mm" as const,
            },
          ],
        })),
      },
    },
  };
}

function mutablePackage(models = 1): PrinterSeriesKnowledgePackageV1 {
  return structuredClone(syntheticPackage(models));
}

describe("Knowledge Package v1 parsing and structural validation", () => {
  it.each([0, 1, 2])("accepts a synthetic package with %i model variants", (modelCount) => {
    const source = syntheticPackage(modelCount);
    expect(parseKnowledgePackageV1(JSON.stringify(source))).toEqual(source);
  });

  it("preserves opaque packageVersion text exactly", () => {
    expect(parseKnowledgePackageV1(JSON.stringify(syntheticPackage())).packageVersion).toBe(
      "release/alpha+opaque"
    );
  });

  it("accepts omitted optional description and maximum compatibility version", () => {
    const value = mutablePackage() as unknown as {
      description?: string;
      coreCompatibility: { maximumVersionExclusive?: string };
    };
    delete value.description;
    delete value.coreCompatibility.maximumVersionExclusive;
    expect(() => validateKnowledgePackageV1(value)).not.toThrow();
  });

  it("rejects malformed JSON without exposing a raw parser error", () => {
    expect(() => parseKnowledgePackageV1("{/* comment */}")).toThrow(
      MalformedKnowledgePackageJsonError
    );
  });

  it.each(["1", 2, null])("rejects unsupported formatVersion %j explicitly", (formatVersion) => {
    const value = mutablePackage() as unknown as { formatVersion: unknown };
    value.formatVersion = formatVersion;
    expect(() => validateKnowledgePackageV1(value)).toThrow(
      UnsupportedKnowledgePackageFormatVersionError
    );
  });

  it.each(["component_catalog", "firmware", "slicer", "unknown"])(
    "rejects unsupported packageType %s explicitly",
    (packageType) => {
      const value = mutablePackage() as unknown as { packageType: unknown };
      value.packageType = packageType;
      expect(() => validateKnowledgePackageV1(value)).toThrow(UnsupportedKnowledgePackageTypeError);
    }
  );

  it.each([
    ["missing property", (value: Record<string, unknown>) => delete value.displayName],
    [
      "unexpected envelope property",
      (value: Record<string, unknown>) => (value.trust = "developer_verified"),
    ],
    [
      "malformed publisher",
      (value: Record<string, unknown>) => (value.publisher = { publisherId: "publisher" }),
    ],
    [
      "malformed compatibility",
      (value: Record<string, unknown>) =>
        (value.coreCompatibility = { maximumVersionExclusive: "2.0.0" }),
    ],
    ["malformed series", (value: Record<string, unknown>) => (value.payload = { series: [] })],
  ] as const)("rejects %s", (_label, mutate) => {
    const value = mutablePackage() as unknown as Record<string, unknown>;
    mutate(value);
    expect(() => validateKnowledgePackageV1(value)).toThrow(InvalidKnowledgePackageStructureError);
  });

  it("rejects malformed model objects", () => {
    const value = mutablePackage();
    (value.payload.series.models as unknown as unknown[])[0] = {
      modelDefinitionId: "model-a",
      facts: [],
    };
    expect(() => validateKnowledgePackageV1(value)).toThrow(InvalidKnowledgePackageStructureError);
  });

  it.each([
    { type: "decimal", value: 0.4 },
    { type: "number", value: "0.4" },
    { type: "string", value: null },
    { type: "boolean", value: [] },
  ])("rejects malformed scalar values: %j", (scalar) => {
    const value = mutablePackage();
    (value.payload.series.facts[0] as unknown as { value: unknown }).value = scalar;
    expect(() => validateKnowledgePackageV1(value)).toThrow(InvalidKnowledgePackageStructureError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects runtime non-finite number %s",
    (number) => {
      const value = mutablePackage();
      (value.payload.series.facts[0].value as { value: number }).value = number;
      expect(() => validateKnowledgePackageV1(value)).toThrow(
        InvalidKnowledgePackageStructureError
      );
    }
  );

  it("rejects unsupported units and units on non-numeric values", () => {
    const unsupported = mutablePackage();
    (unsupported.payload.series.facts[0] as unknown as { unit: string }).unit = "inch";
    expect(() => validateKnowledgePackageV1(unsupported)).toThrow(
      InvalidKnowledgePackageStructureError
    );

    const stringUnit = mutablePackage();
    (stringUnit.payload.series.facts[1] as unknown as { unit: string }).unit = "mm";
    expect(() => validateKnowledgePackageV1(stringUnit)).toThrow(
      InvalidKnowledgePackageStructureError
    );
  });

  it.each(["Printer.nozzle.diameter", "printer", "printer..diameter", "printer.nozzle_diameter"])(
    "rejects malformed canonical field path %s",
    (fieldPath) => {
      const value = mutablePackage();
      (value.payload.series.facts[0] as { fieldPath: string }).fieldPath = fieldPath;
      expect(() => validateKnowledgePackageV1(value)).toThrow(
        InvalidKnowledgePackageStructureError
      );
    }
  );

  it("rejects unexpected nested properties", () => {
    const value = mutablePackage();
    (value.payload.series.models[0] as unknown as { alias: string }).alias = "typo";
    (value.payload.series.facts[0].value as unknown as { unit: string }).unit = "mm";
    expect(() => validateKnowledgePackageV1(value)).toThrow(InvalidKnowledgePackageStructureError);
  });
});

describe("Knowledge Package v1 package-semantic validation", () => {
  function expectSemanticIssue(value: unknown, code: string): void {
    try {
      validateKnowledgePackageV1(value);
      expect.fail("Expected semantic validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidKnowledgePackageSemanticsError);
      expect(
        (error as InvalidKnowledgePackageSemanticsError).issues.map((issue) => issue.code)
      ).toContain(code);
    }
  }

  it.each([
    [
      "packageId",
      (value: PrinterSeriesKnowledgePackageV1) =>
        ((value as { packageId: string }).packageId = " package "),
    ],
    [
      "packageVersion",
      (value: PrinterSeriesKnowledgePackageV1) =>
        ((value as { packageVersion: string }).packageVersion = " version "),
    ],
    [
      "seriesDefinitionId",
      (value: PrinterSeriesKnowledgePackageV1) =>
        ((value.payload.series as { seriesDefinitionId: string }).seriesDefinitionId = " series "),
    ],
    [
      "modelDefinitionId",
      (value: PrinterSeriesKnowledgePackageV1) =>
        ((value.payload.series.models[0] as { modelDefinitionId: string }).modelDefinitionId =
          " model "),
    ],
    [
      "factId",
      (value: PrinterSeriesKnowledgePackageV1) =>
        ((value.payload.series.facts[0] as { factId: string }).factId = " fact "),
    ],
  ] as const)("rejects non-normalized %s", (_label, mutate) => {
    const value = mutablePackage();
    mutate(value);
    expectSemanticIssue(value, "invalid_normalized_id");
  });

  it("rejects duplicate modelDefinitionId", () => {
    const value = mutablePackage(2);
    (value.payload.series.models[1] as { modelDefinitionId: string }).modelDefinitionId =
      value.payload.series.models[0].modelDefinitionId;
    expectSemanticIssue(value, "duplicate_model_definition_id");
  });

  it.each([
    [
      "within series",
      (value: PrinterSeriesKnowledgePackageV1) =>
        ((value.payload.series.facts[1] as { factId: string }).factId =
          value.payload.series.facts[0].factId),
    ],
    [
      "across series and model",
      (value: PrinterSeriesKnowledgePackageV1) =>
        ((value.payload.series.models[0].facts[0] as { factId: string }).factId =
          value.payload.series.facts[0].factId),
    ],
    [
      "across two models",
      (value: PrinterSeriesKnowledgePackageV1) =>
        ((value.payload.series.models[1].facts[0] as { factId: string }).factId =
          value.payload.series.models[0].facts[0].factId),
    ],
  ] as const)("rejects duplicate factId %s", (_label, mutate) => {
    const value = mutablePackage(2);
    mutate(value);
    expectSemanticIssue(value, "duplicate_fact_id");
  });

  it("rejects duplicate series fieldPath", () => {
    const value = mutablePackage();
    (value.payload.series.facts[1] as { fieldPath: string }).fieldPath =
      value.payload.series.facts[0].fieldPath;
    expectSemanticIssue(value, "duplicate_field_path");
  });

  it("rejects duplicate fieldPath within one model", () => {
    const value = mutablePackage();
    const existing = value.payload.series.models[0].facts[0];
    (value.payload.series.models[0].facts as PackageFactArray).push({
      ...existing,
      factId: "another-model-fact",
    });
    expectSemanticIssue(value, "duplicate_field_path");
  });

  it("allows the same fieldPath at series and selected-model scope", () => {
    expect(() => validateKnowledgePackageV1(mutablePackage())).not.toThrow();
  });

  it("allows the same fieldPath in different models", () => {
    expect(() => validateKnowledgePackageV1(mutablePackage(2))).not.toThrow();
  });

  it.each([
    ["invalid minimum", "not-semver", "2.0.0", "invalid_semver"],
    ["invalid maximum", "1.0.0", "v2", "invalid_semver"],
    ["equal interval", "1.0.0", "1.0.0", "invalid_compatibility_interval"],
    ["reversed interval", "2.0.0", "1.0.0", "invalid_compatibility_interval"],
  ])("rejects %s", (_label, minimumVersion, maximumVersionExclusive, code) => {
    const value = mutablePackage();
    (value.coreCompatibility as { minimumVersion: string }).minimumVersion = minimumVersion;
    (value.coreCompatibility as { maximumVersionExclusive: string }).maximumVersionExclusive =
      maximumVersionExclusive;
    expectSemanticIssue(value, code);
  });

  it("reports multiple semantic issues deterministically", () => {
    const value = mutablePackage(2);
    (value.payload.series.models[1] as { modelDefinitionId: string }).modelDefinitionId =
      value.payload.series.models[0].modelDefinitionId;
    (value.payload.series.models[1].facts[0] as { factId: string }).factId =
      value.payload.series.models[0].facts[0].factId;

    try {
      validateKnowledgePackageV1(value);
      expect.fail("Expected semantic validation to fail");
    } catch (error) {
      expect((error as InvalidKnowledgePackageSemanticsError).issues).toEqual([
        {
          path: "/payload/series/models/1/facts/0/factId",
          code: "duplicate_fact_id",
          message: "factId must be unique across the package",
        },
        {
          path: "/payload/series/models/1/modelDefinitionId",
          code: "duplicate_model_definition_id",
          message: "modelDefinitionId must be unique within the package",
        },
      ]);
    }
  });
});

describe("Knowledge Package v1 accepted-value immutability", () => {
  it("returns a defensive deeply frozen package", () => {
    const source = mutablePackage();
    const accepted = validateKnowledgePackageV1(source);
    (source.publisher as { publisherDisplayName: string }).publisherDisplayName = "Changed";
    (source.payload.series.facts[0].value as { value: number }).value = 9;

    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted.publisher)).toBe(true);
    expect(Object.isFrozen(accepted.coreCompatibility)).toBe(true);
    expect(Object.isFrozen(accepted.payload)).toBe(true);
    expect(Object.isFrozen(accepted.payload.series)).toBe(true);
    expect(Object.isFrozen(accepted.payload.series.facts)).toBe(true);
    expect(Object.isFrozen(accepted.payload.series.facts[0])).toBe(true);
    expect(Object.isFrozen(accepted.payload.series.facts[0].value)).toBe(true);
    expect(Object.isFrozen(accepted.payload.series.models)).toBe(true);
    expect(Object.isFrozen(accepted.payload.series.models[0].facts)).toBe(true);
    expect(accepted.publisher.publisherDisplayName).toBe("Synthetic Publisher");
    expect(accepted.payload.series.facts[0].value).toEqual({ type: "number", value: 0.4 });
    expect(() => {
      (accepted.publisher as { publisherDisplayName: string }).publisherDisplayName = "Mutation";
    }).toThrow();
  });
});

type PackageFactArray = Array<
  PrinterSeriesKnowledgePackageV1["payload"]["series"]["facts"][number]
>;
