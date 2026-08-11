import type { InstalledKnowledgePackage } from "@printtune/contracts";
import {
  createInstalledKnowledgePackage,
  createPrinter,
  createPrinterKnowledgeIdentity,
  createPrinterState,
  createWorkspace,
} from "@printtune/core";
import {
  InMemoryInstalledKnowledgePackageRepository,
  InMemoryPrinterKnowledgeIdentityLifecyclePersistence,
  InMemoryPrinterRepository,
  InMemoryPrinterStateRepository,
  InMemoryPrinterStateSelectionPersistence,
  InMemoryWorkspaceRepository,
} from "@printtune/storage";
import { describe, expect, it, vi } from "vitest";

import { ActiveWorkspaceSession } from "../src/main/active-workspace-session";
import {
  InvalidPrinterKnowledgeClassificationCommandError,
  InvalidPrinterKnowledgeModelSelectionError,
  InvalidPrinterKnowledgeSeriesSelectionError,
  PrinterKnowledgeClassificationService,
  PrinterKnowledgePackageIncompatibleError,
  PrinterKnowledgePackageUnavailableError,
  PrinterKnowledgePackageUnusableError,
} from "../src/main/printer-knowledge-classification-service";
import { PrinterKnowledgeIdentityApplicationService } from "../src/main/printer-knowledge-identity-application-service";
import { InstalledKnowledgePackageSource } from "../src/main/installed-knowledge-package-source";
import { computeKnowledgePackageSha256 } from "../src/main/knowledge-package-sha256";
import { PrinterKnowledgeUiService } from "../src/main/printer-knowledge-ui-service";
import {
  NoActiveWorkspaceError,
  PrinterNotFoundError,
} from "../src/main/printer-flow-application-service";

const TIMESTAMP = "2026-08-10T10:00:00.000Z";

function packageText(
  options: {
    packageId?: string;
    packageVersion?: string;
    seriesDefinitionId?: string;
    manufacturerDisplayName?: string;
    seriesDisplayName?: string;
    minimumCoreVersion?: string;
    models?: readonly { modelDefinitionId: string; modelDisplayName: string }[];
  } = {}
): string {
  return JSON.stringify({
    formatVersion: 1,
    packageId: options.packageId ?? "example.printer",
    packageVersion: options.packageVersion ?? "opaque-1",
    packageType: "printer_series",
    displayName: "Synthetic",
    publisher: { publisherId: "example.publisher", publisherDisplayName: "Publisher" },
    coreCompatibility: { minimumVersion: options.minimumCoreVersion ?? "1.0.0" },
    payload: {
      series: {
        seriesDefinitionId: options.seriesDefinitionId ?? "series-a",
        manufacturerDisplayName: options.manufacturerDisplayName ?? "Trusted Manufacturer",
        seriesDisplayName: options.seriesDisplayName ?? "Trusted Series",
        facts: [],
        models: (options.models ?? []).map((model) => ({ ...model, facts: [] })),
      },
    },
  });
}

function installedRecord(rawText: string, overrides: Partial<InstalledKnowledgePackage> = {}) {
  const value = JSON.parse(rawText) as { packageId: string; packageVersion: string };
  return createInstalledKnowledgePackage({
    packageId: value.packageId,
    packageVersion: value.packageVersion,
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

async function harness(options: { active?: boolean; failWrite?: boolean } = {}) {
  const workspaces = new InMemoryWorkspaceRepository();
  await workspaces.save(createWorkspace({ id: "workspace-a", name: "A", timestamp: TIMESTAMP }));
  await workspaces.save(createWorkspace({ id: "workspace-b", name: "B", timestamp: TIMESTAMP }));
  const activeWorkspace = new ActiveWorkspaceSession(workspaces);
  if (options.active !== false) await activeWorkspace.setActiveWorkspace("workspace-a");
  const printers = new InMemoryPrinterRepository();
  await printers.save(
    createPrinter({ id: "printer-a", workspaceId: "workspace-a", name: "A", timestamp: TIMESTAMP })
  );
  await printers.save(
    createPrinter({ id: "printer-b", workspaceId: "workspace-b", name: "B", timestamp: TIMESTAMP })
  );
  const states = new InMemoryPrinterStateRepository();
  await states.create(
    createPrinterState({ id: "state-a", printerId: "printer-a", timestamp: TIMESTAMP })
  );
  const store = new InMemoryPrinterKnowledgeIdentityLifecyclePersistence({
    ...(options.failWrite
      ? {
          beforeSelection: () => {
            throw new Error("write failed");
          },
        }
      : {}),
  });
  let nextId = 0;
  const identityService = new PrinterKnowledgeIdentityApplicationService(
    store,
    store,
    store,
    printers,
    activeWorkspace,
    { createIdentityId: () => `identity-${++nextId}`, now: () => TIMESTAMP }
  );
  const installed = new InMemoryInstalledKnowledgePackageRepository();
  const source = new InstalledKnowledgePackageSource(installed);
  const getExactPackage = vi.fn(source.getExactPackage.bind(source));
  const classification = new PrinterKnowledgeClassificationService(
    { getExactPackage },
    identityService
  );
  const stateSelection = new InMemoryPrinterStateSelectionPersistence(states);
  await stateSelection.setSelectedState("printer-a", "state-a");
  const ui = new PrinterKnowledgeUiService(
    installed,
    { getExactPackage },
    store,
    store,
    printers,
    states,
    stateSelection,
    activeWorkspace
  );
  return {
    classification,
    identityService,
    installed,
    store,
    getExactPackage,
    activeWorkspace,
    ui,
  };
}

const SERIES_COMMAND = {
  printerId: "printer-a",
  selection: {
    packageId: "example.printer",
    packageVersion: "opaque-1",
    seriesDefinitionId: "series-a",
  },
};

describe("PrinterKnowledgeClassificationService", () => {
  it("selects a revalidated series-only identity using trusted display snapshots", async () => {
    const { classification, installed, identityService } = await harness();
    await installed.accept(installedRecord(packageText()));
    await expect(classification.classifyKnownPrinter(SERIES_COMMAND)).resolves.toEqual({
      status: "selected",
      classification: {
        kind: "known",
        selection: SERIES_COMMAND.selection,
        manufacturerDisplayName: "Trusted Manufacturer",
        seriesDisplayName: "Trusted Series",
      },
    });
    await expect(identityService.getCurrentIdentity("printer-a")).resolves.toMatchObject({
      kind: "known",
      manufacturerDisplayName: "Trusted Manufacturer",
      seriesDisplayName: "Trusted Series",
      definitionRef: SERIES_COMMAND.selection,
    });
  });

  it("selects an exact model without choosing a model when it is omitted", async () => {
    const { classification, installed, identityService } = await harness();
    await installed.accept(
      installedRecord(
        packageText({
          models: [{ modelDefinitionId: "model-x", modelDisplayName: "Trusted Model" }],
        })
      )
    );
    await classification.classifyKnownPrinter({
      ...SERIES_COMMAND,
      selection: { ...SERIES_COMMAND.selection, modelDefinitionId: "model-x" },
    });
    await expect(identityService.getCurrentIdentity("printer-a")).resolves.toMatchObject({
      modelDisplayName: "Trusted Model",
    });
  });

  it("rejects forged renderer display fields through closed runtime validation", async () => {
    const { classification, installed, store } = await harness();
    await installed.accept(installedRecord(packageText()));
    await expect(
      classification.classifyKnownPrinter({
        ...SERIES_COMMAND,
        manufacturerDisplayName: "Fake Corp",
      })
    ).rejects.toBeInstanceOf(InvalidPrinterKnowledgeClassificationCommandError);
    await expect(store.listByPrinterId("printer-a")).resolves.toEqual([]);
  });

  it.each([
    ["missing printer ID", { ...SERIES_COMMAND, printerId: "" }],
    [
      "padded package ID",
      {
        ...SERIES_COMMAND,
        selection: { ...SERIES_COMMAND.selection, packageId: " example.printer" },
      },
    ],
    [
      "undefined model property",
      {
        ...SERIES_COMMAND,
        selection: { ...SERIES_COMMAND.selection, modelDefinitionId: undefined },
      },
    ],
    [
      "extra selection field",
      { ...SERIES_COMMAND, selection: { ...SERIES_COMMAND.selection, label: "fake" } },
    ],
  ])("rejects invalid runtime input: %s", async (_label, command) => {
    const { classification } = await harness();
    await expect(classification.classifyKnownPrinter(command)).rejects.toBeInstanceOf(
      InvalidPrinterKnowledgeClassificationCommandError
    );
  });

  it("rejects unavailable exact versions without fallback", async () => {
    const { classification, installed, store } = await harness();
    await installed.accept(installedRecord(packageText({ packageVersion: "opaque-2" })));
    await expect(classification.classifyKnownPrinter(SERIES_COMMAND)).rejects.toBeInstanceOf(
      PrinterKnowledgePackageUnavailableError
    );
    await expect(store.listByPrinterId("printer-a")).resolves.toEqual([]);
  });

  it("rejects wrong series and missing exact model", async () => {
    const { classification, installed } = await harness();
    await installed.accept(installedRecord(packageText()));
    await expect(
      classification.classifyKnownPrinter({
        ...SERIES_COMMAND,
        selection: { ...SERIES_COMMAND.selection, seriesDefinitionId: "other" },
      })
    ).rejects.toBeInstanceOf(InvalidPrinterKnowledgeSeriesSelectionError);
    await expect(
      classification.classifyKnownPrinter({
        ...SERIES_COMMAND,
        selection: { ...SERIES_COMMAND.selection, modelDefinitionId: "missing" },
      })
    ).rejects.toBeInstanceOf(InvalidPrinterKnowledgeModelSelectionError);
  });

  it("projects incompatible and digest-corrupt packages as safe application errors", async () => {
    const incompatible = await harness();
    await incompatible.installed.accept(
      installedRecord(packageText({ minimumCoreVersion: "999.0.0" }))
    );
    await expect(
      incompatible.classification.classifyKnownPrinter(SERIES_COMMAND)
    ).rejects.toBeInstanceOf(PrinterKnowledgePackageIncompatibleError);

    const corrupt = await harness();
    await corrupt.installed.accept(
      installedRecord(packageText(), { contentSha256: "0".repeat(64) })
    );
    await expect(
      corrupt.classification.classifyKnownPrinter(SERIES_COMMAND)
    ).rejects.toBeInstanceOf(PrinterKnowledgePackageUnusableError);

    const malformed = await harness();
    await malformed.installed.accept(
      installedRecord(packageText(), {
        rawText: "{",
        contentSha256: computeKnowledgePackageSha256("{"),
      })
    );
    await expect(
      malformed.classification.classifyKnownPrinter(SERIES_COMMAND)
    ).rejects.toBeInstanceOf(PrinterKnowledgePackageUnusableError);
  });

  it("reauthorizes before package lookup", async () => {
    const noActive = await harness({ active: false });
    await expect(
      noActive.classification.classifyKnownPrinter(SERIES_COMMAND)
    ).rejects.toBeInstanceOf(NoActiveWorkspaceError);
    expect(noActive.getExactPackage).not.toHaveBeenCalled();
    const crossWorkspace = await harness();
    await expect(
      crossWorkspace.classification.classifyKnownPrinter({
        ...SERIES_COMMAND,
        printerId: "printer-b",
      })
    ).rejects.toBeInstanceOf(PrinterNotFoundError);
    expect(crossWorkspace.getExactPackage).not.toHaveBeenCalled();
  });

  it("revalidates before returning already_selected and avoids duplicate writes", async () => {
    const { classification, installed, store, getExactPackage } = await harness();
    await installed.accept(installedRecord(packageText()));
    await classification.classifyKnownPrinter(SERIES_COMMAND);
    await expect(classification.classifyKnownPrinter(SERIES_COMMAND)).resolves.toMatchObject({
      status: "already_selected",
    });
    await expect(store.listByPrinterId("printer-a")).resolves.toHaveLength(1);
    getExactPackage.mockResolvedValueOnce(undefined);
    await expect(classification.classifyKnownPrinter(SERIES_COMMAND)).rejects.toBeInstanceOf(
      PrinterKnowledgePackageUnavailableError
    );
  });

  it("changes known to unclassified, preserves history, and avoids package lookup", async () => {
    const { classification, installed, store, getExactPackage } = await harness();
    await installed.accept(installedRecord(packageText()));
    await classification.classifyKnownPrinter(SERIES_COMMAND);
    getExactPackage.mockClear();
    await expect(
      classification.classifyUnclassifiedPrinter({ printerId: "printer-a" })
    ).resolves.toMatchObject({ status: "selected", classification: { kind: "unclassified" } });
    await expect(
      classification.classifyUnclassifiedPrinter({ printerId: "printer-a" })
    ).resolves.toMatchObject({ status: "already_selected" });
    expect(getExactPackage).not.toHaveBeenCalled();
    await expect(store.listByPrinterId("printer-a")).resolves.toHaveLength(2);
  });

  it("preserves correction history for A to B to A", async () => {
    const { classification, installed, store } = await harness();
    await installed.accept(
      installedRecord(
        packageText({
          models: [
            { modelDefinitionId: "a", modelDisplayName: "A" },
            { modelDefinitionId: "b", modelDisplayName: "B" },
          ],
        })
      )
    );
    for (const modelDefinitionId of ["a", "b", "a"]) {
      await classification.classifyKnownPrinter({
        ...SERIES_COMMAND,
        selection: { ...SERIES_COMMAND.selection, modelDefinitionId },
      });
    }
    const history = await store.listByPrinterId("printer-a");
    expect(
      history.map(
        (identity) => identity.kind === "known" && identity.definitionRef.modelDefinitionId
      )
    ).toEqual(["a", "b", "a"]);
    await expect(store.getSelectedIdentityId("printer-a")).resolves.toBe(history[2]?.id);
  });

  it("keeps lifecycle failure atomic", async () => {
    const { classification, installed, store } = await harness({ failWrite: true });
    await installed.accept(installedRecord(packageText()));
    const previous = createPrinterKnowledgeIdentity({
      id: "previous",
      printerId: "printer-a",
      kind: "unclassified",
      selectedAt: "2026-08-09T10:00:00.000Z",
    });
    await store.create(previous);
    await store.setSelectedIdentity("printer-a", previous.id);
    await expect(classification.classifyKnownPrinter(SERIES_COMMAND)).rejects.toThrow(
      "write failed"
    );
    await expect(store.listByPrinterId("printer-a")).resolves.toEqual([previous]);
    await expect(store.getSelectedIdentityId("printer-a")).resolves.toBe(previous.id);
  });

  it("agrees with the existing read service after known and unclassified writes", async () => {
    const { classification, installed, ui } = await harness();
    await installed.accept(installedRecord(packageText()));
    await classification.classifyKnownPrinter(SERIES_COMMAND);
    await expect(ui.getPrinterKnowledgeStatus("printer-a")).resolves.toMatchObject({
      kind: "known",
      manufacturerDisplayName: "Trusted Manufacturer",
      packageAvailability: "available",
    });
    await classification.classifyUnclassifiedPrinter({ printerId: "printer-a" });
    await expect(ui.getPrinterKnowledgeStatus("printer-a")).resolves.toMatchObject({
      kind: "unclassified",
    });
  });
});
