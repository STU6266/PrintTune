import type {
  ClaimProvenance,
  ClaimTrust,
  FieldClaim,
  FieldClaimValue,
  ResolutionPolicyKind,
} from "@printtune/contracts";
import { describe, expect, it } from "vitest";

import { createFieldClaim } from "../src/field-claim.js";
import { resolveFieldClaims } from "../src/field-claim-resolver.js";

const TARGET = { type: "printer_state" as const, printerStateId: "state-a" };
const PATH = "printer.nozzle.diameter";
const EARLY = "2026-08-08T10:00:00.000Z";
const LATE = "2026-08-09T10:00:00.000Z";

interface ClaimOptions {
  readonly value?: FieldClaimValue;
  readonly unit?: "mm" | "degC";
  readonly unitless?: boolean;
  readonly provenance?: ClaimProvenance;
  readonly trust?: ClaimTrust;
  readonly confidence?: number;
  readonly timestamp?: string;
}

function claim(id: string, options: ClaimOptions = {}): FieldClaim {
  const value = options.value ?? { type: "number", value: 0.6 };
  const trust = options.trust ?? "developer_verified";
  const provenance = options.provenance ?? {
    sourceType: "knowledge_package",
    sourceRef: { type: "knowledge_package", packageId: "base", packageVersion: "1" },
  };
  const unit = options.unitless
    ? undefined
    : (options.unit ?? (value.type === "number" ? "mm" : undefined));
  return createFieldClaim({
    id,
    target: TARGET,
    fieldPath: PATH,
    value,
    ...(unit === undefined ? {} : { unit }),
    provenance,
    trust,
    ...(options.confidence === undefined ? {} : { confidence: options.confidence }),
    timestamp: options.timestamp ?? EARLY,
  });
}

function userConfirmed(id: string, value: number, timestamp = EARLY): FieldClaim {
  return claim(id, {
    value: { type: "number", value },
    provenance: { sourceType: "user_confirmed" },
    trust: "user_confirmed",
    timestamp,
  });
}

function weak(
  id: string,
  value: number,
  trust: "user_entered" | "ai_generated_unverified" = "user_entered"
): FieldClaim {
  return claim(id, {
    value: { type: "number", value },
    provenance: { sourceType: trust === "user_entered" ? "user_entered" : "ai_unverified" },
    trust,
  });
}

function resolve(claims: readonly FieldClaim[], kind?: ResolutionPolicyKind) {
  return resolveFieldClaims({
    target: TARGET,
    fieldPath: PATH,
    claims,
    ...(kind === undefined ? {} : { policy: { kind } }),
  });
}

describe("installed_hardware_confirmation", () => {
  const policy = "installed_hardware_confirmation" as const;

  it("selects user confirmation over a conflicting package default", () => {
    expect(
      resolve(
        [claim("package", { value: { type: "number", value: 0.4 } }), userConfirmed("user", 0.6)],
        policy
      )
    ).toMatchObject({
      status: "resolved",
      value: { type: "number", value: 0.6 },
      reasonCode: "field_policy_selected",
      supportingClaimIds: ["user"],
    });
  });

  it("selects user confirmation over a conflicting component definition", () => {
    const definition = claim("definition", {
      value: { type: "number", value: 0.4 },
      provenance: {
        sourceType: "component_definition",
        sourceRef: {
          type: "component_definition",
          packageId: "base",
          packageVersion: "1",
          definitionId: "nozzle",
        },
      },
    });
    expect(resolve([definition, userConfirmed("user", 0.6)], policy)).toMatchObject({
      status: "resolved",
      value: { type: "number", value: 0.6 },
      reasonCode: "field_policy_selected",
    });
  });

  it("uses normal agreement when package and user confirmation agree", () => {
    expect(resolve([claim("package"), userConfirmed("user", 0.6)], policy)).toMatchObject({
      status: "resolved",
      reasonCode: "claims_agree",
      supportingClaimIds: ["package", "user"],
    });
  });

  it("does not treat uncertain user input as confirmation", () => {
    expect(
      resolve(
        [claim("package", { value: { type: "number", value: 0.4 } }), weak("uncertain", 0.6)],
        policy
      )
    ).toMatchObject({
      status: "resolved",
      value: { type: "number", value: 0.4 },
      reasonCode: "stronger_evidence",
      supportingClaimIds: ["package"],
    });
  });

  it("selects the newer same-lineage user confirmation", () => {
    expect(
      resolve([userConfirmed("old", 0.4, EARLY), userConfirmed("new", 0.6, LATE)], policy)
    ).toMatchObject({
      status: "resolved",
      value: { type: "number", value: 0.6 },
      reasonCode: "newer_same_source",
      supportingClaimIds: ["new"],
    });
  });

  it("keeps disagreeing equal-timestamp confirmations as a deterministic conflict", () => {
    const first = userConfirmed("confirmation-b", 0.4);
    const second = userConfirmed("confirmation-a", 0.6);
    const expected = {
      status: "conflict",
      reasonCode: "unresolved_conflict",
      supportingClaimIds: ["confirmation-a", "confirmation-b"],
    };

    expect(resolve([first, second], policy)).toMatchObject(expected);
    expect(resolve([second, first], policy)).toMatchObject(expected);
  });

  it("treats equivalent timestamp spellings as the same instant", () => {
    expect(
      resolve(
        [
          userConfirmed("confirmation-a", 0.4, "2026-08-08T10:00:00.0Z"),
          userConfirmed("confirmation-b", 0.6, "2026-08-08T10:00:00.000Z"),
        ],
        policy
      )
    ).toMatchObject({
      status: "conflict",
      reasonCode: "unresolved_conflict",
      supportingClaimIds: ["confirmation-a", "confirmation-b"],
    });
  });

  it("treats equal-timestamp confirmations with the same value as normal agreement", () => {
    expect(
      resolve([userConfirmed("confirmation-b", 0.6), userConfirmed("confirmation-a", 0.6)], policy)
    ).toMatchObject({
      status: "resolved",
      value: { type: "number", value: 0.6 },
      reasonCode: "claims_agree",
      supportingClaimIds: ["confirmation-a", "confirmation-b"],
    });
  });

  it("conflicts when the latest timestamp contains contradictory confirmations", () => {
    expect(
      resolve(
        [
          userConfirmed("old", 0.4, EARLY),
          userConfirmed("latest-b", 0.6, LATE),
          userConfirmed("latest-a", 0.8, LATE),
        ],
        policy
      )
    ).toMatchObject({
      status: "conflict",
      reasonCode: "unresolved_conflict",
      supportingClaimIds: ["latest-a", "latest-b"],
    });
  });

  it("uses an agreeing latest group to replace an older confirmation", () => {
    expect(
      resolve(
        [
          userConfirmed("old", 0.4, EARLY),
          userConfirmed("latest-b", 0.6, LATE),
          userConfirmed("latest-a", 0.6, LATE),
        ],
        policy
      )
    ).toMatchObject({
      status: "resolved",
      value: { type: "number", value: 0.6 },
      reasonCode: "newer_same_source",
      supportingClaimIds: ["latest-a", "latest-b"],
    });
  });

  it("does not fall back to a package when latest confirmations conflict", () => {
    expect(
      resolve(
        [
          claim("package", { value: { type: "number", value: 0.4 } }),
          userConfirmed("confirmation-a", 0.6, LATE),
          userConfirmed("confirmation-b", 0.8, LATE),
        ],
        policy
      )
    ).toMatchObject({
      status: "conflict",
      reasonCode: "unresolved_conflict",
      supportingClaimIds: ["confirmation-a", "confirmation-b"],
    });
  });

  it("keeps a strictly newer confirmation authoritative over a package default", () => {
    expect(
      resolve(
        [
          claim("package", { value: { type: "number", value: 0.4 } }),
          userConfirmed("old", 0.6, EARLY),
          userConfirmed("new", 0.8, LATE),
        ],
        policy
      )
    ).toMatchObject({
      status: "resolved",
      value: { type: "number", value: 0.8 },
      reasonCode: "newer_same_source",
      supportingClaimIds: ["new"],
    });
  });

  it("does not mutate confirmations while resolving their recency", () => {
    const confirmations = [userConfirmed("latest", 0.6, LATE), userConfirmed("old", 0.4, EARLY)];
    const before = [...confirmations];

    resolve(confirmations, policy);

    expect(confirmations).toEqual(before);
  });

  it("keeps unrelated strong non-catalog disagreement as conflict", () => {
    const direct = claim("direct", {
      value: { type: "number", value: 0.4 },
      provenance: {
        sourceType: "imported_file",
        sourceRef: { type: "import_snapshot", id: "direct-observation" },
      },
      trust: "developer_verified",
    });
    expect(resolve([direct, userConfirmed("user", 0.6)], policy)).toMatchObject({
      status: "conflict",
      reasonCode: "unresolved_conflict",
      supportingClaimIds: ["direct", "user"],
    });
  });

  it("never treats AI-unverified evidence as confirmation", () => {
    expect(
      resolve(
        [
          claim("package", { value: { type: "number", value: 0.4 } }),
          weak("ai", 0.6, "ai_generated_unverified"),
        ],
        policy
      )
    ).toMatchObject({
      status: "resolved",
      value: { type: "number", value: 0.4 },
      supportingClaimIds: ["package"],
    });
  });
});

describe("knowledge-package fact provenance neutrality", () => {
  function packageFact(id: string, factId: string, value: number): FieldClaim {
    return claim(id, {
      value: { type: "number", value },
      provenance: {
        sourceType: "knowledge_package",
        sourceRef: {
          type: "knowledge_package",
          packageId: "base",
          packageVersion: "1",
          factId,
        },
      },
    });
  }

  it("treats equal technical values from different fact IDs as agreement", () => {
    expect(
      resolve([packageFact("claim-a", "fact-a", 0.4), packageFact("claim-b", "fact-b", 0.4)])
    ).toMatchObject({
      status: "resolved",
      value: { type: "number", value: 0.4 },
      reasonCode: "claims_agree",
      supportingClaimIds: ["claim-a", "claim-b"],
    });
  });

  it("attributes conflict to differing values rather than differing fact IDs", () => {
    expect(
      resolve([packageFact("claim-a", "fact-a", 0.4), packageFact("claim-b", "fact-b", 0.6)])
    ).toMatchObject({
      status: "conflict",
      reasonCode: "unresolved_conflict",
      supportingClaimIds: ["claim-a", "claim-b"],
    });
  });
});

describe("safety bound policies", () => {
  it("selects the minimum reliable upper bound", () => {
    expect(
      resolve(
        [
          claim("high", { value: { type: "number", value: 300 }, unit: "degC" }),
          claim("low", { value: { type: "number", value: 260 }, unit: "degC" }),
        ],
        "safety_upper_bound"
      )
    ).toMatchObject({
      status: "resolved",
      value: { type: "number", value: 260 },
      reasonCode: "safety_conservative_bound",
      supportingClaimIds: ["high", "low"],
    });
  });

  it("uses agreement and single-claim reasons where appropriate", () => {
    expect(
      resolve(
        [
          claim("a", { value: { type: "number", value: 260 }, unit: "degC" }),
          claim("b", { value: { type: "number", value: 260 }, unit: "degC" }),
        ],
        "safety_upper_bound"
      ).reasonCode
    ).toBe("claims_agree");
    expect(
      resolve(
        [claim("single", { value: { type: "number", value: 260 }, unit: "degC" })],
        "safety_upper_bound"
      ).reasonCode
    ).toBe("single_claim");
  });

  it("never lets weak evidence establish or relax an upper bound", () => {
    expect(
      resolve(
        [
          claim("reliable", { value: { type: "number", value: 260 }, unit: "degC" }),
          weak("weak-high", 300),
        ],
        "safety_upper_bound"
      )
    ).toMatchObject({
      value: { type: "number", value: 260 },
      supportingClaimIds: ["reliable"],
    });
    expect(
      resolve(
        [
          claim("reliable", { value: { type: "number", value: 300 }, unit: "degC" }),
          weak("weak-low", 260),
        ],
        "safety_upper_bound"
      )
    ).toMatchObject({
      value: { type: "number", value: 300 },
      supportingClaimIds: ["reliable"],
    });
  });

  it("blocks weak-only safety evidence", () => {
    expect(resolve([weak("weak", 260)], "safety_upper_bound")).toMatchObject({
      status: "blocked",
      reasonCode: "safety_policy_blocked",
    });
  });

  it.each([
    [
      claim("temperature", { value: { type: "number", value: 260 }, unit: "degC" }),
      claim("distance", { value: { type: "number", value: 300 }, unit: "mm" }),
    ],
    [
      claim("text", { value: { type: "string", value: "260" }, unitless: true }),
      claim("numeric", { value: { type: "number", value: 260 }, unit: "degC" }),
    ],
  ])("blocks incompatible reliable representations", (left, right) => {
    expect(resolve([left, right], "safety_upper_bound")).toMatchObject({
      status: "blocked",
      reasonCode: "incompatible_claim_representations",
    });
  });

  it("selects the maximum reliable lower bound", () => {
    expect(
      resolve(
        [
          claim("low", { value: { type: "number", value: 5 }, unitless: true }),
          claim("high", { value: { type: "number", value: 8 }, unitless: true }),
        ],
        "safety_lower_bound"
      )
    ).toMatchObject({
      status: "resolved",
      value: { type: "number", value: 8 },
      reasonCode: "safety_conservative_bound",
    });
  });

  it("ignores weak higher lower-bound evidence and blocks weak-only evidence", () => {
    expect(
      resolve(
        [
          claim("reliable", { value: { type: "number", value: 8 }, unitless: true }),
          weak("weak", 10),
        ],
        "safety_lower_bound"
      )
    ).toMatchObject({
      value: { type: "number", value: 8 },
      supportingClaimIds: ["reliable"],
    });
    expect(resolve([weak("weak-only", 10)], "safety_lower_bound")).toMatchObject({
      status: "blocked",
      reasonCode: "safety_policy_blocked",
    });
  });
});

describe("policy regression and purity", () => {
  it("defaults to exact_match and preserves generic strong conflict", () => {
    const claims = [claim("a", { value: { type: "number", value: 0.4 } }), claim("b")];
    expect(resolve(claims)).toEqual(resolve(claims, "exact_match"));
    expect(resolve(claims)).toMatchObject({
      status: "conflict",
      reasonCode: "unresolved_conflict",
    });
  });

  it("keeps supporting IDs deterministic and does not mutate Claims", () => {
    const claims = [
      claim("late", { value: { type: "number", value: 300 }, unit: "degC", timestamp: LATE }),
      claim("tie-b", { value: { type: "number", value: 260 }, unit: "degC" }),
      claim("tie-a", { value: { type: "number", value: 280 }, unit: "degC" }),
    ];
    const before = [...claims];
    expect(resolve(claims, "safety_upper_bound").supportingClaimIds).toEqual([
      "tie-a",
      "tie-b",
      "late",
    ]);
    expect(claims).toEqual(before);
  });

  it("does not let confidence change policy outcomes", () => {
    const lowConfirmed = claim("user", {
      value: { type: "number", value: 0.6 },
      provenance: { sourceType: "user_confirmed" },
      trust: "user_confirmed",
      confidence: 0,
    });
    const highPackage = claim("package", {
      value: { type: "number", value: 0.4 },
      confidence: 1,
    });
    expect(resolve([highPackage, lowConfirmed], "installed_hardware_confirmation")).toMatchObject({
      value: { type: "number", value: 0.6 },
      reasonCode: "field_policy_selected",
    });
  });
});
