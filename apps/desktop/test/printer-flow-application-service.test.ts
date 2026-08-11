import type { Printer, PrinterState } from "@printtune/contracts";
import {
  InMemoryPrinterCreationPersistence,
  InMemoryPrinterRepository,
  InMemoryPrinterStateRepository,
  InMemoryPrinterStateSelectionPersistence,
  InMemoryWorkspaceRepository,
  openPrintTuneDatabase,
} from "@printtune/storage";
import { beforeEach, describe, expect, it } from "vitest";

import { ActiveWorkspaceSession } from "../src/main/active-workspace-session";
import { PrinterApplicationService } from "../src/main/printer-application-service";
import {
  NoActiveWorkspaceError,
  PrinterFlowApplicationService,
  PrinterNotFoundError,
} from "../src/main/printer-flow-application-service";

const TIMESTAMP = "2026-08-09T10:00:00.000Z";

describe("PrinterFlowApplicationService", () => {
  const workspaces = new InMemoryWorkspaceRepository();
  const printers = new InMemoryPrinterRepository();
  const states = new InMemoryPrinterStateRepository();
  const stateSelection = new InMemoryPrinterStateSelectionPersistence(states);
  const session = new ActiveWorkspaceSession(workspaces);
  const creation = new PrinterApplicationService(
    new InMemoryPrinterCreationPersistence(printers, states, stateSelection),
    {
      createPrinterId: () => "printer-new",
      createPrinterStateId: () => "state-new",
      now: () => TIMESTAMP,
    }
  );
  const service = new PrinterFlowApplicationService(
    creation,
    printers,
    states,
    stateSelection,
    session
  );

  beforeEach(async () => {
    for (const workspace of await workspaces.list()) await workspaces.delete(workspace.id);
    for (const id of ["printer-a", "printer-b", "printer-new"]) await printers.delete(id);
    await workspaces.save({
      id: "workspace-a",
      name: "A",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    await workspaces.save({
      id: "workspace-b",
      name: "B",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    session.clearIfActive("workspace-a");
    session.clearIfActive("workspace-b");
  });

  it("returns no Printers and does not leak another Workspace without an active Workspace", async () => {
    await printers.save(printer("printer-b", "workspace-b"));
    await expect(service.listPrinters()).resolves.toEqual({
      activeWorkspace: undefined,
      printers: [],
    });
  });

  it("lists only Printers from the active Workspace", async () => {
    await printers.save(printer("printer-a", "workspace-a"));
    await printers.save(printer("printer-b", "workspace-b"));
    await session.setActiveWorkspace("workspace-a");

    const result = await service.listPrinters();
    expect(result.printers.map(({ id }) => id)).toEqual(["printer-a"]);
  });

  it("creates in the active Workspace with exactly one initial state", async () => {
    await session.setActiveWorkspace("workspace-b");
    const detail = await service.createPrinter("  Neuer Drucker  ");

    expect(detail.printer).toMatchObject({ workspaceId: "workspace-b", name: "Neuer Drucker" });
    await expect(states.listByPrinterId(detail.printer.id)).resolves.toEqual([detail.workingState]);
    await expect(stateSelection.getSelectedStateId(detail.printer.id)).resolves.toBe(
      detail.workingState.id
    );
  });

  it("rejects creation when no Workspace is active", async () => {
    await expect(service.createPrinter("Drucker")).rejects.toBeInstanceOf(NoActiveWorkspaceError);
  });

  it("returns the explicitly selected state even when it is older", async () => {
    await printers.save(printer("printer-a", "workspace-a"));
    await printers.save(printer("printer-b", "workspace-b"));
    await states.create(state("state-late", "printer-a", "2026-08-09T11:00:00.000Z"));
    await states.create(state("state-early", "printer-a", "2026-08-09T09:00:00.000Z"));
    await states.create(state("state-b", "printer-b", TIMESTAMP));
    await stateSelection.setSelectedState("printer-a", "state-early");
    await session.setActiveWorkspace("workspace-a");

    await expect(service.getPrinterDetail("printer-a")).resolves.toMatchObject({
      workingState: { id: "state-early" },
    });
    await expect(service.getPrinterDetail("printer-b")).rejects.toBeInstanceOf(
      PrinterNotFoundError
    );
    await expect(service.getPrinterDetail("missing")).rejects.toBeInstanceOf(PrinterNotFoundError);
  });
});

it("persists the Printer and initial state across a SQLite close and reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "printtune-printer-flow-"));
  const path = join(directory, "printtune.sqlite");
  try {
    const first = openPrintTuneDatabase(path);
    first.migrate();
    const workspaceRepository = first.createWorkspaceRepository();
    await workspaceRepository.save({
      id: "workspace-persisted",
      name: "Persistiert",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    const session = new ActiveWorkspaceSession(workspaceRepository);
    await session.setActiveWorkspace("workspace-persisted");
    const service = new PrinterFlowApplicationService(
      new PrinterApplicationService(first.createPrinterCreationPersistence(), {
        createPrinterId: () => "printer-persisted",
        createPrinterStateId: () => "state-persisted",
        now: () => TIMESTAMP,
      }),
      first.createPrinterRepository(),
      first.createPrinterStateRepository(),
      first.createPrinterStateSelectionPersistence(),
      session
    );
    await service.createPrinter("Persistierter Drucker");
    first.close();

    const second = openPrintTuneDatabase(path);
    second.migrate();
    try {
      await expect(
        second.createPrinterRepository().findById("printer-persisted")
      ).resolves.toMatchObject({
        name: "Persistierter Drucker",
      });
      await expect(
        second.createPrinterStateRepository().listByPrinterId("printer-persisted")
      ).resolves.toEqual([
        { id: "state-persisted", printerId: "printer-persisted", createdAt: TIMESTAMP },
      ]);
      await expect(
        second.createPrinterStateSelectionPersistence().getSelectedStateId("printer-persisted")
      ).resolves.toBe("state-persisted");
    } finally {
      second.close();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

function printer(id: string, workspaceId: string): Printer {
  return { id, workspaceId, name: id, createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
}

function state(id: string, printerId: string, createdAt: string): PrinterState {
  return { id, printerId, createdAt };
}
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
