import type {
  CanonicalUnit,
  FieldClaimValue,
  PackageFieldFactV1,
  PrinterKnowledgeIdentity,
  PrinterSeriesKnowledgePackageV1,
  PrinterState,
} from "@printtune/contracts";
import { createPrinterKnowledgeIdentity, createPrinterState } from "@printtune/core";
import { describe, expect, it, vi } from "vitest";

import {
  PrinterSeriesPackageClaimMaterializationError,
  materializePrinterSeriesPackageClaims,
  type MaterializePrinterSeriesPackageClaimsInput,
} from "../src/index";

const CREATED_AT = "2026-08-09T12:00:00.123Z";

function fact(
  factId: string,
  fieldPath: string,
  value: FieldClaimValue,
  unit?: CanonicalUnit
): PackageFieldFactV1 {
  return { factId, fieldPath, value, ...(unit === undefined ? {} : { unit }) };
}

function packageFixture(): PrinterSeriesKnowledgePackageV1 {
  return {
    formatVersion: 1,
    packageId: "example.synthetic-series",
    packageVersion: "opaque-v1",
    packageType: "printer_series",
    displayName: "Synthetic Series",
    publisher: {
      publisherId: "example.publisher",
      publisherDisplayName: "Synthetic Publisher",
    },
    coreCompatibility: { minimumVersion: "1.0.0" },
    payload: {
      series: {
        seriesDefinitionId: "series-a",
        manufacturerDisplayName: "Synthetic Manufacturer",
        seriesDisplayName: "Synthetic Series",
        facts: [
          fact("series-firmware", "firmware.type", { type: "string", value: "synthetic" }),
          fact("series-nozzle", "printer.nozzle.diameter", { type: "number", value: 12 }, "mm"),
        ],
        models: [
          {
            modelDefinitionId: "model-a",
            modelDisplayName: "Model A",
            facts: [
              fact(
                "model-velocity",
                "firmware.motion.max-velocity",
                { type: "number", value: 34 },
                "mm/s"
              ),
              fact("model-nozzle", "printer.nozzle.diameter", { type: "number", value: 56 }, "mm"),
            ],
          },
          {
            modelDefinitionId: "model-b",
            modelDisplayName: "Model B",
            facts: [
              fact(
                "other-hotend",
                "printer.hotend.max-temperature",
                { type: "number", value: 78 },
                "degC"
              ),
            ],
          },
        ],
      },
    },
  };
}

function knownIdentity(modelDefinitionId?: string): PrinterKnowledgeIdentity {
  return createPrinterKnowledgeIdentity({
    id: "identity-a",
    printerId: "printer-a",
    kind: "known",
    definitionRef: {
      packageId: "example.synthetic-series",
      packageVersion: "opaque-v1",
      seriesDefinitionId: "series-a",
      ...(modelDefinitionId === undefined ? {} : { modelDefinitionId }),
    },
    manufacturerDisplayName: "Synthetic Manufacturer",
    seriesDisplayName: "Synthetic Series",
    ...(modelDefinitionId === undefined ? {} : { modelDisplayName: "Model A" }),
    selectedAt: CREATED_AT,
  });
}

function state(id = "state-a", printerId = "printer-a"): PrinterState {
  return createPrinterState({ id, printerId, timestamp: CREATED_AT });
}

function sequentialIds(prefix = "claim") {
  let next = 0;
  return vi.fn(() => `${prefix}-${++next}`);
}

function input(
  overrides: Partial<MaterializePrinterSeriesPackageClaimsInput> = {}
): MaterializePrinterSeriesPackageClaimsInput {
  return {
    identity: knownIdentity(),
    package: packageFixture(),
    printerState: state(),
    trust: "developer_verified",
    createdAt: CREATED_AT,
    createClaimId: sequentialIds(),
    ...overrides,
  };
}

function expectFailure(
  value: MaterializePrinterSeriesPackageClaimsInput,
  code: PrinterSeriesPackageClaimMaterializationError["code"]
): PrinterSeriesPackageClaimMaterializationError {
  try {
    materializePrinterSeriesPackageClaims(value);
    expect.fail("Expected materialization to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(PrinterSeriesPackageClaimMaterializationError);
    expect(error).toMatchObject({ code });
    return error as PrinterSeriesPackageClaimMaterializationError;
  }
}

describe("materializePrinterSeriesPackageClaims", () => {
  it.each(["developer_verified", "customer_verified"] as const)(
    "materializes series facts with externally supplied %s trust",
    (trust) => {
      const createClaimId = sequentialIds();
      const claims = materializePrinterSeriesPackageClaims(input({ trust, createClaimId }));

      expect(claims).toHaveLength(2);
      expect(claims.map(({ id }) => id)).toEqual(["claim-1", "claim-2"]);
      expect(claims.map(({ fieldPath }) => fieldPath)).toEqual([
        "firmware.type",
        "printer.nozzle.diameter",
      ]);
      expect(claims[0]).toMatchObject({
        target: { type: "printer_state", printerStateId: "state-a" },
        value: { type: "string", value: "synthetic" },
        provenance: {
          sourceType: "knowledge_package",
          sourceRef: {
            type: "knowledge_package",
            packageId: "example.synthetic-series",
            packageVersion: "opaque-v1",
            factId: "series-firmware",
          },
        },
        trust,
        createdAt: CREATED_AT,
      });
      expect(claims[1]).toMatchObject({
        value: { type: "number", value: 12 },
        unit: "mm",
        provenance: { sourceRef: { factId: "series-nozzle" } },
      });
      expect(createClaimId).toHaveBeenCalledTimes(2);
      expect(claims.every(({ createdAt }) => createdAt === CREATED_AT)).toBe(true);
      expect(
        claims.every(
          ({ provenance }) =>
            provenance.sourceRef?.type === "knowledge_package" &&
            provenance.sourceRef.factId !== undefined
        )
      ).toBe(true);
    }
  );

  it("uses exact model overrides and excludes overridden and unselected facts", () => {
    const claims = materializePrinterSeriesPackageClaims(
      input({ identity: knownIdentity("model-a") })
    );

    expect(claims.map(({ fieldPath }) => fieldPath)).toEqual([
      "firmware.motion.max-velocity",
      "firmware.type",
      "printer.nozzle.diameter",
    ]);
    expect(claims.map(({ provenance }) => provenance.sourceRef)).toEqual([
      expect.objectContaining({ factId: "model-velocity" }),
      expect.objectContaining({ factId: "series-firmware" }),
      expect.objectContaining({ factId: "model-nozzle" }),
    ]);
    expect(
      claims.some(
        ({ provenance }) =>
          provenance.sourceRef?.type === "knowledge_package" &&
          provenance.sourceRef.factId === "series-nozzle"
      )
    ).toBe(false);
    expect(
      claims.some(
        ({ provenance }) =>
          provenance.sourceRef?.type === "knowledge_package" &&
          provenance.sourceRef.factId === "other-hotend"
      )
    ).toBe(false);
  });

  it.each([
    [
      "unclassified",
      {
        identity: createPrinterKnowledgeIdentity({
          id: "u",
          printerId: "printer-a",
          kind: "unclassified",
          selectedAt: CREATED_AT,
        }),
      },
      "identity_not_known",
    ],
    [
      "package ID",
      { package: { ...packageFixture(), packageId: "other" } },
      "package_identity_mismatch",
    ],
    [
      "package version",
      { package: { ...packageFixture(), packageVersion: "opaque-v2" } },
      "package_identity_mismatch",
    ],
    [
      "series",
      {
        package: {
          ...packageFixture(),
          payload: { series: { ...packageFixture().payload.series, seriesDefinitionId: "other" } },
        },
      },
      "series_definition_mismatch",
    ],
    [
      "ownership",
      { printerState: state("state-b", "printer-b") },
      "printer_state_ownership_mismatch",
    ],
    ["model", { identity: knownIdentity("missing-model") }, "model_definition_not_found"],
  ] as const)("rejects %s mismatch before requesting IDs", (_label, overrides, code) => {
    const createClaimId = sequentialIds();
    expectFailure(input({ ...overrides, createClaimId }), code);
    expect(createClaimId).not.toHaveBeenCalled();
  });

  it("rejects invalid runtime trust before requesting IDs", () => {
    const createClaimId = sequentialIds();
    expectFailure(
      input({
        trust: "user_confirmed" as unknown as "developer_verified",
        createClaimId,
      }),
      "invalid_package_trust"
    );
    expect(createClaimId).not.toHaveBeenCalled();
  });

  it("does not infer trust from manifest publisher metadata", () => {
    const value = structuredClone(packageFixture());
    (value.publisher as { publisherId: string; publisherDisplayName: string }).publisherId =
      "developer_verified";
    (
      value.publisher as { publisherId: string; publisherDisplayName: string }
    ).publisherDisplayName = "Claims developer verification";

    const claims = materializePrinterSeriesPackageClaims(
      input({ package: value, trust: "customer_verified" })
    );
    expect(claims.every(({ trust }) => trust === "customer_verified")).toBe(true);
  });

  it("maps incompatible package issues and requests no IDs", () => {
    const value = structuredClone(packageFixture());
    (value.payload.series.facts[1] as { unit: CanonicalUnit }).unit = "degC";
    const createClaimId = sequentialIds();
    const error = expectFailure(input({ package: value, createClaimId }), "incompatible_package");
    expect(error.compatibilityIssues?.map(({ code }) => code)).toContain("incompatible_unit");
    expect(createClaimId).not.toHaveBeenCalled();
  });

  it("rejects invalid batch timestamps before requesting IDs", () => {
    const createClaimId = sequentialIds();
    expectFailure(
      input({ createdAt: "2026-02-30T12:00:00Z", createClaimId }),
      "invalid_materialization_context"
    );
    expect(createClaimId).not.toHaveBeenCalled();
  });

  it("rejects malformed and duplicate generated IDs without returning a partial batch", () => {
    expectFailure(
      input({ createClaimId: vi.fn(() => " invalid") }),
      "invalid_materialization_context"
    );
    expectFailure(
      input({ createClaimId: vi.fn(() => "duplicate") }),
      "invalid_materialization_context"
    );
  });

  it("returns a deeply immutable result without mutating inputs", () => {
    const value = input({ identity: knownIdentity("model-a") });
    const before = structuredClone({
      identity: value.identity,
      package: value.package,
      printerState: value.printerState,
    });
    const claims = materializePrinterSeriesPackageClaims(value);

    expect({
      identity: value.identity,
      package: value.package,
      printerState: value.printerState,
    }).toEqual(before);
    expect(Object.isFrozen(claims)).toBe(true);
    expect(claims.every(Object.isFrozen)).toBe(true);
    expect(
      claims.every(
        ({ target, value: scalar, provenance }) =>
          Object.isFrozen(target) &&
          Object.isFrozen(scalar) &&
          Object.isFrozen(provenance) &&
          Object.isFrozen(provenance.sourceRef)
      )
    ).toBe(true);
  });

  it("returns an immutable empty array for a compatible package with no effective facts", () => {
    const value = packageFixture();
    value.payload.series.facts.length = 0;
    value.payload.series.models.length = 0;
    const createClaimId = sequentialIds();
    const claims = materializePrinterSeriesPackageClaims(input({ package: value, createClaimId }));
    expect(claims).toEqual([]);
    expect(Object.isFrozen(claims)).toBe(true);
    expect(createClaimId).not.toHaveBeenCalled();
  });

  it("allows explicit reapplication to produce independent fresh batches", () => {
    const first = materializePrinterSeriesPackageClaims(
      input({ createClaimId: sequentialIds("first") })
    );
    const second = materializePrinterSeriesPackageClaims(
      input({ createClaimId: sequentialIds("second") })
    );
    expect(first.map(({ id }) => id)).toEqual(["first-1", "first-2"]);
    expect(second.map(({ id }) => id)).toEqual(["second-1", "second-2"]);
    expect(second.map(({ provenance }) => provenance)).toEqual(
      first.map(({ provenance }) => provenance)
    );
  });

  it("targets separate states of the same Printer while preserving fact provenance", () => {
    const first = materializePrinterSeriesPackageClaims(
      input({ printerState: state("state-a"), createClaimId: sequentialIds("a") })
    );
    const second = materializePrinterSeriesPackageClaims(
      input({ printerState: state("state-b"), createClaimId: sequentialIds("b") })
    );
    expect(
      first.every(
        ({ target }) => target.type === "printer_state" && target.printerStateId === "state-a"
      )
    ).toBe(true);
    expect(
      second.every(
        ({ target }) => target.type === "printer_state" && target.printerStateId === "state-b"
      )
    ).toBe(true);
    expect(second.map(({ provenance }) => provenance)).toEqual(
      first.map(({ provenance }) => provenance)
    );
  });
});
