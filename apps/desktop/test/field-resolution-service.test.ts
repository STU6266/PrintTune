import type {
  CanonicalUnit,
  ClaimTrust,
  FieldClaim,
  FieldClaimTarget,
  FieldClaimValue,
} from "@printtune/contracts";
import {
  createFieldClaim,
  createFieldDefinition,
  InvalidFieldDefinitionPathError,
} from "@printtune/core";
import { InMemoryFieldClaimRepository, type FieldClaimRepository } from "@printtune/storage";
import { describe, expect, it, vi } from "vitest";

import {
  FieldDefinitionTargetMismatchError,
  FieldResolutionService,
} from "../src/main/field-resolution-service";

const TARGET: FieldClaimTarget = { type: "printer_state", printerStateId: "state-a" };
const NOZZLE_PATH = "printer.nozzle.diameter";
const EARLY = "2026-08-08T10:00:00.000Z";
const LATE = "2026-08-09T10:00:00.000Z";

function claim(
  id: string,
  overrides: Partial<{
    target: FieldClaimTarget;
    fieldPath: string;
    value: FieldClaimValue;
    unit: CanonicalUnit | undefined;
    trust: ClaimTrust;
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
  const provenance =
    trust === "developer_verified"
      ? {
          sourceType: "knowledge_package" as const,
          sourceRef: {
            type: "knowledge_package" as const,
            packageId: "base",
            packageVersion: "1.0.0",
          },
        }
      : trust === "user_entered"
        ? { sourceType: "user_entered" as const }
        : { sourceType: "user_confirmed" as const };

  return createFieldClaim({
    id,
    target: overrides.target ?? TARGET,
    fieldPath: overrides.fieldPath ?? NOZZLE_PATH,
    value,
    ...(unit === undefined ? {} : { unit }),
    provenance,
    trust,
    timestamp: overrides.timestamp ?? EARLY,
  });
}

async function serviceWithClaims(...claims: FieldClaim[]): Promise<FieldResolutionService> {
  const repository = new InMemoryFieldClaimRepository();
  for (const item of claims) await repository.create(item);
  return new FieldResolutionService(repository);
}

describe("FieldResolutionService", () => {
  it("selects installed-hardware confirmation from the Core definition", async () => {
    const service = await serviceWithClaims(
      claim("catalog", { value: { type: "number", value: 0.4 }, trust: "developer_verified" }),
      claim("confirmed", { value: { type: "number", value: 0.6 }, timestamp: LATE })
    );

    await expect(
      service.resolve({ target: TARGET, fieldPath: NOZZLE_PATH })
    ).resolves.toMatchObject({
      status: "resolved",
      value: { type: "number", value: 0.6 },
      unit: "mm",
      reasonCode: "field_policy_selected",
    });
  });

  it("automatically applies the conservative safety upper bound", async () => {
    const path = "printer.hotend.max-temperature";
    const service = await serviceWithClaims(
      claim("high", { fieldPath: path, value: { type: "number", value: 300 }, unit: "degC" }),
      claim("low", {
        fieldPath: path,
        value: { type: "number", value: 260 },
        unit: "degC",
        timestamp: LATE,
      })
    );

    await expect(service.resolve({ target: TARGET, fieldPath: path })).resolves.toMatchObject({
      status: "resolved",
      value: { type: "number", value: 260 },
      reasonCode: "safety_conservative_bound",
    });
  });

  it("does not let weak evidence relax a reliable safety limit", async () => {
    const path = "printer.hotend.max-temperature";
    const service = await serviceWithClaims(
      claim("reliable", { fieldPath: path, value: { type: "number", value: 260 }, unit: "degC" }),
      claim("weak", {
        fieldPath: path,
        value: { type: "number", value: 300 },
        unit: "degC",
        trust: "user_entered",
        timestamp: LATE,
      })
    );

    await expect(service.resolve({ target: TARGET, fieldPath: path })).resolves.toMatchObject({
      status: "resolved",
      value: { type: "number", value: 260 },
    });
  });

  it("resolves a valid exact-match string claim", async () => {
    const path = "firmware.type";
    const service = await serviceWithClaims(
      claim("firmware", {
        fieldPath: path,
        value: { type: "string", value: "klipper" },
        unit: undefined,
      })
    );
    await expect(service.resolve({ target: TARGET, fieldPath: path })).resolves.toMatchObject({
      status: "resolved",
      value: { type: "string", value: "klipper" },
      reasonCode: "single_claim",
    });
  });

  it("preserves exact-match disagreement as a conflict", async () => {
    const path = "firmware.type";
    const service = await serviceWithClaims(
      claim("first", {
        fieldPath: path,
        value: { type: "string", value: "klipper" },
        unit: undefined,
      }),
      claim("second", {
        fieldPath: path,
        value: { type: "string", value: "marlin" },
        unit: undefined,
        timestamp: LATE,
      })
    );
    await expect(service.resolve({ target: TARGET, fieldPath: path })).resolves.toMatchObject({
      status: "conflict",
      reasonCode: "unresolved_conflict",
    });
  });

  it("delegates no-claims behavior to the existing resolver", async () => {
    const service = await serviceWithClaims();
    await expect(
      service.resolve({ target: TARGET, fieldPath: NOZZLE_PATH })
    ).resolves.toMatchObject({
      status: "missing",
      supportingClaimIds: [],
      reasonCode: "no_usable_claims",
    });
  });

  it("blocks weak-only nozzle evidence through the selected policy", async () => {
    const service = await serviceWithClaims(claim("weak", { trust: "user_entered" }));
    await expect(
      service.resolve({ target: TARGET, fieldPath: NOZZLE_PATH })
    ).resolves.toMatchObject({
      status: "blocked",
      reasonCode: "insufficient_confirmation",
    });
  });

  it("blocks an unknown valid field without querying the repository", async () => {
    const repository: FieldClaimRepository = {
      create: vi.fn(),
      createBatch: vi.fn(),
      findById: vi.fn(),
      listByTarget: vi.fn(),
      listByTargetAndFieldPath: vi.fn(),
    };
    const service = new FieldResolutionService(repository);
    await expect(
      service.resolve({ target: TARGET, fieldPath: "extension.klipper.future-field" })
    ).resolves.toEqual({
      target: TARGET,
      fieldPath: "extension.klipper.future-field",
      status: "blocked",
      supportingClaimIds: [],
      reasonCode: "unknown_field_definition",
    });
    expect(repository.listByTargetAndFieldPath).not.toHaveBeenCalled();
  });

  it("rejects malformed paths through existing registry validation", async () => {
    const service = await serviceWithClaims();
    await expect(
      service.resolve({ target: TARGET, fieldPath: " printer.nozzle.diameter" })
    ).rejects.toBeInstanceOf(InvalidFieldDefinitionPathError);
  });

  it("rejects target mismatch before querying the repository", async () => {
    const repository = new InMemoryFieldClaimRepository();
    const query = vi.spyOn(repository, "listByTargetAndFieldPath");
    const service = new FieldResolutionService(repository);
    await expect(
      service.resolve({
        target: { type: "component_installation", componentInstallationId: "installation-a" },
        fieldPath: NOZZLE_PATH,
      })
    ).rejects.toBeInstanceOf(FieldDefinitionTargetMismatchError);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong scalar", { value: { type: "string", value: "0.6" }, unit: undefined }],
    ["wrong unit", { value: { type: "number", value: 0.6 }, unit: "degC" }],
    ["missing unit", { value: { type: "number", value: 0.6 }, unit: undefined }],
  ] as const)("blocks a known field with %s", async (_label, overrides) => {
    const service = await serviceWithClaims(claim("invalid", overrides));
    await expect(
      service.resolve({ target: TARGET, fieldPath: NOZZLE_PATH })
    ).resolves.toMatchObject({
      status: "blocked",
      supportingClaimIds: ["invalid"],
      reasonCode: "incompatible_claim_representations",
    });
  });

  it("supports correct unitless boolean semantics through an injected definition", async () => {
    const path = "extension.test.enabled";
    const definition = createFieldDefinition({
      fieldPath: path,
      targetType: "printer_state",
      valueType: "boolean",
      resolutionPolicy: { kind: "exact_match" },
    });
    const service = new FieldResolutionService(
      await repositoryWith(
        claim("enabled", {
          fieldPath: path,
          value: { type: "boolean", value: true },
          unit: undefined,
        })
      ),
      { find: () => definition }
    );
    await expect(service.resolve({ target: TARGET, fieldPath: path })).resolves.toMatchObject({
      status: "resolved",
      value: { type: "boolean", value: true },
    });
  });

  it.each(["wrong target", "wrong path"])(
    "blocks repository filtering failure: %s",
    async (failure) => {
      const returned = claim("late", {
        ...(failure === "wrong target"
          ? { target: { type: "printer_state", printerStateId: "state-b" } as FieldClaimTarget }
          : { fieldPath: "printer.extruder.type" }),
        timestamp: LATE,
      });
      const early = claim("early");
      const repository = incorrectRepository([returned, early]);
      const service = new FieldResolutionService(repository);
      await expect(
        service.resolve({ target: TARGET, fieldPath: NOZZLE_PATH })
      ).resolves.toMatchObject({
        status: "blocked",
        supportingClaimIds: ["early", "late"],
        reasonCode: "incompatible_claim_representations",
      });
    }
  );
});

async function repositoryWith(claimValue: FieldClaim): Promise<InMemoryFieldClaimRepository> {
  const repository = new InMemoryFieldClaimRepository();
  await repository.create(claimValue);
  return repository;
}

function incorrectRepository(claims: FieldClaim[]): FieldClaimRepository {
  return {
    create: vi.fn(),
    createBatch: vi.fn(),
    findById: vi.fn(),
    listByTarget: vi.fn(),
    listByTargetAndFieldPath: vi.fn().mockResolvedValue(claims),
  };
}
