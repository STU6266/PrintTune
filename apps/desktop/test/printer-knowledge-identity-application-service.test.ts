import {
  createPrinterKnowledgeIdentity,
  createPrinter,
  createWorkspace,
  InvalidPrinterKnowledgeDisplaySnapshotError,
} from "@printtune/core";
import {
  InMemoryPrinterKnowledgeIdentityLifecyclePersistence,
  InMemoryPrinterRepository,
  InMemoryWorkspaceRepository,
  type PrinterKnowledgeIdentityLifecyclePersistence,
} from "@printtune/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActiveWorkspaceSession } from "../src/main/active-workspace-session";
import {
  NoActiveWorkspaceError,
  PrinterNotFoundError,
} from "../src/main/printer-flow-application-service";
import { PrinterKnowledgeIdentityApplicationService } from "../src/main/printer-knowledge-identity-application-service";

const FIRST_ID = "00000000-0000-4000-8000-000000000401";
const SECOND_ID = "00000000-0000-4000-8000-000000000402";
const TIMESTAMP = "2026-08-09T10:00:00.000Z";
const KNOWN_INPUT = {
  kind: "known" as const,
  packageId: "org.printtune.printers",
  packageVersion: "opaque-v1",
  seriesDefinitionId: "series-a",
  manufacturerDisplayName: "Hersteller",
  seriesDisplayName: "Serie",
};

describe("PrinterKnowledgeIdentityApplicationService", () => {
  const workspaces = new InMemoryWorkspaceRepository();
  const printers = new InMemoryPrinterRepository();
  const activeWorkspace = new ActiveWorkspaceSession(workspaces);
  let store: InMemoryPrinterKnowledgeIdentityLifecyclePersistence;
  let generatedIds: string[];
  let service: PrinterKnowledgeIdentityApplicationService;

  beforeEach(async () => {
    for (const workspace of await workspaces.list()) await workspaces.delete(workspace.id);
    for (const id of ["printer-a", "printer-b"]) await printers.delete(id);
    activeWorkspace.clearIfActive("workspace-a");
    activeWorkspace.clearIfActive("workspace-b");
    await workspaces.save(createWorkspace({ id: "workspace-a", name: "A", timestamp: TIMESTAMP }));
    await workspaces.save(createWorkspace({ id: "workspace-b", name: "B", timestamp: TIMESTAMP }));
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
    store = new InMemoryPrinterKnowledgeIdentityLifecyclePersistence();
    generatedIds = [FIRST_ID, SECOND_ID];
    service = new PrinterKnowledgeIdentityApplicationService(
      store,
      store,
      store,
      printers,
      activeWorkspace,
      { createIdentityId: () => generatedIds.shift() ?? "unexpected-id", now: () => TIMESTAMP }
    );
  });

  it("generates authoritative identity metadata and selects a known series", async () => {
    await activeWorkspace.setActiveWorkspace("workspace-a");
    await expect(service.createAndSelect("printer-a", KNOWN_INPUT)).resolves.toEqual({
      id: FIRST_ID,
      printerId: "printer-a",
      kind: "known",
      definitionRef: {
        packageId: "org.printtune.printers",
        packageVersion: "opaque-v1",
        seriesDefinitionId: "series-a",
      },
      manufacturerDisplayName: "Hersteller",
      seriesDisplayName: "Serie",
      selectedAt: TIMESTAMP,
    });
    await expect(service.getCurrentIdentity("printer-a")).resolves.toMatchObject({ id: FIRST_ID });
  });

  it("supports exact-model and unclassified correction while preserving history", async () => {
    await activeWorkspace.setActiveWorkspace("workspace-a");
    const exactModel = await service.createAndSelect("printer-a", {
      ...KNOWN_INPUT,
      modelDefinitionId: "model-a",
      modelDisplayName: "Modell A",
    });
    const unclassified = await service.createAndSelect("printer-a", { kind: "unclassified" });

    await expect(service.listHistory("printer-a")).resolves.toEqual([exactModel, unclassified]);
    await expect(service.getCurrentIdentity("printer-a")).resolves.toEqual(unclassified);
    await expect(store.findById(exactModel.id)).resolves.toEqual(exactModel);
  });

  it("returns undefined when an authorized Printer has no current identity", async () => {
    await activeWorkspace.setActiveWorkspace("workspace-a");
    await expect(service.getCurrentIdentity("printer-a")).resolves.toBeUndefined();
  });

  it("reads current identity from the explicit selection instead of the newest history row", async () => {
    await activeWorkspace.setActiveWorkspace("workspace-a");
    const newer = createPrinterKnowledgeIdentity({
      id: "identity-newer",
      printerId: "printer-a",
      kind: "unclassified",
      selectedAt: "2026-08-10T10:00:00.000Z",
    });
    const selectedOlder = createPrinterKnowledgeIdentity({
      id: "identity-older",
      printerId: "printer-a",
      kind: "unclassified",
      selectedAt: "2026-08-08T10:00:00.000Z",
    });
    await store.create(newer);
    await store.create(selectedOlder);
    await store.setSelectedIdentity("printer-a", selectedOlder.id);

    await expect(service.getCurrentIdentity("printer-a")).resolves.toEqual(selectedOlder);
    await expect(service.listHistory("printer-a")).resolves.toEqual([selectedOlder, newer]);
  });

  it("authorizes identity changes and reads against the active Workspace", async () => {
    await expect(service.createAndSelect("printer-a", KNOWN_INPUT)).rejects.toBeInstanceOf(
      NoActiveWorkspaceError
    );
    await activeWorkspace.setActiveWorkspace("workspace-a");
    await expect(service.createAndSelect("printer-b", KNOWN_INPUT)).rejects.toBeInstanceOf(
      PrinterNotFoundError
    );
    await expect(service.getCurrentIdentity("printer-b")).rejects.toBeInstanceOf(
      PrinterNotFoundError
    );
    await expect(store.listByPrinterId("printer-a")).resolves.toEqual([]);
    await expect(store.listByPrinterId("printer-b")).resolves.toEqual([]);
  });

  it("does not call persistence when Core validation rejects input", async () => {
    await activeWorkspace.setActiveWorkspace("workspace-a");
    const lifecycle: PrinterKnowledgeIdentityLifecyclePersistence = { createAndSelect: vi.fn() };
    const invalidService = new PrinterKnowledgeIdentityApplicationService(
      lifecycle,
      store,
      store,
      printers,
      activeWorkspace,
      { createIdentityId: () => FIRST_ID, now: () => TIMESTAMP }
    );

    await expect(
      invalidService.createAndSelect("printer-a", {
        ...KNOWN_INPUT,
        manufacturerDisplayName: "   ",
      })
    ).rejects.toBeInstanceOf(InvalidPrinterKnowledgeDisplaySnapshotError);
    expect(lifecycle.createAndSelect).not.toHaveBeenCalled();
  });
});
