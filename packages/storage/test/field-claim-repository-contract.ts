import type {
  CanonicalUnit,
  ClaimProvenance,
  ClaimTrust,
  FieldClaim,
  FieldClaimTarget,
  FieldClaimValue,
} from "@printtune/contracts";
import { createFieldClaim } from "@printtune/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DuplicateFieldClaimError, type FieldClaimRepository } from "../src/field-claim-repository";

const EARLY = "2026-08-08T10:00:00.000Z";
const LATE = "2026-08-09T10:00:00.000Z";
const STATE_TARGET: FieldClaimTarget = { type: "printer_state", printerStateId: "state-a" };
const INSTALLATION_TARGET: FieldClaimTarget = {
  type: "component_installation",
  componentInstallationId: "installation-a",
};

export interface FieldClaimRepositoryFixture {
  readonly repository: FieldClaimRepository;
  readonly close: () => void | Promise<void>;
}

export function claim(
  id: string,
  overrides: Partial<{
    target: FieldClaimTarget;
    fieldPath: string;
    value: FieldClaimValue;
    unit: CanonicalUnit | undefined;
    provenance: ClaimProvenance;
    trust: ClaimTrust;
    confidence: number | undefined;
    timestamp: string;
  }> = {}
): FieldClaim {
  return createFieldClaim({
    id,
    target: STATE_TARGET,
    fieldPath: "printer.nozzle.diameter",
    value: { type: "number", value: 0.4 },
    unit: "mm",
    provenance: { sourceType: "user_confirmed" },
    trust: "user_confirmed",
    timestamp: EARLY,
    ...overrides,
  });
}

export function describeFieldClaimRepository(
  name: string,
  createFixture: () => FieldClaimRepositoryFixture | Promise<FieldClaimRepositoryFixture>
): void {
  describe(name, () => {
    let fixture: FieldClaimRepositoryFixture;
    beforeEach(async () => {
      fixture = await createFixture();
    });
    afterEach(async () => fixture.close());

    it("starts empty", async () => {
      await expect(fixture.repository.findById("missing")).resolves.toBeUndefined();
      await expect(fixture.repository.listByTarget(STATE_TARGET)).resolves.toEqual([]);
      await expect(
        fixture.repository.listByTargetAndFieldPath(STATE_TARGET, "printer.nozzle.diameter")
      ).resolves.toEqual([]);
    });

    it("creates, finds, and filters both exact target types", async () => {
      const stateClaim = claim("state-claim");
      const installationClaim = claim("installation-claim", { target: INSTALLATION_TARGET });
      await fixture.repository.create(stateClaim);
      await fixture.repository.create(installationClaim);

      await expect(fixture.repository.findById(stateClaim.id)).resolves.toEqual(stateClaim);
      await expect(fixture.repository.listByTarget(STATE_TARGET)).resolves.toEqual([stateClaim]);
      await expect(fixture.repository.listByTarget(INSTALLATION_TARGET)).resolves.toEqual([
        installationClaim,
      ]);
    });

    it("filters by exact target and field path", async () => {
      const diameter = claim("diameter");
      const firmware = claim("firmware", {
        fieldPath: "firmware.type",
        value: { type: "string", value: "klipper" },
        unit: undefined,
      });
      const otherTarget = claim("other-target", { target: INSTALLATION_TARGET });
      for (const value of [firmware, otherTarget, diameter]) await fixture.repository.create(value);

      await expect(
        fixture.repository.listByTargetAndFieldPath(STATE_TARGET, "printer.nozzle.diameter")
      ).resolves.toEqual([diameter]);
    });

    it("orders chronologically by createdAt then ID without trust precedence", async () => {
      const later = claim("later", { timestamp: LATE, trust: "developer_verified" });
      const tieB = claim("tie-b", { trust: "developer_verified" });
      const tieA = claim("tie-a", { trust: "ai_generated_unverified" });
      for (const value of [later, tieB, tieA]) await fixture.repository.create(value);

      await expect(fixture.repository.listByTarget(STATE_TARGET)).resolves.toEqual([
        tieA,
        tieB,
        later,
      ]);
    });

    it("rejects duplicate IDs and preserves the original", async () => {
      const original = claim("duplicate");
      await fixture.repository.create(original);
      await expect(
        fixture.repository.create(claim("duplicate", { value: { type: "number", value: 0.6 } }))
      ).rejects.toBeInstanceOf(DuplicateFieldClaimError);
      await expect(fixture.repository.findById("duplicate")).resolves.toEqual(original);
    });

    it("allows duplicate and conflicting evidence under distinct IDs", async () => {
      const first = claim("first");
      const same = claim("same");
      const conflict = claim("conflict", {
        value: { type: "number", value: 0.6 },
        provenance: { sourceType: "user_entered" },
        trust: "user_entered",
      });
      for (const value of [first, same, conflict]) await fixture.repository.create(value);
      await expect(fixture.repository.listByTarget(STATE_TARGET)).resolves.toHaveLength(3);
    });

    it.each([
      [
        "string",
        { type: "string", value: "日本語 'value'; DROP TABLE field_claims; --" },
        undefined,
      ],
      ["number", { type: "number", value: 12.5 }, "mm/s"],
      ["false", { type: "boolean", value: false }, undefined],
      ["true", { type: "boolean", value: true }, undefined],
    ] as const)("round-trips %s values", async (id, value, unit) => {
      const expected = claim(id, { value, unit });
      await fixture.repository.create(expected);
      await expect(fixture.repository.findById(id)).resolves.toEqual(expected);
    });

    it.each(["mm", "mm/s", "mm/s2", "degC", "mm3/s", "ratio"] as const)(
      "round-trips canonical unit %s",
      async (unit) => {
        const expected = claim(`unit-${unit}`, { unit });
        await fixture.repository.create(expected);
        await expect(fixture.repository.findById(expected.id)).resolves.toEqual(expected);
      }
    );

    const provenanceCases: readonly [string, ClaimProvenance][] = [
      ["confirmed", { sourceType: "user_confirmed" }],
      ["uncertain", { sourceType: "user_entered" }],
      ["import", { sourceType: "imported_file", sourceRef: { type: "import_snapshot", id: "i" } }],
      [
        "slicer",
        { sourceType: "slicer_profile", sourceRef: { type: "slicer_profile_snapshot", id: "s" } },
      ],
      [
        "firmware",
        { sourceType: "firmware_read", sourceRef: { type: "firmware_snapshot", id: "f" } },
      ],
      [
        "package",
        {
          sourceType: "knowledge_package",
          sourceRef: { type: "knowledge_package", packageId: "p", packageVersion: "1" },
        },
      ],
      [
        "package-fact",
        {
          sourceType: "knowledge_package",
          sourceRef: {
            type: "knowledge_package",
            packageId: "p",
            packageVersion: "1",
            factId: "fact-a",
          },
        },
      ],
      [
        "definition",
        {
          sourceType: "component_definition",
          sourceRef: {
            type: "component_definition",
            packageId: "p",
            packageVersion: "1",
            definitionId: "d",
          },
        },
      ],
      ["test", { sourceType: "test_result", sourceRef: { type: "test_run", id: "t" } }],
      ["ai", { sourceType: "ai_unverified" }],
    ];

    it.each(provenanceCases)("round-trips %s provenance", async (id, provenance) => {
      const expected = claim(`source-${id}`, { provenance });
      await fixture.repository.create(expected);
      await expect(fixture.repository.findById(expected.id)).resolves.toEqual(expected);
    });

    it("keeps historical and multiple exact package facts as independent Claims", async () => {
      const historical = claim("package-historical", {
        provenance: {
          sourceType: "knowledge_package",
          sourceRef: { type: "knowledge_package", packageId: "p", packageVersion: "1" },
        },
      });
      const factA = claim("package-fact-a", {
        provenance: {
          sourceType: "knowledge_package",
          sourceRef: {
            type: "knowledge_package",
            packageId: "p",
            packageVersion: "1",
            factId: "fact-a",
          },
        },
      });
      const factB = claim("package-fact-b", {
        provenance: {
          sourceType: "knowledge_package",
          sourceRef: {
            type: "knowledge_package",
            packageId: "p",
            packageVersion: "1",
            factId: "fact-b",
          },
        },
      });
      for (const value of [historical, factA, factB]) await fixture.repository.create(value);

      await expect(fixture.repository.listByTarget(STATE_TARGET)).resolves.toEqual([
        factA,
        factB,
        historical,
      ]);
      expect(historical.provenance.sourceRef).not.toHaveProperty("factId");
    });

    it.each<ClaimTrust>([
      "developer_verified",
      "customer_verified",
      "user_confirmed",
      "user_entered",
      "imported_observation",
      "ai_generated_unverified",
    ])("round-trips trust %s", async (trust) => {
      const expected = claim(`trust-${trust}`, { trust });
      await fixture.repository.create(expected);
      await expect(fixture.repository.findById(expected.id)).resolves.toEqual(expected);
    });

    it.each([undefined, 0, 0.42, 1])("round-trips confidence %s", async (confidence) => {
      const expected = claim(`confidence-${String(confidence)}`, { confidence });
      await fixture.repository.create(expected);
      await expect(fixture.repository.findById(expected.id)).resolves.toEqual(expected);
    });

    it("stores defensive deeply frozen copies", async () => {
      const mutable = {
        ...claim("frozen", {
          provenance: {
            sourceType: "component_definition",
            sourceRef: {
              type: "component_definition",
              packageId: "p",
              packageVersion: "1",
              definitionId: "d",
            },
          },
        }),
        target: { type: "printer_state" as const, printerStateId: "state-a" },
        value: { type: "number" as const, value: 0.4 },
        provenance: {
          sourceType: "component_definition" as const,
          sourceRef: {
            type: "component_definition" as const,
            packageId: "p",
            packageVersion: "1",
            definitionId: "d",
          },
        },
      };
      await fixture.repository.create(mutable);
      mutable.value.value = 0.8;
      mutable.provenance.sourceRef.definitionId = "changed";
      const found = await fixture.repository.findById("frozen");
      expect(found?.value).toEqual({ type: "number", value: 0.4 });
      expect(Object.isFrozen(found)).toBe(true);
      expect(Object.isFrozen(found?.target)).toBe(true);
      expect(Object.isFrozen(found?.value)).toBe(true);
      expect(Object.isFrozen(found?.provenance)).toBe(true);
      expect(Object.isFrozen(found?.provenance.sourceRef)).toBe(true);
    });

    it("exposes no mutable repository operations", () => {
      expect("save" in fixture.repository).toBe(false);
      expect("update" in fixture.repository).toBe(false);
      expect("delete" in fixture.repository).toBe(false);
      expect("resolve" in fixture.repository).toBe(false);
    });
  });
}
