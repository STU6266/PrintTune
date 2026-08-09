import type {
  ClaimProvenance,
  ClaimSourceType,
  ClaimTrust,
  FieldClaimTarget,
  FieldClaimValue,
} from "@printtune/contracts";
import { describe, expect, it } from "vitest";

import * as core from "../src/index.js";
import {
  InvalidFieldClaimConfidenceError,
  InvalidFieldClaimIdError,
  InvalidFieldClaimPathError,
  InvalidFieldClaimProvenanceError,
  InvalidFieldClaimTargetError,
  InvalidFieldClaimTimestampError,
  InvalidFieldClaimTrustError,
  InvalidFieldClaimUnitError,
  InvalidFieldClaimValueError,
  createFieldClaim,
  type CreateFieldClaimInput,
} from "../src/field-claim.js";

const TIMESTAMP = "2026-08-09T08:30:00.123Z";

function validInput(overrides: Partial<CreateFieldClaimInput> = {}): CreateFieldClaimInput {
  return {
    id: "claim-1",
    target: { type: "printer_state", printerStateId: "state-1" },
    fieldPath: "printer.nozzle.diameter",
    value: { type: "number", value: 0.4 },
    unit: "mm",
    provenance: {
      sourceType: "knowledge_package",
      sourceRef: { type: "knowledge_package", packageId: "base", packageVersion: "1.0.0" },
    },
    trust: "developer_verified",
    timestamp: TIMESTAMP,
    ...overrides,
  };
}

describe("createFieldClaim", () => {
  it("creates a deterministic PrinterState-target claim", () => {
    expect(createFieldClaim(validInput())).toEqual({
      id: "claim-1",
      target: { type: "printer_state", printerStateId: "state-1" },
      fieldPath: "printer.nozzle.diameter",
      value: { type: "number", value: 0.4 },
      unit: "mm",
      provenance: {
        sourceType: "knowledge_package",
        sourceRef: { type: "knowledge_package", packageId: "base", packageVersion: "1.0.0" },
      },
      trust: "developer_verified",
      createdAt: TIMESTAMP,
    });
  });

  it("creates a ComponentInstallation-target claim without looking up the target", () => {
    const target: FieldClaimTarget = {
      type: "component_installation",
      componentInstallationId: "installation-not-stored",
    };

    expect(createFieldClaim(validInput({ target })).target).toEqual(target);
  });

  it("rejects invalid IDs and targets", () => {
    expect(() => createFieldClaim(validInput({ id: " claim-1" }))).toThrow(
      InvalidFieldClaimIdError
    );
    expect(() =>
      createFieldClaim(validInput({ target: { type: "printer_state", printerStateId: " " } }))
    ).toThrow(InvalidFieldClaimTargetError);
    expect(() =>
      createFieldClaim(
        validInput({
          target: {
            type: "printer_state",
            printerStateId: "state-1",
            extra: true,
          } as unknown as FieldClaimTarget,
        })
      )
    ).toThrow(InvalidFieldClaimTargetError);
  });

  it.each<[FieldClaimValue]>([
    [{ type: "string", value: "direct_drive" }],
    [{ type: "number", value: 12.5 }],
    [{ type: "boolean", value: true }],
  ])("accepts typed scalar value %#", (value) => {
    const input = validInput({ value });
    delete (input as { unit?: unknown }).unit;
    expect(createFieldClaim(input).value).toEqual(value);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite number %s",
    (value) => {
      expect(() => createFieldClaim(validInput({ value: { type: "number", value } }))).toThrow(
        InvalidFieldClaimValueError
      );
    }
  );

  it.each([
    { type: "object", value: {} },
    { type: "string", value: [] },
    ["string", "value"],
    null,
  ])("rejects non-scalar runtime value %#", (value) => {
    expect(() =>
      createFieldClaim(validInput({ value: value as unknown as FieldClaimValue }))
    ).toThrow(InvalidFieldClaimValueError);
  });

  it.each([
    "printer.nozzle.diameter",
    "printer.extruder.type",
    "printer.hotend.max-temperature",
    "firmware.type",
    "slicer.retraction.distance",
    "extension.klipper.some-field",
  ])("accepts canonical field path %s", (fieldPath) => {
    expect(createFieldClaim(validInput({ fieldPath })).fieldPath).toBe(fieldPath);
  });

  it.each([
    "Printer.nozzle.diameter",
    "printer.nozzle diameter",
    "printer..diameter",
    ".printer.nozzle",
    "printer.nozzle.",
    " printer.nozzle.diameter",
    "printer.nozzle.diameter ",
    "printer",
  ])("rejects malformed field path %s", (fieldPath) => {
    expect(() => createFieldClaim(validInput({ fieldPath }))).toThrow(InvalidFieldClaimPathError);
  });

  it.each(["mm", "mm/s", "mm/s2", "degC", "mm3/s", "ratio"] as const)(
    "accepts canonical numeric unit %s",
    (unit) => {
      expect(createFieldClaim(validInput({ unit })).unit).toBe(unit);
    }
  );

  it("accepts unitless string and boolean values", () => {
    expect(
      createFieldClaim(validInput({ value: { type: "string", value: "klipper" }, unit: undefined }))
    ).not.toHaveProperty("unit");
    expect(
      createFieldClaim(validInput({ value: { type: "boolean", value: true }, unit: undefined }))
    ).not.toHaveProperty("unit");
  });

  it("rejects unsupported units and units on non-numeric values", () => {
    expect(() => createFieldClaim(validInput({ unit: "cm" as unknown as "mm" }))).toThrow(
      InvalidFieldClaimUnitError
    );
    expect(() =>
      createFieldClaim(validInput({ value: { type: "string", value: "0.4 mm" }, unit: "mm" }))
    ).toThrow(InvalidFieldClaimUnitError);
  });

  const provenanceCases: readonly [ClaimSourceType, ClaimProvenance][] = [
    ["user_confirmed", { sourceType: "user_confirmed" }],
    ["user_entered", { sourceType: "user_entered" }],
    [
      "imported_file",
      { sourceType: "imported_file", sourceRef: { type: "import_snapshot", id: "import-1" } },
    ],
    [
      "slicer_profile",
      {
        sourceType: "slicer_profile",
        sourceRef: { type: "slicer_profile_snapshot", id: "slicer-snapshot-1" },
      },
    ],
    [
      "firmware_read",
      {
        sourceType: "firmware_read",
        sourceRef: { type: "firmware_snapshot", id: "firmware-snapshot-1" },
      },
    ],
    [
      "knowledge_package",
      {
        sourceType: "knowledge_package",
        sourceRef: { type: "knowledge_package", packageId: "official", packageVersion: "2.0.0" },
      },
    ],
    [
      "component_definition",
      {
        sourceType: "component_definition",
        sourceRef: {
          type: "component_definition",
          packageId: "official",
          packageVersion: "2.0.0",
          definitionId: "hotend-1",
        },
      },
    ],
    [
      "test_result",
      { sourceType: "test_result", sourceRef: { type: "test_run", id: "test-run-1" } },
    ],
    ["ai_unverified", { sourceType: "ai_unverified" }],
  ];

  it.each(provenanceCases)("accepts %s provenance", (_sourceType, provenance) => {
    expect(createFieldClaim(validInput({ provenance })).provenance).toEqual(provenance);
  });

  it("rejects missing, mismatched, and arbitrary provenance references", () => {
    expect(() =>
      createFieldClaim(
        validInput({ provenance: { sourceType: "knowledge_package" } as ClaimProvenance })
      )
    ).toThrow(InvalidFieldClaimProvenanceError);
    expect(() =>
      createFieldClaim(
        validInput({
          provenance: {
            sourceType: "imported_file",
            sourceRef: { type: "test_run", id: "wrong-kind" },
          },
        })
      )
    ).toThrow(InvalidFieldClaimProvenanceError);
    expect(() =>
      createFieldClaim(
        validInput({
          provenance: { sourceType: "unknown" } as unknown as ClaimProvenance,
        })
      )
    ).toThrow(InvalidFieldClaimProvenanceError);
  });

  it.each<ClaimTrust>([
    "developer_verified",
    "customer_verified",
    "user_confirmed",
    "user_entered",
    "imported_observation",
    "ai_generated_unverified",
  ])("accepts trust category %s", (trust) => {
    expect(createFieldClaim(validInput({ trust })).trust).toBe(trust);
  });

  it("rejects an unknown trust category", () => {
    expect(() =>
      createFieldClaim(validInput({ trust: "trusted" as unknown as ClaimTrust }))
    ).toThrow(InvalidFieldClaimTrustError);
  });

  it.each([undefined, 0, 0.4, 1])("accepts confidence %s", (confidence) => {
    const claim = createFieldClaim(validInput({ confidence }));
    expect(claim.confidence).toBe(confidence);
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects invalid confidence %s",
    (confidence) => {
      expect(() => createFieldClaim(validInput({ confidence }))).toThrow(
        InvalidFieldClaimConfidenceError
      );
    }
  );

  it.each([
    "2026-08-09T08:30:00+00:00",
    "2026-02-30T08:30:00Z",
    "2026-04-31T08:30:00Z",
    "2025-02-29T08:30:00Z",
    "not-a-date",
  ])("rejects invalid UTC timestamp %s", (timestamp) => {
    expect(() => createFieldClaim(validInput({ timestamp }))).toThrow(
      InvalidFieldClaimTimestampError
    );
  });

  it("accepts a valid leap-day timestamp", () => {
    expect(createFieldClaim(validInput({ timestamp: "2024-02-29T08:30:00Z" })).createdAt).toBe(
      "2024-02-29T08:30:00Z"
    );
  });

  it("allows conflicting claims to coexist without resolving them", () => {
    const packageClaim = createFieldClaim(validInput({ id: "package-claim" }));
    const userClaim = createFieldClaim(
      validInput({
        id: "user-claim",
        value: { type: "number", value: 0.6 },
        provenance: { sourceType: "user_confirmed" },
        trust: "user_confirmed",
      })
    );

    expect([packageClaim.value, userClaim.value]).toEqual([
      { type: "number", value: 0.4 },
      { type: "number", value: 0.6 },
    ]);
  });

  it("keeps uncertain and confirmed user claims distinct", () => {
    const uncertain = createFieldClaim(
      validInput({
        id: "uncertain",
        provenance: { sourceType: "user_entered" },
        trust: "user_entered",
        confidence: 0.5,
      })
    );
    const confirmed = createFieldClaim(
      validInput({
        id: "confirmed",
        provenance: { sourceType: "user_confirmed" },
        trust: "user_confirmed",
      })
    );

    expect(uncertain.provenance.sourceType).toBe("user_entered");
    expect(confirmed.provenance.sourceType).toBe("user_confirmed");
    expect(uncertain).not.toEqual(confirmed);
  });

  it("does not expose an update operation", () => {
    expect("updateFieldClaim" in core).toBe(false);
  });

  it("defensively copies and freezes the claim and all nested structures", () => {
    const target = { type: "printer_state" as const, printerStateId: "state-1" };
    const value = { type: "number" as const, value: 0.4 };
    const sourceRef = {
      type: "component_definition" as const,
      packageId: "base",
      packageVersion: "1.0.0",
      definitionId: "nozzle",
    };
    const provenance = { sourceType: "component_definition" as const, sourceRef };
    const claim = createFieldClaim(validInput({ target, value, provenance }));

    expect(claim.target).not.toBe(target);
    expect(claim.value).not.toBe(value);
    expect(claim.provenance).not.toBe(provenance);
    expect(claim.provenance.sourceRef).not.toBe(sourceRef);
    expect(Object.isFrozen(claim)).toBe(true);
    expect(Object.isFrozen(claim.target)).toBe(true);
    expect(Object.isFrozen(claim.value)).toBe(true);
    expect(Object.isFrozen(claim.provenance)).toBe(true);
    expect(Object.isFrozen(claim.provenance.sourceRef)).toBe(true);
    expect(() => {
      (claim.target as { printerStateId: string }).printerStateId = "changed";
    }).toThrow(TypeError);
    expect(() => {
      (claim.value as { value: number }).value = 0.8;
    }).toThrow(TypeError);
    expect(() => {
      (claim.provenance.sourceRef as { definitionId: string }).definitionId = "changed";
    }).toThrow(TypeError);
  });
});
