import type {
  FieldClaimTarget,
  FieldClaimValue,
  ResolutionPolicyKind,
  ResolvedFieldReasonCode,
} from "@printtune/contracts";
import { describe, expect, it } from "vitest";

import {
  InvalidResolutionPolicyError,
  InvalidResolvedFieldPathError,
  InvalidResolvedFieldReasonCodeError,
  InvalidResolvedFieldStatusError,
  InvalidResolvedFieldSupportingClaimIdsError,
  InvalidResolvedFieldTargetError,
  InvalidResolvedFieldUnitError,
  InvalidResolvedFieldValueError,
  createResolutionPolicy,
  createResolvedField,
  type CreateResolvedFieldInput,
} from "../src/resolved-field.js";

const STATE_TARGET: FieldClaimTarget = { type: "printer_state", printerStateId: "state-a" };

function resolvedInput(
  overrides: Partial<CreateResolvedFieldInput> = {}
): CreateResolvedFieldInput {
  return {
    target: STATE_TARGET,
    fieldPath: "printer.nozzle.diameter",
    status: "resolved",
    value: { type: "number", value: 0.4 },
    unit: "mm",
    supportingClaimIds: ["claim-a"],
    reasonCode: "single_claim",
    ...overrides,
  } as CreateResolvedFieldInput;
}

describe("createResolvedField", () => {
  it("creates a valid resolved result", () => {
    expect(createResolvedField(resolvedInput())).toEqual({
      target: STATE_TARGET,
      fieldPath: "printer.nozzle.diameter",
      status: "resolved",
      value: { type: "number", value: 0.4 },
      unit: "mm",
      supportingClaimIds: ["claim-a"],
      reasonCode: "single_claim",
    });
  });

  it.each([
    ["missing", [], "no_usable_claims"],
    ["conflict", ["claim-a"], "unresolved_conflict"],
    ["blocked", ["claim-a"], "insufficient_confirmation"],
  ] as const)(
    "creates a valid %s result without a value",
    (status, supportingClaimIds, reasonCode) => {
      const result = createResolvedField({
        target: STATE_TARGET,
        fieldPath: "printer.nozzle.diameter",
        status,
        supportingClaimIds,
        reasonCode,
      });
      expect(result.status).toBe(status);
      expect(result).not.toHaveProperty("value");
      expect(result).not.toHaveProperty("unit");
    }
  );

  it.each<[FieldClaimValue]>([
    [{ type: "string", value: "direct-drive" }],
    [{ type: "number", value: 12.5 }],
    [{ type: "boolean", value: true }],
  ])("accepts Alpha scalar value %#", (value) => {
    const input = resolvedInput({ value, unit: undefined });
    expect(createResolvedField(input).value).toEqual(value);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite number %s",
    (value) => {
      expect(() =>
        createResolvedField(resolvedInput({ value: { type: "number", value } }))
      ).toThrow(InvalidResolvedFieldValueError);
    }
  );

  it.each([null, [], { type: "object", value: {} }, { type: "string", value: [] }])(
    "rejects invalid scalar %#",
    (value) => {
      expect(() =>
        createResolvedField(resolvedInput({ value: value as unknown as FieldClaimValue }))
      ).toThrow(InvalidResolvedFieldValueError);
    }
  );

  it("rejects resolved without a value", () => {
    const input = resolvedInput() as unknown as Record<string, unknown>;
    delete input.value;
    expect(() => createResolvedField(input as unknown as CreateResolvedFieldInput)).toThrow(
      InvalidResolvedFieldValueError
    );
  });

  it.each(["missing", "conflict", "blocked"] as const)("rejects a value for %s", (status) => {
    expect(() =>
      createResolvedField({
        target: STATE_TARGET,
        fieldPath: "printer.nozzle.diameter",
        status,
        value: { type: "number", value: 0.4 },
        supportingClaimIds: status === "missing" ? [] : ["claim-a"],
        reasonCode: status === "missing" ? "no_usable_claims" : "unresolved_conflict",
      } as unknown as CreateResolvedFieldInput)
    ).toThrow(InvalidResolvedFieldValueError);
  });

  it("rejects an arbitrary status", () => {
    expect(() => createResolvedField(resolvedInput({ status: "unknown" as "resolved" }))).toThrow(
      InvalidResolvedFieldStatusError
    );
  });

  it("supports both existing target variants", () => {
    const installationTarget: FieldClaimTarget = {
      type: "component_installation",
      componentInstallationId: "installation-a",
    };
    expect(createResolvedField(resolvedInput()).target).toEqual(STATE_TARGET);
    expect(createResolvedField(resolvedInput({ target: installationTarget })).target).toEqual(
      installationTarget
    );
  });

  it("rejects malformed targets", () => {
    expect(() =>
      createResolvedField(
        resolvedInput({
          target: { type: "printer_state", printerStateId: " state-a" },
        })
      )
    ).toThrow(InvalidResolvedFieldTargetError);
  });

  it.each([
    "printer.nozzle.diameter",
    "printer.hotend.max-temperature",
    "extension.klipper.some-field",
  ])("accepts canonical field path %s", (fieldPath) => {
    expect(createResolvedField(resolvedInput({ fieldPath })).fieldPath).toBe(fieldPath);
  });

  it.each(["Printer.nozzle.diameter", "printer..diameter", " printer.nozzle.diameter"])(
    "rejects malformed field path %s",
    (fieldPath) => {
      expect(() => createResolvedField(resolvedInput({ fieldPath }))).toThrow(
        InvalidResolvedFieldPathError
      );
    }
  );

  it.each(["mm", "mm/s", "mm/s2", "degC", "mm3/s", "ratio"] as const)(
    "reuses canonical unit %s",
    (unit) => {
      expect(createResolvedField(resolvedInput({ unit })).unit).toBe(unit);
    }
  );

  it("rejects unsupported units and units on non-number values", () => {
    expect(() => createResolvedField(resolvedInput({ unit: "cm" as "mm" }))).toThrow(
      InvalidResolvedFieldUnitError
    );
    expect(() =>
      createResolvedField(resolvedInput({ value: { type: "string", value: "0.4" }, unit: "mm" }))
    ).toThrow(InvalidResolvedFieldUnitError);
  });

  it("preserves supporting Claim ID order", () => {
    const result = createResolvedField(
      resolvedInput({ supportingClaimIds: ["claim-b", "claim-a", "claim-c"] })
    );
    expect(result.supportingClaimIds).toEqual(["claim-b", "claim-a", "claim-c"]);
  });

  it("allows an empty support list only for missing", () => {
    expect(
      createResolvedField({
        target: STATE_TARGET,
        fieldPath: "printer.nozzle.diameter",
        status: "missing",
        supportingClaimIds: [],
        reasonCode: "no_usable_claims",
      }).supportingClaimIds
    ).toEqual([]);
    expect(() => createResolvedField(resolvedInput({ supportingClaimIds: [] }))).toThrow(
      InvalidResolvedFieldSupportingClaimIdsError
    );
    expect(() =>
      createResolvedField({
        target: STATE_TARGET,
        fieldPath: "printer.nozzle.diameter",
        status: "missing",
        supportingClaimIds: ["claim-a"],
        reasonCode: "no_usable_claims",
      })
    ).toThrow(InvalidResolvedFieldSupportingClaimIdsError);
  });

  it.each([[""], [" claim-a"], ["claim-a", "claim-a"]])(
    "rejects malformed or duplicate supporting IDs %#",
    (supportingClaimIds) => {
      expect(() => createResolvedField(resolvedInput({ supportingClaimIds }))).toThrow(
        InvalidResolvedFieldSupportingClaimIdsError
      );
    }
  );

  const reasonCodes: readonly ResolvedFieldReasonCode[] = [
    "single_claim",
    "claims_agree",
    "stronger_evidence",
    "newer_same_source",
    "field_policy_selected",
    "safety_conservative_bound",
    "safety_policy_blocked",
    "no_usable_claims",
    "insufficient_confirmation",
    "unresolved_conflict",
    "incompatible_claim_representations",
    "invalid_claim_evidence",
    "unknown_field_definition",
  ];

  it.each(reasonCodes)("accepts reason code %s", (reasonCode) => {
    expect(createResolvedField(resolvedInput({ reasonCode })).reasonCode).toBe(reasonCode);
  });

  it("rejects arbitrary reason codes", () => {
    expect(() =>
      createResolvedField(
        resolvedInput({ reasonCode: "because" as unknown as ResolvedFieldReasonCode })
      )
    ).toThrow(InvalidResolvedFieldReasonCodeError);
  });

  it("defensively copies and deeply freezes the result", () => {
    const target = { type: "printer_state" as const, printerStateId: "state-a" };
    const value = { type: "number" as const, value: 0.4 };
    const supportingClaimIds = ["claim-a"];
    const result = createResolvedField(resolvedInput({ target, value, supportingClaimIds }));

    expect(result.target).not.toBe(target);
    expect(result.value).not.toBe(value);
    expect(result.supportingClaimIds).not.toBe(supportingClaimIds);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.target)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.supportingClaimIds)).toBe(true);
    expect(() => {
      (result.supportingClaimIds as string[]).push("claim-b");
    }).toThrow(TypeError);
  });
});

describe("createResolutionPolicy", () => {
  it.each<ResolutionPolicyKind>([
    "exact_match",
    "installed_hardware_confirmation",
    "safety_upper_bound",
    "safety_lower_bound",
  ])("creates immutable policy %s", (kind) => {
    const policy = createResolutionPolicy({ kind });
    expect(policy).toEqual({ kind });
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it("rejects arbitrary policy kinds and extra fields", () => {
    expect(() =>
      createResolutionPolicy({ kind: "callback" as unknown as ResolutionPolicyKind })
    ).toThrow(InvalidResolutionPolicyError);
    expect(() =>
      createResolutionPolicy({ kind: "exact_match", callback: () => true } as unknown as {
        kind: "exact_match";
      })
    ).toThrow(InvalidResolutionPolicyError);
  });
});
