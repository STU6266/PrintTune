import type { InstalledKnowledgePackage, PrinterKnowledgeIdentity } from "@printtune/contracts";
import {
  createInstalledKnowledgePackage,
  createPrinter,
  createPrinterKnowledgeIdentity,
  createPrinterState,
  createWorkspace,
} from "@printtune/core";
import {
  InMemoryInstalledKnowledgePackageRepository,
  InMemoryPrinterKnowledgeIdentityRepository,
  InMemoryPrinterKnowledgeIdentitySelectionPersistence,
  InMemoryPrinterRepository,
  InMemoryPrinterStateRepository,
  InMemoryPrinterStateSelectionPersistence,
  InMemoryWorkspaceRepository,
} from "@printtune/storage";
import { describe, expect, it, vi } from "vitest";

import { ActiveWorkspaceSession } from "../src/main/active-workspace-session";
import { InstalledKnowledgePackageSource } from "../src/main/installed-knowledge-package-source";
import { computeKnowledgePackageSha256 } from "../src/main/knowledge-package-sha256";
import {
  PrinterKnowledgeUiService,
  WorkingPrinterStateNotFoundError,
} from "../src/main/printer-knowledge-ui-service";
import {
  NoActiveWorkspaceError,
  PrinterNotFoundError,
} from "../src/main/printer-flow-application-service";

const TIMESTAMP = "2026-08-10T10:00:00.000Z";

interface PackageOptions {
  readonly packageId?: string;
  readonly packageVersion?: string;
  readonly manufacturerDisplayName?: string;
  readonly seriesDefinitionId?: string;
  readonly seriesDisplayName?: string;
  readonly minimumCoreVersion?: string;
  readonly models?: readonly Readonly<{
    modelDefinitionId: string;
    modelDisplayName: string;
  }>[];
}

function packageText(options: PackageOptions = {}): string {
  return JSON.stringify({
    formatVersion: 1,
    packageId: options.packageId ?? "example.synthetic-a",
    packageVersion: options.packageVersion ?? "1.0",
    packageType: "printer_series",
    displayName: "Synthetic Package",
    publisher: {
      publisherId: "example.synthetic-publisher",
      publisherDisplayName: "Synthetic Publisher",
    },
    coreCompatibility: { minimumVersion: options.minimumCoreVersion ?? "1.0.0" },
    payload: {
      series: {
        seriesDefinitionId: options.seriesDefinitionId ?? "series-a",
        manufacturerDisplayName: options.manufacturerDisplayName ?? "Synthetic Manufacturer",
        seriesDisplayName: options.seriesDisplayName ?? "Synthetic Series",
        facts: [
          {
            factId: "nozzle",
            fieldPath: "printer.nozzle.diameter",
            value: { type: "number", value: 0.4 },
            unit: "mm",
          },
        ],
        models: (options.models ?? []).map((model) => ({ ...model, facts: [] })),
      },
    },
  });
}

function installedRecord(
  rawText: string,
  overrides: Partial<InstalledKnowledgePackage> = {}
): InstalledKnowledgePackage {
  const parsed = JSON.parse(rawText) as { packageId?: string; packageVersion?: string };
  return createInstalledKnowledgePackage({
    packageId: parsed.packageId ?? "invalid-package",
    packageVersion: parsed.packageVersion ?? "invalid-version",
    formatVersion: 1,
    packageType: "printer_series",
    rawText,
    contentSha256: computeKnowledgePackageSha256(rawText),
    installationSource: "bundled_official",
    trust: "developer_verified",
    installedAt: TIMESTAMP,
    ...overrides,
  });
}

function knownIdentity(
  id: string,
  overrides: {
    readonly packageId?: string;
    readonly packageVersion?: string;
    readonly seriesDefinitionId?: string;
    readonly modelDefinitionId?: string;
    readonly selectedAt?: string;
  } = {}
): PrinterKnowledgeIdentity {
  return createPrinterKnowledgeIdentity({
    id,
    printerId: "printer-a",
    kind: "known",
    definitionRef: {
      packageId: overrides.packageId ?? "example.synthetic-a",
      packageVersion: overrides.packageVersion ?? "1.0",
      seriesDefinitionId: overrides.seriesDefinitionId ?? "series-a",
      ...(overrides.modelDefinitionId === undefined
        ? {}
        : { modelDefinitionId: overrides.modelDefinitionId }),
    },
    manufacturerDisplayName: "Historischer Hersteller",
    seriesDisplayName: "Historische Serie",
    ...(overrides.modelDefinitionId === undefined
      ? {}
      : { modelDisplayName: "Historisches Modell" }),
    selectedAt: overrides.selectedAt ?? TIMESTAMP,
  });
}

async function harness(options: { activeWorkspace?: boolean; workingState?: boolean } = {}) {
  const workspaces = new InMemoryWorkspaceRepository();
  await workspaces.save(createWorkspace({ id: "workspace-a", name: "A", timestamp: TIMESTAMP }));
  await workspaces.save(createWorkspace({ id: "workspace-b", name: "B", timestamp: TIMESTAMP }));
  const activeWorkspace = new ActiveWorkspaceSession(workspaces);
  if (options.activeWorkspace !== false) await activeWorkspace.setActiveWorkspace("workspace-a");

  const printers = new InMemoryPrinterRepository();
  await printers.save(
    createPrinter({
      id: "printer-a",
      workspaceId: "workspace-a",
      name: "A",
      timestamp: TIMESTAMP,
    })
  );
  await printers.save(
    createPrinter({
      id: "printer-b",
      workspaceId: "workspace-b",
      name: "B",
      timestamp: TIMESTAMP,
    })
  );
  const states = new InMemoryPrinterStateRepository();
  if (options.workingState !== false) {
    await states.create(
      createPrinterState({ id: "state-a", printerId: "printer-a", timestamp: TIMESTAMP })
    );
  }
  const stateSelection = new InMemoryPrinterStateSelectionPersistence(states);
  if (options.workingState !== false) {
    await stateSelection.setSelectedState("printer-a", "state-a");
  }

  const identities = new InMemoryPrinterKnowledgeIdentityRepository();
  const selection = new InMemoryPrinterKnowledgeIdentitySelectionPersistence(identities);
  const installed = new InMemoryInstalledKnowledgePackageRepository();
  const durableSource = new InstalledKnowledgePackageSource(installed);
  const getExactPackage = vi.fn(durableSource.getExactPackage.bind(durableSource));
  const service = new PrinterKnowledgeUiService(
    installed,
    { getExactPackage },
    identities,
    selection,
    printers,
    states,
    stateSelection,
    activeWorkspace
  );

  return {
    service,
    installed,
    identities,
    selection,
    printers,
    states,
    stateSelection,
    activeWorkspace,
    getExactPackage,
  };
}

describe("PrinterKnowledgeUiService catalog", () => {
  it("returns an empty frozen catalog", async () => {
    const { service } = await harness();
    await expect(service.listCatalog()).resolves.toEqual({ items: [], unusablePackageCount: 0 });
    expect(Object.isFrozen(await service.listCatalog())).toBe(true);
  });

  it("projects safe series and deterministically ordered model selections", async () => {
    const { service, installed } = await harness();
    await installed.accept(
      installedRecord(
        packageText({
          models: [
            { modelDefinitionId: "model-z", modelDisplayName: "Model A" },
            { modelDefinitionId: "model-a", modelDisplayName: "Model A" },
          ],
        })
      )
    );

    const catalog = await service.listCatalog();
    expect(catalog.items).toEqual([
      {
        selection: {
          packageId: "example.synthetic-a",
          packageVersion: "1.0",
          seriesDefinitionId: "series-a",
        },
        manufacturerDisplayName: "Synthetic Manufacturer",
        seriesDisplayName: "Synthetic Series",
        models: [
          {
            selection: {
              packageId: "example.synthetic-a",
              packageVersion: "1.0",
              seriesDefinitionId: "series-a",
              modelDefinitionId: "model-a",
            },
            modelDisplayName: "Model A",
          },
          expect.objectContaining({
            selection: expect.objectContaining({ modelDefinitionId: "model-z" }),
          }),
        ],
      },
    ]);
    expect(Object.isFrozen(catalog.items)).toBe(true);
    expect(Object.isFrozen(catalog.items[0]?.models)).toBe(true);
  });

  it("excludes raw content, trust, installation metadata, facts, and fact IDs", async () => {
    const { service, installed } = await harness();
    await installed.accept(installedRecord(packageText()));
    const serialized = JSON.stringify((await service.listCatalog()).items[0]);
    for (const forbidden of [
      "rawText",
      "trust",
      "installationSource",
      "contentSha256",
      "installedAt",
      "facts",
      "factId",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("orders exact entries deterministically without collapsing versions or display collisions", async () => {
    const { service, installed } = await harness();
    for (const options of [
      { packageId: "p-z", packageVersion: "1.0", manufacturerDisplayName: "B" },
      { packageId: "p-b", packageVersion: "1.1", manufacturerDisplayName: "A" },
      { packageId: "p-b", packageVersion: "1.0", manufacturerDisplayName: "A" },
      { packageId: "p-a", packageVersion: "opaque", manufacturerDisplayName: "A" },
    ]) {
      await installed.accept(installedRecord(packageText(options)));
    }

    expect(
      (await service.listCatalog()).items.map(({ selection }) => [
        selection.packageId,
        selection.packageVersion,
      ])
    ).toEqual([
      ["p-a", "opaque"],
      ["p-b", "1.0"],
      ["p-b", "1.1"],
      ["p-z", "1.0"],
    ]);
  });

  it("omits corrupt, malformed, and Core-incompatible packages with a safe count", async () => {
    const { service, installed } = await harness();
    const corruptText = packageText({ packageId: "corrupt" });
    await installed.accept(installedRecord(corruptText, { contentSha256: "a".repeat(64) }));
    await installed.accept(
      installedRecord("{}", { packageId: "malformed", packageVersion: "1.0" })
    );
    await installed.accept(
      installedRecord(packageText({ packageId: "future", minimumCoreVersion: "999.0.0" }))
    );

    await expect(service.listCatalog()).resolves.toEqual({
      items: [],
      unusablePackageCount: 3,
    });
  });
});

describe("PrinterKnowledgeUiService status", () => {
  it("returns no_selection with the exact working state and performs no writes", async () => {
    const fixture = await harness();
    const accept = vi.spyOn(fixture.installed, "accept");
    const create = vi.spyOn(fixture.identities, "create");
    const setSelected = vi.spyOn(fixture.selection, "setSelectedIdentity");

    await expect(fixture.service.getPrinterKnowledgeStatus("printer-a")).resolves.toEqual({
      kind: "no_selection",
      printerState: { id: "state-a", label: "Aktueller Druckerzustand" },
    });
    expect(accept).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(setSelected).not.toHaveBeenCalled();
  });

  it("returns explicit unclassified without querying packages", async () => {
    const fixture = await harness();
    const identity = createPrinterKnowledgeIdentity({
      id: "unclassified",
      printerId: "printer-a",
      kind: "unclassified",
      selectedAt: TIMESTAMP,
    });
    await fixture.identities.create(identity);
    await fixture.selection.setSelectedIdentity("printer-a", identity.id);
    fixture.getExactPackage.mockClear();

    await expect(fixture.service.getPrinterKnowledgeStatus("printer-a")).resolves.toEqual({
      kind: "unclassified",
      printerState: { id: "state-a", label: "Aktueller Druckerzustand" },
    });
    expect(fixture.getExactPackage).not.toHaveBeenCalled();
  });

  it("uses the selected identity snapshot and exact available package", async () => {
    const fixture = await harness();
    await fixture.installed.accept(
      installedRecord(
        packageText({
          manufacturerDisplayName: "Current package label",
          models: [{ modelDefinitionId: "model-a", modelDisplayName: "Current model label" }],
        })
      )
    );
    const identity = knownIdentity("identity-a", { modelDefinitionId: "model-a" });
    await fixture.identities.create(identity);
    await fixture.selection.setSelectedIdentity("printer-a", identity.id);

    await expect(fixture.service.getPrinterKnowledgeStatus("printer-a")).resolves.toMatchObject({
      kind: "known",
      manufacturerDisplayName: "Historischer Hersteller",
      seriesDisplayName: "Historische Serie",
      modelDisplayName: "Historisches Modell",
      packageAvailability: "available",
    });
  });

  it("keeps a known snapshot when the exact package is unavailable", async () => {
    const fixture = await harness();
    const identity = knownIdentity("identity-a");
    await fixture.identities.create(identity);
    await fixture.selection.setSelectedIdentity("printer-a", identity.id);
    await expect(fixture.service.getPrinterKnowledgeStatus("printer-a")).resolves.toMatchObject({
      kind: "known",
      manufacturerDisplayName: "Historischer Hersteller",
      packageAvailability: "unavailable",
    });
  });

  it.each([
    ["series mismatch", { seriesDefinitionId: "missing-series" }],
    ["missing model", { modelDefinitionId: "missing-model" }],
  ] as const)(
    "marks an available exact package unusable for %s",
    async (_label, identityOverrides) => {
      const fixture = await harness();
      await fixture.installed.accept(installedRecord(packageText()));
      const identity = knownIdentity("identity-a", identityOverrides);
      await fixture.identities.create(identity);
      await fixture.selection.setSelectedIdentity("printer-a", identity.id);
      await expect(fixture.service.getPrinterKnowledgeStatus("printer-a")).resolves.toMatchObject({
        kind: "known",
        packageAvailability: "unusable",
      });
    }
  );

  it.each([
    ["digest corruption", packageText(), "a".repeat(64)],
    ["invalid package", "{}", undefined],
    ["Core incompatibility", packageText({ minimumCoreVersion: "999.0.0" }), undefined],
  ] as const)("marks installed %s unusable", async (_label, rawText, digest) => {
    const fixture = await harness();
    await fixture.installed.accept(
      installedRecord(rawText, {
        packageId: "example.synthetic-a",
        packageVersion: "1.0",
        ...(digest === undefined ? {} : { contentSha256: digest }),
      })
    );
    const identity = knownIdentity("identity-a");
    await fixture.identities.create(identity);
    await fixture.selection.setSelectedIdentity("printer-a", identity.id);
    await expect(fixture.service.getPrinterKnowledgeStatus("printer-a")).resolves.toMatchObject({
      kind: "known",
      packageAvailability: "unusable",
    });
  });

  it("uses explicit selection rather than the chronologically newest history item", async () => {
    const fixture = await harness();
    const selected = knownIdentity("selected", { selectedAt: "2026-08-09T10:00:00.000Z" });
    const newer = createPrinterKnowledgeIdentity({
      id: "newer",
      printerId: "printer-a",
      kind: "unclassified",
      selectedAt: "2026-08-10T11:00:00.000Z",
    });
    await fixture.identities.create(selected);
    await fixture.identities.create(newer);
    await fixture.selection.setSelectedIdentity("printer-a", selected.id);

    await expect(fixture.service.getPrinterKnowledgeStatus("printer-a")).resolves.toMatchObject({
      kind: "known",
      manufacturerDisplayName: "Historischer Hersteller",
    });
  });

  it("projects the exact working State while keeping the lifetime identity unchanged", async () => {
    const fixture = await harness();
    const identity = knownIdentity("identity-a");
    await fixture.identities.create(identity);
    await fixture.selection.setSelectedIdentity("printer-a", identity.id);
    await fixture.states.create(
      createPrinterState({
        id: "state-newer",
        printerId: "printer-a",
        timestamp: "2026-08-10T11:00:00.000Z",
      })
    );

    await expect(fixture.service.getPrinterKnowledgeStatus("printer-a")).resolves.toMatchObject({
      kind: "known",
      printerState: { id: "state-a", label: "Aktueller Druckerzustand" },
      manufacturerDisplayName: "Historischer Hersteller",
    });
    await fixture.stateSelection.setSelectedState("printer-a", "state-newer");
    await expect(fixture.service.getPrinterKnowledgeStatus("printer-a")).resolves.toMatchObject({
      kind: "known",
      printerState: { id: "state-newer", label: "Aktueller Druckerzustand" },
      manufacturerDisplayName: "Historischer Hersteller",
    });
    await expect(fixture.selection.getSelectedIdentityId("printer-a")).resolves.toBe(identity.id);
  });

  it("enforces active Workspace authorization", async () => {
    const fixture = await harness();
    await expect(fixture.service.getPrinterKnowledgeStatus("printer-b")).rejects.toBeInstanceOf(
      PrinterNotFoundError
    );
    const withoutWorkspace = await harness({ activeWorkspace: false });
    await expect(
      withoutWorkspace.service.getPrinterKnowledgeStatus("printer-a")
    ).rejects.toBeInstanceOf(NoActiveWorkspaceError);
  });

  it("rejects a missing working selection explicitly", async () => {
    const fixture = await harness({ workingState: false });
    await expect(fixture.service.getPrinterKnowledgeStatus("printer-a")).rejects.toBeInstanceOf(
      WorkingPrinterStateNotFoundError
    );
  });

  it("rejects selected-state data belonging to another Printer", async () => {
    const fixture = await harness();
    const foreignState = createPrinterState({
      id: "state-b",
      printerId: "printer-b",
      timestamp: TIMESTAMP,
    });
    const service = new PrinterKnowledgeUiService(
      fixture.installed,
      { getExactPackage: fixture.getExactPackage },
      fixture.identities,
      fixture.selection,
      fixture.printers,
      {
        create: vi.fn(),
        findById: vi.fn(async () => foreignState),
        listByPrinterId: vi.fn(async () => [foreignState]),
      },
      fixture.stateSelection,
      fixture.activeWorkspace
    );

    await expect(service.getPrinterKnowledgeStatus("printer-a")).rejects.toBeInstanceOf(
      WorkingPrinterStateNotFoundError
    );
  });
});
