import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  PrinterKnowledgeIdentity,
  PrinterSeriesKnowledgePackageV1,
} from "@printtune/contracts";
import {
  createFieldClaim,
  createPrinter,
  createPrinterKnowledgeIdentity,
  createPrinterState,
  createWorkspace,
} from "@printtune/core";
import {
  InMemoryFieldClaimRepository,
  InMemoryPrinterKnowledgeIdentityLifecyclePersistence,
  InMemoryPrinterRepository,
  InMemoryPrinterStateRepository,
  InMemoryWorkspaceRepository,
  openPrintTuneDatabase,
} from "@printtune/storage";
import { describe, expect, it, vi } from "vitest";

import { ActiveWorkspaceSession } from "../src/main/active-workspace-session";
import { FieldResolutionService } from "../src/main/field-resolution-service";
import {
  PrinterKnowledgeApplicationService,
  type KnowledgePackageSource,
} from "../src/main/printer-knowledge-application-service";
import { PrinterNotFoundError } from "../src/main/printer-flow-application-service";

const BASE_TIME = "2026-08-09T10:00:00.000Z";
const SECOND_TIME = "2026-08-09T10:01:00.000Z";
const TARGET = { type: "printer_state", printerStateId: "state-a" } as const;

function syntheticPackage(
  overrides: {
    packageVersion?: string;
    publisherDisplayName?: string;
    incompatible?: boolean;
  } = {}
): PrinterSeriesKnowledgePackageV1 {
  return {
    formatVersion: 1,
    packageId: "example.synthetic-series",
    packageVersion: overrides.packageVersion ?? "1.0",
    packageType: "printer_series",
    displayName: "Synthetic Printer Series",
    publisher: {
      publisherId: "example.synthetic-publisher",
      publisherDisplayName: overrides.publisherDisplayName ?? "Untrusted-looking synthetic label",
    },
    coreCompatibility: { minimumVersion: "1.0.0", maximumVersionExclusive: "2.0.0" },
    payload: {
      series: {
        seriesDefinitionId: "synthetic-series",
        manufacturerDisplayName: "Synthetic Manufacturer",
        seriesDisplayName: "Synthetic Series",
        facts: [
          {
            factId: "series-nozzle",
            fieldPath: "printer.nozzle.diameter",
            value: { type: "number", value: 0.4 },
            unit: "mm",
          },
          {
            factId: "series-extruder",
            fieldPath: overrides.incompatible
              ? "printer.synthetic.unknown"
              : "printer.extruder.type",
            value: { type: "string", value: "series-extruder" },
          },
        ],
        models: [
          {
            modelDefinitionId: "synthetic-model",
            modelDisplayName: "Synthetic Model",
            facts: [
              {
                factId: "model-nozzle",
                fieldPath: "printer.nozzle.diameter",
                value: { type: "number", value: 0.6 },
                unit: "mm",
              },
              {
                factId: "model-velocity",
                fieldPath: "firmware.motion.max-velocity",
                value: { type: "number", value: 100 },
                unit: "mm/s",
              },
            ],
          },
        ],
      },
    },
  };
}

function knownIdentity(model = true): PrinterKnowledgeIdentity {
  return createPrinterKnowledgeIdentity({
    id: "identity-a",
    printerId: "printer-a",
    kind: "known",
    definitionRef: {
      packageId: "example.synthetic-series",
      packageVersion: "1.0",
      seriesDefinitionId: "synthetic-series",
      ...(model ? { modelDefinitionId: "synthetic-model" } : {}),
    },
    manufacturerDisplayName: "Synthetic Manufacturer",
    seriesDisplayName: "Synthetic Series",
    ...(model ? { modelDisplayName: "Synthetic Model" } : {}),
    selectedAt: BASE_TIME,
  });
}

async function createMemoryFixture(
  options: {
    identity?: PrinterKnowledgeIdentity | null;
    packageText?: string;
    claimIds?: string[];
    times?: string[];
  } = {}
) {
  const workspaces = new InMemoryWorkspaceRepository();
  const printers = new InMemoryPrinterRepository();
  const states = new InMemoryPrinterStateRepository();
  const identities = new InMemoryPrinterKnowledgeIdentityLifecyclePersistence();
  const claims = new InMemoryFieldClaimRepository();
  const activeWorkspace = new ActiveWorkspaceSession(workspaces);
  await workspaces.save(createWorkspace({ id: "workspace-a", name: "A", timestamp: BASE_TIME }));
  await workspaces.save(createWorkspace({ id: "workspace-b", name: "B", timestamp: BASE_TIME }));
  await printers.save(
    createPrinter({ id: "printer-a", workspaceId: "workspace-a", name: "A", timestamp: BASE_TIME })
  );
  await printers.save(
    createPrinter({ id: "printer-b", workspaceId: "workspace-b", name: "B", timestamp: BASE_TIME })
  );
  await states.create(
    createPrinterState({ id: "state-a", printerId: "printer-a", timestamp: BASE_TIME })
  );
  await states.create(
    createPrinterState({ id: "state-b", printerId: "printer-b", timestamp: BASE_TIME })
  );
  await activeWorkspace.setActiveWorkspace("workspace-a");
  if (options.identity !== null)
    await identities.createAndSelect(options.identity ?? knownIdentity());

  const getExactPackage = vi.fn<KnowledgePackageSource["getExactPackage"]>(async (reference) =>
    reference.packageId === "example.synthetic-series" && reference.packageVersion === "1.0"
      ? {
          text: options.packageText ?? JSON.stringify(syntheticPackage()),
          trust: "developer_verified",
        }
      : undefined
  );
  const packageSource: KnowledgePackageSource = { getExactPackage };
  const claimIds = options.claimIds ?? ["claim-a", "claim-b", "claim-c", "claim-d"];
  const times = options.times ?? [BASE_TIME];
  const service = new PrinterKnowledgeApplicationService(
    printers,
    states,
    identities,
    identities,
    packageSource,
    claims,
    activeWorkspace,
    {
      createClaimId: () => claimIds.shift() ?? "claim-unexpected",
      now: () => times.shift() ?? BASE_TIME,
    }
  );
  return {
    workspaces,
    printers,
    states,
    identities,
    claims,
    activeWorkspace,
    getExactPackage,
    service,
  };
}

describe("PrinterKnowledgeApplicationService", () => {
  it("applies model-effective facts with source trust and resolves the persisted override", async () => {
    const fixture = await createMemoryFixture();
    const result = await fixture.service.applyCurrentKnowledgeToPrinterState({
      printerId: "printer-a",
      printerStateId: "state-a",
    });

    expect(result).toEqual({
      printerId: "printer-a",
      printerStateId: "state-a",
      packageId: "example.synthetic-series",
      packageVersion: "1.0",
      claimIds: ["claim-a", "claim-b", "claim-c"],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.claimIds)).toBe(true);
    const claims = await fixture.claims.listByTarget(TARGET);
    expect(claims).toHaveLength(3);
    expect(claims.every((claim) => claim.createdAt === BASE_TIME)).toBe(true);
    expect(claims.every((claim) => claim.trust === "developer_verified")).toBe(true);
    expect(claims.every((claim) => claim.target.type === "printer_state")).toBe(true);
    const nozzle = claims.filter((claim) => claim.fieldPath === "printer.nozzle.diameter");
    expect(nozzle).toHaveLength(1);
    expect(nozzle[0]).toMatchObject({
      value: { type: "number", value: 0.6 },
      provenance: {
        sourceType: "knowledge_package",
        sourceRef: {
          type: "knowledge_package",
          packageId: "example.synthetic-series",
          packageVersion: "1.0",
          factId: "model-nozzle",
        },
      },
    });
    await expect(
      new FieldResolutionService(fixture.claims).resolve({
        target: TARGET,
        fieldPath: "printer.nozzle.diameter",
      })
    ).resolves.toMatchObject({ status: "resolved", value: { type: "number", value: 0.6 } });
  });

  it("applies only series facts for a series-only current identity", async () => {
    const fixture = await createMemoryFixture({ identity: knownIdentity(false) });
    await fixture.service.applyCurrentKnowledgeToPrinterState({
      printerId: "printer-a",
      printerStateId: "state-a",
    });
    const claims = await fixture.claims.listByTarget(TARGET);
    expect(
      claims.map((claim) =>
        claim.provenance.sourceRef?.type === "knowledge_package"
          ? claim.provenance.sourceRef.factId
          : undefined
      )
    ).toEqual(["series-extruder", "series-nozzle"]);
    expect(claims.some((claim) => claim.fieldPath === "firmware.motion.max-velocity")).toBe(false);
  });

  it.each([
    ["no selection", null, "no_current_knowledge_identity"],
    [
      "unclassified selection",
      createPrinterKnowledgeIdentity({
        id: "identity-a",
        printerId: "printer-a",
        kind: "unclassified",
        selectedAt: BASE_TIME,
      }),
      "current_identity_unclassified",
    ],
  ] as const)("rejects %s before package lookup", async (_label, identity, code) => {
    const fixture = await createMemoryFixture({ identity });
    await expect(
      fixture.service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).rejects.toMatchObject({ code });
    expect(fixture.getExactPackage).not.toHaveBeenCalled();
    await expect(fixture.claims.listByTarget(TARGET)).resolves.toEqual([]);
  });

  it("rejects cross-Workspace access and wrong state ownership before lookup", async () => {
    const fixture = await createMemoryFixture();
    await expect(
      fixture.service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-b",
        printerStateId: "state-b",
      })
    ).rejects.toBeInstanceOf(PrinterNotFoundError);
    await expect(
      fixture.service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-b",
      })
    ).rejects.toMatchObject({ code: "printer_state_ownership_mismatch" });
    expect(fixture.getExactPackage).not.toHaveBeenCalled();
  });

  it("requires an exact package version and rejects a mismatched document from a faulty source", async () => {
    const unavailable = await createMemoryFixture();
    unavailable.getExactPackage.mockResolvedValue(undefined);
    await expect(
      unavailable.service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).rejects.toMatchObject({ code: "knowledge_package_not_available" });
    expect(unavailable.getExactPackage).toHaveBeenCalledWith({
      packageId: "example.synthetic-series",
      packageVersion: "1.0",
    });

    const faulty = await createMemoryFixture();
    faulty.getExactPackage.mockResolvedValue({
      text: JSON.stringify(syntheticPackage({ packageVersion: "1.1" })),
      trust: "developer_verified",
    });
    await expect(
      faulty.service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).rejects.toMatchObject({ code: "knowledge_materialization_failed" });
    await expect(faulty.claims.listByTarget(TARGET)).resolves.toEqual([]);
  });

  it.each([
    ["malformed", "{", "invalid_knowledge_package"],
    [
      "Core-incompatible",
      JSON.stringify(syntheticPackage({ incompatible: true })),
      "knowledge_materialization_failed",
    ],
  ])(
    "rejects a %s package without consuming IDs or persisting Claims",
    async (_label, text, code) => {
      const createId = vi.fn(() => "unused");
      const fixture = await createMemoryFixture({ packageText: text });
      const service = new PrinterKnowledgeApplicationService(
        fixture.printers,
        fixture.states,
        fixture.identities,
        fixture.identities,
        { getExactPackage: fixture.getExactPackage },
        fixture.claims,
        fixture.activeWorkspace,
        { createClaimId: createId, now: () => BASE_TIME }
      );
      await expect(
        service.applyCurrentKnowledgeToPrinterState({
          printerId: "printer-a",
          printerStateId: "state-a",
        })
      ).rejects.toMatchObject({ code });
      expect(createId).not.toHaveBeenCalled();
      await expect(fixture.claims.listByTarget(TARGET)).resolves.toEqual([]);
    }
  );

  it("preserves prior history and persists none of a colliding incoming batch", async () => {
    const fixture = await createMemoryFixture({
      claimIds: ["claim-new", "claim-existing", "claim-last"],
    });
    await fixture.claims.create(
      createFieldClaim({
        id: "claim-existing",
        target: TARGET,
        fieldPath: "printer.nozzle.diameter",
        value: { type: "number", value: 0.2 },
        unit: "mm",
        provenance: { sourceType: "user_entered" },
        trust: "user_entered",
        timestamp: "2026-08-08T10:00:00.000Z",
      })
    );
    await expect(
      fixture.service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).rejects.toMatchObject({ code: "knowledge_persistence_failed" });
    await expect(fixture.claims.findById("claim-existing")).resolves.toBeDefined();
    await expect(fixture.claims.findById("claim-new")).resolves.toBeUndefined();
  });

  it("allows two explicit applications as fresh immutable batches", async () => {
    const fixture = await createMemoryFixture({
      claimIds: ["a-1", "a-2", "a-3", "b-1", "b-2", "b-3"],
      times: [BASE_TIME, SECOND_TIME],
    });
    await fixture.service.applyCurrentKnowledgeToPrinterState({
      printerId: "printer-a",
      printerStateId: "state-a",
    });
    await fixture.service.applyCurrentKnowledgeToPrinterState({
      printerId: "printer-a",
      printerStateId: "state-a",
    });
    const claims = await fixture.claims.listByTarget(TARGET);
    expect(claims).toHaveLength(6);
    expect(new Set(claims.map((claim) => claim.createdAt))).toEqual(
      new Set([BASE_TIME, SECOND_TIME])
    );
  });

  it("persists the full synthetic flow in SQLite and resolves it after close/reopen without a package source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "printtune-package-application-"));
    const path = join(directory, "test.sqlite");
    try {
      let database = openPrintTuneDatabase(path);
      database.migrate();
      const workspaces = database.createWorkspaceRepository();
      const printers = database.createPrinterRepository();
      const states = database.createPrinterStateRepository();
      const lifecycle = database.createPrinterKnowledgeIdentityLifecyclePersistence();
      const identities = database.createPrinterKnowledgeIdentityRepository();
      const selection = database.createPrinterKnowledgeIdentitySelectionPersistence();
      const claims = database.createFieldClaimRepository();
      await workspaces.save(
        createWorkspace({ id: "workspace-a", name: "A", timestamp: BASE_TIME })
      );
      await printers.save(
        createPrinter({
          id: "printer-a",
          workspaceId: "workspace-a",
          name: "A",
          timestamp: BASE_TIME,
        })
      );
      await states.create(
        createPrinterState({ id: "state-a", printerId: "printer-a", timestamp: BASE_TIME })
      );
      await lifecycle.createAndSelect(knownIdentity());
      const activeWorkspace = new ActiveWorkspaceSession(workspaces);
      await activeWorkspace.setActiveWorkspace("workspace-a");
      const source: KnowledgePackageSource = {
        getExactPackage: async () => ({
          text: JSON.stringify(syntheticPackage({ publisherDisplayName: "No trust authority" })),
          trust: "customer_verified",
        }),
      };
      const ids = ["sqlite-claim-a", "sqlite-claim-b", "sqlite-claim-c"];
      const service = new PrinterKnowledgeApplicationService(
        printers,
        states,
        identities,
        selection,
        source,
        claims,
        activeWorkspace,
        { createClaimId: () => ids.shift() ?? "unexpected", now: () => BASE_TIME }
      );
      await service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-a",
      });
      database.close();

      database = openPrintTuneDatabase(path);
      database.migrate();
      const reopenedClaims = database.createFieldClaimRepository();
      const persisted = await reopenedClaims.listByTarget(TARGET);
      expect(persisted).toHaveLength(3);
      expect(persisted.every((claim) => claim.trust === "customer_verified")).toBe(true);
      expect(
        persisted.find((claim) => claim.fieldPath === "printer.nozzle.diameter")
      ).toMatchObject({
        value: { type: "number", value: 0.6 },
        provenance: { sourceRef: { factId: "model-nozzle" } },
      });
      await expect(
        new FieldResolutionService(reopenedClaims).resolve({
          target: TARGET,
          fieldPath: "printer.nozzle.diameter",
        })
      ).resolves.toMatchObject({ status: "resolved", value: { type: "number", value: 0.6 } });
      database.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
