import type {
  ClaimTrust,
  FieldClaim,
  FieldClaimTarget,
  FieldClaimValue,
} from "@printtune/contracts";
import { describe, expect, it } from "vitest";

import { createFieldClaim } from "../src/field-claim.js";
import { resolveFieldClaims } from "../src/field-claim-resolver.js";

const TARGET: FieldClaimTarget = { type: "printer_state", printerStateId: "state-a" };
const PATH = "printer.nozzle.diameter";
const EARLY = "2026-08-08T10:00:00.000Z";
const LATE = "2026-08-09T10:00:00.000Z";

function claim(
  id: string,
  overrides: Partial<{
    target: FieldClaimTarget;
    fieldPath: string;
    value: FieldClaimValue;
    unit: "mm" | "degC" | undefined;
    trust: ClaimTrust;
    confidence: number | undefined;
    timestamp: string;
  }> = {}
): FieldClaim {
  const trust = overrides.trust ?? "user_confirmed";
  const value = overrides.value ?? { type: "number", value: 0.6 };
  const unit = Object.prototype.hasOwnProperty.call(overrides, "unit")
    ? overrides.unit
    : value.type === "number"
      ? "mm"
      : undefined;
  return createFieldClaim({
    id,
    target: overrides.target ?? TARGET,
    fieldPath: overrides.fieldPath ?? PATH,
    value,
    unit,
    provenance:
      trust === "user_entered"
        ? { sourceType: "user_entered" }
        : trust === "ai_generated_unverified"
          ? { sourceType: "ai_unverified" }
          : trust === "imported_observation"
            ? {
                sourceType: "imported_file",
                sourceRef: { type: "import_snapshot", id: `snapshot-${id}` },
              }
            : { sourceType: "user_confirmed" },
    trust,
    ...(overrides.confidence === undefined ? {} : { confidence: overrides.confidence }),
    timestamp: overrides.timestamp ?? EARLY,
  });
}

function resolve(claims: readonly FieldClaim[]) {
  return resolveFieldClaims({ target: TARGET, fieldPath: PATH, claims });
}

describe("resolveFieldClaims filtering and validity", () => {
  it("returns missing with no supporting IDs when no relevant claims exist", () => {
    expect(resolve([])).toEqual({
      target: TARGET,
      fieldPath: PATH,
      status: "missing",
      supportingClaimIds: [],
      reasonCode: "no_usable_claims",
    });
  });

  it("ignores unrelated targets and field paths", () => {
    const otherId = claim("other-id", {
      target: { type: "printer_state", printerStateId: "state-b" },
    });
    const otherType = claim("other-type", {
      target: { type: "component_installation", componentInstallationId: "state-a" },
    });
    const otherPath = claim("other-path", {
      fieldPath: "firmware.type",
      value: { type: "string", value: "klipper" },
      unit: undefined,
    });
    expect(resolve([otherId, otherType, otherPath]).status).toBe("missing");
  });

  it("blocks malformed relevant evidence without repairing it", () => {
    const malformed = {
      ...claim("malformed"),
      value: { type: "number", value: Number.NaN },
    } as unknown as FieldClaim;
    expect(resolve([malformed])).toMatchObject({
      status: "blocked",
      reasonCode: "invalid_claim_evidence",
      supportingClaimIds: ["malformed"],
    });
  });
});

describe("resolveFieldClaims trust and agreement", () => {
  it.each<ClaimTrust>(["developer_verified", "customer_verified", "user_confirmed"])(
    "resolves one strong %s claim",
    (trust) => {
      expect(resolve([claim("strong", { trust })])).toMatchObject({
        status: "resolved",
        value: { type: "number", value: 0.6 },
        reasonCode: "single_claim",
      });
    }
  );

  it("resolves one observed claim", () => {
    expect(resolve([claim("observed", { trust: "imported_observation" })])).toMatchObject({
      status: "resolved",
      reasonCode: "single_claim",
    });
  });

  it.each<ClaimTrust>(["user_entered", "ai_generated_unverified"])(
    "blocks one weak %s claim",
    (trust) => {
      expect(resolve([claim("weak", { trust })])).toMatchObject({
        status: "blocked",
        reasonCode: "insufficient_confirmation",
        supportingClaimIds: ["weak"],
      });
    }
  );

  it("keeps agreeing weak-only evidence blocked", () => {
    expect(
      resolve([
        claim("ai", { trust: "ai_generated_unverified" }),
        claim("user", { trust: "user_entered" }),
      ])
    ).toMatchObject({ status: "blocked", reasonCode: "insufficient_confirmation" });
  });

  it("resolves agreeing strong claims", () => {
    expect(resolve([claim("a"), claim("b", { trust: "developer_verified" })])).toMatchObject({
      status: "resolved",
      reasonCode: "claims_agree",
      supportingClaimIds: ["a", "b"],
    });
  });

  it("resolves agreeing observed claims", () => {
    expect(
      resolve([
        claim("a", { trust: "imported_observation" }),
        claim("b", { trust: "imported_observation" }),
      ])
    ).toMatchObject({ status: "resolved", reasonCode: "claims_agree" });
  });

  it("resolves exact strong and observed agreement", () => {
    expect(
      resolve([claim("strong"), claim("observed", { trust: "imported_observation" })])
    ).toMatchObject({ status: "resolved", reasonCode: "claims_agree" });
  });

  it("ignores disagreeing weak evidence and retains only material support", () => {
    const result = resolve([
      claim("strong", { value: { type: "number", value: 0.4 } }),
      claim("weak", { value: { type: "number", value: 0.6 }, trust: "user_entered" }),
    ]);
    expect(result).toMatchObject({
      status: "resolved",
      value: { type: "number", value: 0.4 },
      reasonCode: "stronger_evidence",
      supportingClaimIds: ["strong"],
    });
  });

  it("includes agreeing weak evidence as material support", () => {
    expect(
      resolve([claim("strong"), claim("weak", { trust: "user_entered", timestamp: LATE })])
    ).toMatchObject({
      status: "resolved",
      reasonCode: "single_claim",
      supportingClaimIds: ["strong", "weak"],
    });
  });
});

describe("resolveFieldClaims conflicts and representations", () => {
  it.each([
    ["strong disagreement", "user_confirmed", "developer_verified"],
    ["observed disagreement", "imported_observation", "imported_observation"],
    ["strong versus observed", "user_confirmed", "imported_observation"],
  ] as const)("returns conflict for %s", (_label, leftTrust, rightTrust) => {
    expect(
      resolve([
        claim("left", { value: { type: "number", value: 0.4 }, trust: leftTrust }),
        claim("right", { value: { type: "number", value: 0.6 }, trust: rightTrust }),
      ])
    ).toMatchObject({ status: "conflict", reasonCode: "unresolved_conflict" });
  });

  it("retains all materially conflicting values", () => {
    expect(
      resolve([
        claim("a", { value: { type: "number", value: 0.4 } }),
        claim("b", { value: { type: "number", value: 0.5 } }),
        claim("c", { value: { type: "number", value: 0.6 } }),
      ]).supportingClaimIds
    ).toEqual(["a", "b", "c"]);
  });

  it("does not use recency to resolve disagreement", () => {
    expect(
      resolve([
        claim("old", { value: { type: "number", value: 0.4 }, timestamp: EARLY }),
        claim("new", { value: { type: "number", value: 0.6 }, timestamp: LATE }),
      ])
    ).toMatchObject({ status: "conflict", reasonCode: "unresolved_conflict" });
  });

  it.each([
    ["mismatched units", claim("left", { unit: "mm" }), claim("right", { unit: "degC" })],
    [
      "mismatched scalar types",
      claim("left"),
      claim("right", { value: { type: "string", value: "0.6" }, unit: undefined }),
    ],
    [
      "unit versus no unit",
      claim("left", { unit: "mm" }),
      claim("right", { value: { type: "number", value: 0.6 }, unit: undefined }),
    ],
  ])("blocks %s", (_label, left, right) => {
    expect(resolve([left, right])).toMatchObject({
      status: "blocked",
      reasonCode: "incompatible_claim_representations",
      supportingClaimIds: ["left", "right"],
    });
  });

  it.each<[FieldClaimValue]>([
    [{ type: "boolean", value: true }],
    [{ type: "string", value: "direct-drive" }],
  ])("resolves exact agreement for %#", (value) => {
    expect(
      resolve([claim("a", { value, unit: undefined }), claim("b", { value, unit: undefined })])
    ).toMatchObject({ status: "resolved", value, reasonCode: "claims_agree" });
  });
});

describe("resolveFieldClaims confidence, ordering, and purity", () => {
  it("does not let high confidence promote weak evidence", () => {
    expect(resolve([claim("weak", { trust: "user_entered", confidence: 1 })])).toMatchObject({
      status: "blocked",
      reasonCode: "insufficient_confirmation",
    });
  });

  it("does not demote low-confidence strong evidence or require confidence", () => {
    expect(resolve([claim("strong", { confidence: 0 })])).toMatchObject({ status: "resolved" });
    expect(resolve([claim("without-confidence")])).toMatchObject({ status: "resolved" });
  });

  it("orders support chronologically and breaks timestamp ties by ID", () => {
    const result = resolve([
      claim("late", { timestamp: LATE }),
      claim("tie-b", { timestamp: EARLY }),
      claim("tie-a", { timestamp: EARLY }),
    ]);
    expect(result.supportingClaimIds).toEqual(["tie-a", "tie-b", "late"]);
  });

  it("does not mutate or reorder caller input", () => {
    const claims = [claim("late", { timestamp: LATE }), claim("early", { timestamp: EARLY })];
    const before = [...claims];
    resolve(claims);
    expect(claims).toEqual(before);
    expect(claims[0]).toBe(before[0]);
  });

  it("returns a deeply frozen result through the ResolvedField constructor", () => {
    const result = resolve([claim("a")]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.target)).toBe(true);
    expect(Object.isFrozen(result.supportingClaimIds)).toBe(true);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(Object.isFrozen(result.value)).toBe(true);
  });
});

describe("required generic examples A-G", () => {
  it("A: resolves one user-confirmed 0.6 mm claim", () => {
    expect(resolve([claim("a")])).toMatchObject({ status: "resolved", reasonCode: "single_claim" });
  });

  it("B: resolves two agreeing strong claims", () => {
    expect(resolve([claim("a"), claim("b")])).toMatchObject({
      status: "resolved",
      reasonCode: "claims_agree",
    });
  });

  it("C: conflicts on two disagreeing strong claims", () => {
    expect(
      resolve([claim("a", { value: { type: "number", value: 0.4 } }), claim("b")])
    ).toMatchObject({ status: "conflict", reasonCode: "unresolved_conflict" });
  });

  it("D: resolves one imported observation", () => {
    expect(resolve([claim("d", { trust: "imported_observation" })])).toMatchObject({
      status: "resolved",
      reasonCode: "single_claim",
    });
  });

  it("E: blocks one user-entered claim", () => {
    expect(resolve([claim("e", { trust: "user_entered" })])).toMatchObject({
      status: "blocked",
      reasonCode: "insufficient_confirmation",
    });
  });

  it("F: resolves strong evidence over disagreeing weak evidence", () => {
    expect(
      resolve([
        claim("strong", { value: { type: "number", value: 0.4 } }),
        claim("weak", { trust: "user_entered" }),
      ])
    ).toMatchObject({
      status: "resolved",
      value: { type: "number", value: 0.4 },
      reasonCode: "stronger_evidence",
    });
  });

  it("G: blocks incompatible strong numeric and string evidence", () => {
    expect(
      resolve([
        claim("numeric"),
        claim("string", { value: { type: "string", value: "0.6" }, unit: undefined }),
      ])
    ).toMatchObject({
      status: "blocked",
      reasonCode: "incompatible_claim_representations",
    });
  });
});
