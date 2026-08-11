import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  PackageApplication,
  PrinterKnowledgeIdentity,
  PrinterSeriesKnowledgePackageV1,
} from "@printtune/contracts";
import {
  createFieldClaim,
  createPackageApplication,
  createPrinter,
  createPrinterKnowledgeIdentity,
  createPrinterState,
  createWorkspace,
} from "@printtune/core";
import {
  InMemoryPackageApplicationPersistence,
  InMemoryPrinterKnowledgeIdentityLifecyclePersistence,
  InMemoryPrinterRepository,
  InMemoryPrinterStateRepository,
  InMemoryPrinterStateSelectionPersistence,
  InMemoryWorkspaceRepository,
  openPrintTuneDatabase,
} from "@printtune/storage";
import { describe, expect, it, vi } from "vitest";

import { ActiveWorkspaceSession } from "../src/main/active-workspace-session";
import { FieldResolutionService } from "../src/main/field-resolution-service";
import type { KnowledgePackageSource } from "../src/main/knowledge-package-source";
import { PrinterKnowledgeApplicationService } from "../src/main/printer-knowledge-application-service";
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
    packageTrust?: "developer_verified" | "customer_verified";
    claimIds?: string[];
    times?: string[];
  } = {}
) {
  const workspaces = new InMemoryWorkspaceRepository();
  const printers = new InMemoryPrinterRepository();
  const states = new InMemoryPrinterStateRepository();
  const identities = new InMemoryPrinterKnowledgeIdentityLifecyclePersistence();
  const applications = new InMemoryPackageApplicationPersistence();
  const claims = applications.asFieldClaimRepository();
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
  const stateSelection = new InMemoryPrinterStateSelectionPersistence(states);
  await stateSelection.setSelectedState("printer-a", "state-a");
  await stateSelection.setSelectedState("printer-b", "state-b");
  await activeWorkspace.setActiveWorkspace("workspace-a");
  if (options.identity !== null)
    await identities.createAndSelect(options.identity ?? knownIdentity());

  const getExactPackage = vi.fn<KnowledgePackageSource["getExactPackage"]>(async (reference) =>
    reference.packageId === "example.synthetic-series" && reference.packageVersion === "1.0"
      ? {
          text: options.packageText ?? JSON.stringify(syntheticPackage()),
          trust: options.packageTrust ?? "developer_verified",
        }
      : undefined
  );
  const packageSource: KnowledgePackageSource = { getExactPackage };
  const claimIds = options.claimIds ?? ["claim-a", "claim-b", "claim-c", "claim-d"];
  const times = options.times ?? [BASE_TIME];
  const createApplicationId = vi.fn(() => "application-a");
  const createClaimId = vi.fn(() => claimIds.shift() ?? "claim-unexpected");
  const now = vi.fn(() => times.shift() ?? BASE_TIME);
  const service = new PrinterKnowledgeApplicationService(
    printers,
    states,
    identities,
    identities,
    packageSource,
    applications,
    applications,
    stateSelection,
    activeWorkspace,
    {
      createApplicationId,
      createClaimId,
      now,
    }
  );
  return {
    workspaces,
    printers,
    states,
    identities,
    claims,
    applications,
    stateSelection,
    activeWorkspace,
    getExactPackage,
    createApplicationId,
    createClaimId,
    now,
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
      status: "applied",
      printerId: "printer-a",
      printerStateId: "state-a",
    });
    expect(Object.isFrozen(result)).toBe(true);
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
    expect(fixture.now).toHaveBeenCalledTimes(1);
    expect(fixture.createApplicationId).toHaveBeenCalledTimes(1);
    expect((await fixture.applications.listForPrinterState("state-a"))[0]).toMatchObject({
      appliedAt: BASE_TIME,
      packageTrust: "developer_verified",
    });
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

  it("runtime-validates the closed command before authorization or lookup", async () => {
    const fixture = await createMemoryFixture();
    await expect(
      fixture.service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-a",
        extra: true,
      } as never)
    ).rejects.toMatchObject({ code: "invalid_command" });
    expect(fixture.getExactPackage).not.toHaveBeenCalled();
  });

  it("projects no-selection, unclassified, and known application status without package lookup", async () => {
    const noSelection = await createMemoryFixture({ identity: null });
    await expect(
      noSelection.service.getApplicationStatus({
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).resolves.toEqual({ kind: "no_selection" });

    const unclassified = await createMemoryFixture({
      identity: createPrinterKnowledgeIdentity({
        id: "identity-a",
        printerId: "printer-a",
        kind: "unclassified",
        selectedAt: BASE_TIME,
      }),
    });
    await expect(
      unclassified.service.getApplicationStatus({
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).resolves.toEqual({ kind: "unclassified" });

    const known = await createMemoryFixture();
    await expect(
      known.service.getApplicationStatus({ printerId: "printer-a", printerStateId: "state-a" })
    ).resolves.toEqual({ kind: "known", applicationStatus: "not_applied" });
    await known.service.applyCurrentKnowledgeToPrinterState({
      printerId: "printer-a",
      printerStateId: "state-a",
    });
    known.getExactPackage.mockClear();
    await expect(
      known.service.getApplicationStatus({ printerId: "printer-a", printerStateId: "state-a" })
    ).resolves.toEqual({ kind: "known", applicationStatus: "applied" });
    expect(known.getExactPackage).not.toHaveBeenCalled();
  });

  it("returns already_applied without package, IDs, timestamp, or Claim generation", async () => {
    const fixture = await createMemoryFixture();
    await fixture.service.applyCurrentKnowledgeToPrinterState({
      printerId: "printer-a",
      printerStateId: "state-a",
    });
    fixture.getExactPackage.mockReset();
    fixture.createApplicationId.mockClear();
    fixture.createClaimId.mockClear();
    fixture.now.mockClear();
    await expect(
      fixture.service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).resolves.toEqual({
      status: "already_applied",
      printerId: "printer-a",
      printerStateId: "state-a",
    });
    expect(fixture.getExactPackage).not.toHaveBeenCalled();
    expect(fixture.createApplicationId).not.toHaveBeenCalled();
    expect(fixture.createClaimId).not.toHaveBeenCalled();
    expect(fixture.now).not.toHaveBeenCalled();
  });

  it("rejects a new Apply when the requested State is no longer working", async () => {
    const fixture = await createMemoryFixture();
    await fixture.states.create(
      createPrinterState({ id: "state-c", printerId: "printer-a", timestamp: SECOND_TIME })
    );
    await fixture.stateSelection.setSelectedState("printer-a", "state-c");

    await expect(
      fixture.service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).rejects.toMatchObject({ code: "stale_printer_state" });
    await expect(fixture.applications.listForPrinterState("state-a")).resolves.toEqual([]);
    await expect(fixture.claims.listByTarget(TARGET)).resolves.toEqual([]);
  });

  it("returns already_applied for an exact historical retry after selection advances", async () => {
    const fixture = await createMemoryFixture();
    await fixture.service.applyCurrentKnowledgeToPrinterState({
      printerId: "printer-a",
      printerStateId: "state-a",
    });
    await fixture.states.create(
      createPrinterState({ id: "state-c", printerId: "printer-a", timestamp: SECOND_TIME })
    );
    await fixture.stateSelection.setSelectedState("printer-a", "state-c");

    await expect(
      fixture.service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).resolves.toMatchObject({ status: "already_applied", printerStateId: "state-a" });
    await expect(fixture.stateSelection.getSelectedStateId("printer-a")).resolves.toBe("state-c");
    await expect(fixture.applications.listForPrinterState("state-a")).resolves.toHaveLength(1);
  });

  it("propagates an authoritative storage-race already_applied result", async () => {
    const fixture = await createMemoryFixture();
    const applyOnce = vi.fn(async (application: PackageApplication) => ({
      status: "already_applied" as const,
      application,
    }));
    const service = new PrinterKnowledgeApplicationService(
      fixture.printers,
      fixture.states,
      fixture.identities,
      fixture.identities,
      { getExactPackage: fixture.getExactPackage },
      fixture.applications,
      { applyOnce },
      fixture.stateSelection,
      fixture.activeWorkspace,
      {
        createApplicationId: () => "race-candidate",
        createClaimId: fixture.createClaimId,
        now: fixture.now,
      }
    );
    await expect(
      service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).resolves.toMatchObject({ status: "already_applied" });
    expect(applyOnce).toHaveBeenCalledTimes(1);
  });

  it("does not treat an older Core-contract application as currently applied", async () => {
    const fixture = await createMemoryFixture();
    await fixture.applications.applyOnce(
      createPackageApplication({
        id: "historical-application",
        printerId: "printer-a",
        printerStateId: "state-a",
        printerKnowledgeIdentityId: "identity-a",
        packageId: "example.synthetic-series",
        packageVersion: "1.0",
        seriesDefinitionId: "synthetic-series",
        modelDefinitionId: "synthetic-model",
        coreContractVersion: "0.9.0",
        packageTrust: "developer_verified",
        timestamp: BASE_TIME,
      }),
      []
    );
    await expect(
      fixture.service.getApplicationStatus({ printerId: "printer-a", printerStateId: "state-a" })
    ).resolves.toEqual({ kind: "known", applicationStatus: "not_applied" });
  });

  it("does not infer application history from legacy unlinked package Claims", async () => {
    const fixture = await createMemoryFixture();
    await fixture.claims.create(
      createFieldClaim({
        id: "legacy-package-claim",
        target: TARGET,
        fieldPath: "printer.nozzle.diameter",
        value: { type: "number", value: 0.4 },
        unit: "mm",
        provenance: {
          sourceType: "knowledge_package",
          sourceRef: {
            type: "knowledge_package",
            packageId: "example.synthetic-series",
            packageVersion: "1.0",
            factId: "series-nozzle",
          },
        },
        trust: "developer_verified",
        timestamp: "2026-08-08T10:00:00.000Z",
      })
    );
    await expect(
      fixture.service.getApplicationStatus({ printerId: "printer-a", printerStateId: "state-a" })
    ).resolves.toEqual({ kind: "known", applicationStatus: "not_applied" });
    await expect(
      fixture.service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).resolves.toMatchObject({ status: "applied" });
    expect(await fixture.claims.listByTarget(TARGET)).toHaveLength(4);
    await expect(
      fixture.service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).resolves.toMatchObject({ status: "already_applied" });
    expect(await fixture.applications.listClaimIds("application-a")).toEqual([
      "claim-a",
      "claim-b",
      "claim-c",
    ]);
  });

  it("follows current semantic identity through A to B to equivalent A", async () => {
    const fixture = await createMemoryFixture();
    await fixture.service.applyCurrentKnowledgeToPrinterState({
      printerId: "printer-a",
      printerStateId: "state-a",
    });
    await fixture.identities.createAndSelect(
      createPrinterKnowledgeIdentity({
        id: "identity-b",
        printerId: "printer-a",
        kind: "known",
        definitionRef: {
          packageId: "example.synthetic-series",
          packageVersion: "1.0",
          seriesDefinitionId: "synthetic-series",
        },
        manufacturerDisplayName: "Synthetic Manufacturer",
        seriesDisplayName: "Synthetic Series",
        selectedAt: SECOND_TIME,
      })
    );
    await expect(
      fixture.service.getApplicationStatus({ printerId: "printer-a", printerStateId: "state-a" })
    ).resolves.toEqual({ kind: "known", applicationStatus: "not_applied" });
    await fixture.identities.createAndSelect(
      createPrinterKnowledgeIdentity({
        id: "identity-a-returned",
        printerId: "printer-a",
        kind: "known",
        definitionRef: {
          packageId: "example.synthetic-series",
          packageVersion: "1.0",
          seriesDefinitionId: "synthetic-series",
          modelDefinitionId: "synthetic-model",
        },
        manufacturerDisplayName: "Synthetic Manufacturer",
        seriesDisplayName: "Synthetic Series",
        modelDisplayName: "Synthetic Model",
        selectedAt: "2026-08-09T10:02:00.000Z",
      })
    );
    fixture.getExactPackage.mockClear();
    await expect(
      fixture.service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).resolves.toMatchObject({ status: "already_applied" });
    expect(fixture.getExactPackage).not.toHaveBeenCalled();
    expect((await fixture.applications.listForPrinterState("state-a"))[0]).toMatchObject({
      printerKnowledgeIdentityId: "identity-a",
    });
  });

  it("finishes with the exact identity loaded before classification changes", async () => {
    const fixture = await createMemoryFixture();
    fixture.getExactPackage.mockImplementationOnce(async () => {
      await fixture.identities.createAndSelect(
        createPrinterKnowledgeIdentity({
          id: "identity-b",
          printerId: "printer-a",
          kind: "unclassified",
          selectedAt: SECOND_TIME,
        })
      );
      return {
        text: JSON.stringify(syntheticPackage()),
        trust: "developer_verified",
      };
    });
    await fixture.service.applyCurrentKnowledgeToPrinterState({
      printerId: "printer-a",
      printerStateId: "state-a",
    });
    expect((await fixture.applications.listForPrinterState("state-a"))[0]).toMatchObject({
      printerKnowledgeIdentityId: "identity-a",
    });
    await expect(
      fixture.service.getApplicationStatus({ printerId: "printer-a", printerStateId: "state-a" })
    ).resolves.toEqual({ kind: "unclassified" });
  });

  it("records and deduplicates a compatible zero-fact package", async () => {
    const basePackage = syntheticPackage();
    const emptyPackage: PrinterSeriesKnowledgePackageV1 = {
      ...basePackage,
      payload: { series: { ...basePackage.payload.series, facts: [], models: [] } },
    };
    const fixture = await createMemoryFixture({
      identity: knownIdentity(false),
      packageText: JSON.stringify(emptyPackage),
    });
    await expect(
      fixture.service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).resolves.toMatchObject({ status: "applied" });
    await expect(fixture.claims.listByTarget(TARGET)).resolves.toEqual([]);
    await expect(
      fixture.service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).resolves.toMatchObject({ status: "already_applied" });
    await expect(
      fixture.service.getApplicationStatus({ printerId: "printer-a", printerStateId: "state-a" })
    ).resolves.toEqual({ kind: "known", applicationStatus: "applied" });
  });

  it("applies the same current identity independently to different PrinterStates", async () => {
    const fixture = await createMemoryFixture({
      claimIds: ["a-1", "a-2", "a-3", "c-1", "c-2", "c-3"],
    });
    await fixture.states.create(
      createPrinterState({ id: "state-c", printerId: "printer-a", timestamp: SECOND_TIME })
    );
    const applicationIds = ["application-a", "application-c"];
    const service = new PrinterKnowledgeApplicationService(
      fixture.printers,
      fixture.states,
      fixture.identities,
      fixture.identities,
      { getExactPackage: fixture.getExactPackage },
      fixture.applications,
      fixture.applications,
      fixture.stateSelection,
      fixture.activeWorkspace,
      {
        createApplicationId: () => applicationIds.shift() ?? "unexpected",
        createClaimId: fixture.createClaimId,
        now: fixture.now,
      }
    );
    await expect(
      service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).resolves.toMatchObject({ status: "applied" });
    await fixture.stateSelection.setSelectedState("printer-a", "state-c");
    await expect(
      service.getApplicationStatus({ printerId: "printer-a", printerStateId: "state-c" })
    ).resolves.toEqual({ kind: "known", applicationStatus: "not_applied" });
    await expect(
      service.applyCurrentKnowledgeToPrinterState({
        printerId: "printer-a",
        printerStateId: "state-c",
      })
    ).resolves.toMatchObject({ status: "applied" });
    expect(await fixture.applications.listForPrinterState("state-a")).toHaveLength(1);
    expect(await fixture.applications.listForPrinterState("state-c")).toHaveLength(1);
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
        fixture.applications,
        fixture.applications,
        fixture.stateSelection,
        fixture.activeWorkspace,
        { createApplicationId: createId, createClaimId: createId, now: () => BASE_TIME }
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

  it("applies once and returns already_applied without a second Claim batch", async () => {
    const fixture = await createMemoryFixture({
      claimIds: ["a-1", "a-2", "a-3", "b-1", "b-2", "b-3"],
      times: [BASE_TIME, SECOND_TIME],
    });
    await fixture.service.applyCurrentKnowledgeToPrinterState({
      printerId: "printer-a",
      printerStateId: "state-a",
    });
    const second = await fixture.service.applyCurrentKnowledgeToPrinterState({
      printerId: "printer-a",
      printerStateId: "state-a",
    });
    const claims = await fixture.claims.listByTarget(TARGET);
    expect(second.status).toBe("already_applied");
    expect(claims).toHaveLength(3);
    expect(new Set(claims.map((claim) => claim.createdAt))).toEqual(new Set([BASE_TIME]));
    expect(fixture.getExactPackage).toHaveBeenCalledTimes(1);
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
      await database
        .createPrinterStateSelectionPersistence()
        .setSelectedState("printer-a", "state-a");
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
        database.createPackageApplicationRepository(),
        database.createPackageApplicationLifecyclePersistence(),
        database.createPrinterStateSelectionPersistence(),
        activeWorkspace,
        {
          createApplicationId: () => "sqlite-application-a",
          createClaimId: () => ids.shift() ?? "unexpected",
          now: () => BASE_TIME,
        }
      );
      await expect(
        service.applyCurrentKnowledgeToPrinterState({
          printerId: "printer-a",
          printerStateId: "state-a",
        })
      ).resolves.toMatchObject({ status: "applied" });
      database.close();

      database = openPrintTuneDatabase(path);
      database.migrate();
      const reopenedClaims = database.createFieldClaimRepository();
      const reopenedApplications = database.createPackageApplicationRepository();
      const unavailableSource = vi.fn<KnowledgePackageSource["getExactPackage"]>(
        async () => undefined
      );
      const reopenedWorkspace = new ActiveWorkspaceSession(database.createWorkspaceRepository());
      await reopenedWorkspace.setActiveWorkspace("workspace-a");
      const reopenedService = new PrinterKnowledgeApplicationService(
        database.createPrinterRepository(),
        database.createPrinterStateRepository(),
        database.createPrinterKnowledgeIdentityRepository(),
        database.createPrinterKnowledgeIdentitySelectionPersistence(),
        { getExactPackage: unavailableSource },
        reopenedApplications,
        database.createPackageApplicationLifecyclePersistence(),
        database.createPrinterStateSelectionPersistence(),
        reopenedWorkspace,
        {
          createApplicationId: () => "must-not-be-used",
          createClaimId: () => "must-not-be-used",
          now: () => SECOND_TIME,
        }
      );
      await expect(
        reopenedService.applyCurrentKnowledgeToPrinterState({
          printerId: "printer-a",
          printerStateId: "state-a",
        })
      ).resolves.toMatchObject({ status: "already_applied" });
      await expect(
        reopenedService.getApplicationStatus({
          printerId: "printer-a",
          printerStateId: "state-a",
        })
      ).resolves.toEqual({ kind: "known", applicationStatus: "applied" });
      expect(unavailableSource).not.toHaveBeenCalled();
      const applicationHistory = await reopenedApplications.listForPrinterState("state-a");
      expect(applicationHistory).toHaveLength(1);
      expect(applicationHistory[0]).toMatchObject({
        packageTrust: "customer_verified",
        appliedAt: BASE_TIME,
      });
      expect(await reopenedApplications.listClaimIds(applicationHistory[0]!.id)).toEqual([
        "sqlite-claim-a",
        "sqlite-claim-b",
        "sqlite-claim-c",
      ]);
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
