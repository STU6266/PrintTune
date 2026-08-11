import type { ClaimTrust, FieldClaim, FieldDefinition } from "@printtune/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  FieldClaimCarryForwardError,
  InvalidFieldClaimTimestampError,
  assessFieldClaimCarryForward,
  createCarriedForwardFieldClaim,
  createCarriedForwardFieldClaims,
  createFieldClaim,
  findCoreFieldDefinition,
} from "../src/index.js";

const SOURCE_STATE = "state-a";
const TARGET_STATE = "state-b";
const TRANSITION_TIME = "2026-08-11T10:30:00Z";

function claim(overrides: Partial<FieldClaim> & { readonly trust?: ClaimTrust } = {}): FieldClaim {
  const fieldPath = overrides.fieldPath ?? "printer.nozzle.diameter";
  const unit = "unit" in overrides ? overrides.unit : "mm";
  return createFieldClaim({
    id: overrides.id ?? "claim-a",
    target: overrides.target ?? { type: "printer_state", printerStateId: SOURCE_STATE },
    fieldPath,
    value: overrides.value ?? { type: "number", value: 0.4 },
    ...(unit === undefined ? {} : { unit }),
    provenance: overrides.provenance ?? { sourceType: "user_confirmed" },
    trust: overrides.trust ?? "user_confirmed",
    ...(overrides.confidence === undefined
      ? { confidence: 0.8 }
      : { confidence: overrides.confidence }),
    timestamp: overrides.createdAt ?? "2026-08-10T10:30:00Z",
  });
}

function definition(transitionPolicy: FieldDefinition["transitionPolicy"]): FieldDefinition {
  return {
    fieldPath: "printer.nozzle.diameter",
    targetType: "printer_state",
    valueType: "number",
    unit: "mm",
    resolutionPolicy: { kind: "exact_match" },
    transitionPolicy,
  };
}

function carryInput(sourceClaim = claim()) {
  return {
    sourceClaim,
    sourcePrinterStateId: SOURCE_STATE,
    targetPrinterStateId: TARGET_STATE,
    transitionCommandId: "transition-1",
    createdAt: TRANSITION_TIME,
    createClaimId: () => "claim-b",
    applicabilityConfirmed: true,
  } as const;
}

describe("assessFieldClaimCarryForward", () => {
  it("auto-carries strong evidence only for a safe policy", () => {
    expect(
      assessFieldClaimCarryForward({ claim: claim(), fieldDefinition: definition("safe_to_carry") })
    ).toEqual({ status: "auto_carry" });
  });

  it.each([
    ["component_dependent", "component_dependency"],
    ["configuration_dependent", "configuration_dependency"],
  ] as const)("requires confirmation for %s", (transitionPolicy, reason) => {
    expect(
      assessFieldClaimCarryForward({
        claim: claim(),
        fieldDefinition: definition(transitionPolicy),
      })
    ).toEqual({
      status: "confirmation_required",
      reason,
    });
  });

  it("requires a new claim for reconfirmation policy even when transition applicability is later confirmed", () => {
    expect(
      assessFieldClaimCarryForward({
        claim: claim(),
        fieldDefinition: definition("require_reconfirmation"),
      })
    ).toEqual({ status: "reconfirmation_required", reason: "field_policy" });
  });

  it.each<ClaimTrust>(["user_entered", "ai_generated_unverified"])(
    "requires reconfirmation for weak %s evidence even under a safe policy",
    (trust) => {
      const sourceType = trust === "user_entered" ? "user_entered" : "ai_unverified";
      expect(
        assessFieldClaimCarryForward({
          claim: claim({ trust, provenance: { sourceType } }),
          fieldDefinition: definition("safe_to_carry"),
        })
      ).toEqual({ status: "reconfirmation_required", reason: "weak_evidence" });
    }
  );

  it("never carries package evidence", () => {
    expect(
      assessFieldClaimCarryForward({
        claim: claim({
          trust: "developer_verified",
          provenance: {
            sourceType: "knowledge_package",
            sourceRef: {
              type: "knowledge_package",
              packageId: "base",
              packageVersion: "1",
              factId: "nozzle",
            },
          },
        }),
        fieldDefinition: definition("component_dependent"),
      })
    ).toEqual({ status: "not_carryable", reason: "knowledge_package_claim" });
  });

  it("does not retarget component evidence without an installation mapping", () => {
    expect(
      assessFieldClaimCarryForward({
        claim: claim({
          target: { type: "component_installation", componentInstallationId: "probe-a" },
        }),
        fieldDefinition: { ...definition("safe_to_carry"), targetType: "component_installation" },
      })
    ).toEqual({ status: "not_carryable", reason: "component_target_mapping_required" });
  });
});

describe("createCarriedForwardFieldClaim", () => {
  it("creates exact immutable transition evidence after component applicability confirmation", () => {
    const source = claim();
    const carried = createCarriedForwardFieldClaim(carryInput(source));
    expect(carried).toEqual({
      id: "claim-b",
      target: { type: "printer_state", printerStateId: TARGET_STATE },
      fieldPath: source.fieldPath,
      value: source.value,
      unit: source.unit,
      provenance: {
        sourceType: "state_transition",
        sourceRef: {
          type: "state_transition",
          sourceClaimId: source.id,
          transitionCommandId: "transition-1",
        },
      },
      trust: source.trust,
      confidence: source.confidence,
      createdAt: TRANSITION_TIME,
    });
    expect(carried).not.toBe(source);
    expect(Object.isFrozen(carried)).toBe(true);
    expect(Object.isFrozen(carried.target)).toBe(true);
    expect(Object.isFrozen(carried.value)).toBe(true);
    expect(Object.isFrozen(carried.provenance)).toBe(true);
    expect(Object.isFrozen(carried.provenance.sourceRef)).toBe(true);
    expect(source.target).toEqual({ type: "printer_state", printerStateId: SOURCE_STATE });
  });

  it("references the immediately preceding carried claim rather than flattening provenance", () => {
    const first = createCarriedForwardFieldClaim(carryInput());
    const second = createCarriedForwardFieldClaim({
      ...carryInput(first),
      sourcePrinterStateId: TARGET_STATE,
      targetPrinterStateId: "state-c",
      transitionCommandId: "transition-2",
      createClaimId: () => "claim-c",
    });
    expect(second.provenance.sourceRef).toMatchObject({ sourceClaimId: "claim-b" });
  });

  it("does not generate an ID when confirmation is missing or carrying is forbidden", () => {
    const createClaimId = vi.fn(() => "unused");
    expect(() =>
      createCarriedForwardFieldClaim({
        ...carryInput(),
        applicabilityConfirmed: false,
        createClaimId,
      })
    ).toThrow(expect.objectContaining({ code: "applicability_confirmation_required" }));
    expect(() =>
      createCarriedForwardFieldClaim({
        ...carryInput(
          claim({
            fieldPath: "printer.hotend.max-temperature",
            value: { type: "number", value: 300 },
            unit: "degC",
          })
        ),
        createClaimId,
      })
    ).toThrow(expect.objectContaining({ code: "carry_not_allowed" }));
    expect(createClaimId).not.toHaveBeenCalled();
  });

  it.each([
    [{ sourcePrinterStateId: "other" }, "source_state_mismatch"],
    [{ targetPrinterStateId: SOURCE_STATE }, "same_source_and_target_state"],
    [{ transitionCommandId: " transition" }, "invalid_transition_command_id"],
  ] as const)("rejects invalid alignment with %s", (override, code) => {
    expect(() => createCarriedForwardFieldClaim({ ...carryInput(), ...override })).toThrow(
      expect.objectContaining({ code })
    );
  });

  it("rejects unknown fields and invalid transition timestamps", () => {
    expect(() =>
      createCarriedForwardFieldClaim(carryInput(claim({ fieldPath: "printer.unknown.value" })))
    ).toThrow(expect.objectContaining({ code: "unknown_field_definition" }));
    expect(() =>
      createCarriedForwardFieldClaim({ ...carryInput(), createdAt: "2026-02-30T10:00:00Z" })
    ).toThrow(InvalidFieldClaimTimestampError);
  });

  it("creates configuration-dependent evidence only with explicit confirmation", () => {
    const firmware = claim({
      fieldPath: "firmware.type",
      value: { type: "string", value: "klipper" },
      unit: undefined,
    });
    expect(() =>
      createCarriedForwardFieldClaim({ ...carryInput(firmware), applicabilityConfirmed: false })
    ).toThrow(expect.objectContaining({ code: "applicability_confirmation_required" }));
    expect(createCarriedForwardFieldClaim(carryInput(firmware)).fieldPath).toBe("firmware.type");
  });

  it("rejects a package claim even when its component-dependent field is confirmed", () => {
    const packageClaim = claim({
      trust: "developer_verified",
      provenance: {
        sourceType: "knowledge_package",
        sourceRef: {
          type: "knowledge_package",
          packageId: "base",
          packageVersion: "1",
          factId: "nozzle",
        },
      },
    });
    expect(() => createCarriedForwardFieldClaim(carryInput(packageClaim))).toThrow(
      expect.objectContaining({ code: "carry_not_allowed" })
    );
  });

  it("validates the field representation against the authoritative registry", () => {
    expect(findCoreFieldDefinition("printer.nozzle.diameter")?.transitionPolicy).toBe(
      "component_dependent"
    );
    expect(() => createCarriedForwardFieldClaim(carryInput(claim({ unit: "mm/s" })))).toThrow(
      expect.objectContaining({ code: "incompatible_claim_representation" })
    );
  });
});

describe("createCarriedForwardFieldClaims", () => {
  it("uses explicit input order and rejects duplicate generated IDs without a partial result", () => {
    const sources = [claim({ id: "source-a" }), claim({ id: "source-b" })];
    const ids = ["new-a", "new-b"];
    const result = createCarriedForwardFieldClaims({
      sourceClaims: sources,
      sourcePrinterStateId: SOURCE_STATE,
      targetPrinterStateId: TARGET_STATE,
      transitionCommandId: "transition-1",
      createdAt: TRANSITION_TIME,
      createClaimId: () => ids.shift()!,
      applicabilityConfirmedClaimIds: new Set(sources.map((source) => source.id)),
    });
    expect(result.map(({ id }) => id)).toEqual(["new-a", "new-b"]);
    expect(Object.isFrozen(result)).toBe(true);

    expect(() =>
      createCarriedForwardFieldClaims({
        sourceClaims: sources,
        sourcePrinterStateId: SOURCE_STATE,
        targetPrinterStateId: TARGET_STATE,
        transitionCommandId: "transition-1",
        createdAt: TRANSITION_TIME,
        createClaimId: () => "duplicate",
        applicabilityConfirmedClaimIds: new Set(sources.map((source) => source.id)),
      })
    ).toThrow(FieldClaimCarryForwardError);
  });
});
