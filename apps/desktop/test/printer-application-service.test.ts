import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InvalidPrinterNameError, InvalidPrinterWorkspaceIdError } from "@printtune/core";
import {
  DuplicatePrinterStateError,
  InMemoryPrinterCreationPersistence,
  InMemoryPrinterRepository,
  InMemoryPrinterStateRepository,
  openPrintTuneDatabase,
  type PrinterCreationPersistence,
} from "@printtune/storage";
import { describe, expect, it, vi } from "vitest";

import { PrinterApplicationService } from "../src/main/printer-application-service";

const PRINTER_ID = "00000000-0000-4000-8000-000000000101";
const STATE_ID = "00000000-0000-4000-8000-000000000102";
const TIMESTAMP = "2026-08-08T12:00:00.000Z";

function deterministicService(persistence: PrinterCreationPersistence) {
  return new PrinterApplicationService(persistence, {
    createPrinterId: () => PRINTER_ID,
    createPrinterStateId: () => STATE_ID,
    now: () => TIMESTAMP,
  });
}

describe("PrinterApplicationService", () => {
  it("creates a deterministic Printer with exactly one initial state in memory", async () => {
    const printers = new InMemoryPrinterRepository();
    const states = new InMemoryPrinterStateRepository();
    const service = deterministicService(new InMemoryPrinterCreationPersistence(printers, states));

    await expect(
      service.createPrinterWithInitialState({
        workspaceId: "workspace-a",
        printerName: "  Werkstattdrucker  ",
      })
    ).resolves.toEqual({
      printer: {
        id: PRINTER_ID,
        workspaceId: "workspace-a",
        name: "Werkstattdrucker",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
      initialState: {
        id: STATE_ID,
        printerId: PRINTER_ID,
        createdAt: TIMESTAMP,
      },
    });
    await expect(states.listByPrinterId(PRINTER_ID)).resolves.toHaveLength(1);
  });

  it.each([
    [{ workspaceId: "workspace-a", printerName: "   " }, InvalidPrinterNameError],
    [{ workspaceId: " workspace-a ", printerName: "Drucker" }, InvalidPrinterWorkspaceIdError],
  ] as const)("validates through Core before persistence", async (input, errorType) => {
    const persistence: PrinterCreationPersistence = {
      createPrinterWithInitialState: vi.fn(),
    };
    const service = deterministicService(persistence);

    await expect(service.createPrinterWithInitialState(input)).rejects.toBeInstanceOf(errorType);
    expect(persistence.createPrinterWithInitialState).not.toHaveBeenCalled();
  });

  it("removes an in-memory Printer when initial-state creation fails", async () => {
    const printers = new InMemoryPrinterRepository();
    const states = new InMemoryPrinterStateRepository();
    await states.create({ id: STATE_ID, printerId: "another-printer", createdAt: TIMESTAMP });
    const service = deterministicService(new InMemoryPrinterCreationPersistence(printers, states));

    await expect(
      service.createPrinterWithInitialState({ workspaceId: "workspace-a", printerName: "Drucker" })
    ).rejects.toBeInstanceOf(DuplicatePrinterStateError);
    await expect(printers.findById(PRINTER_ID)).resolves.toBeUndefined();
    await expect(states.findById(STATE_ID)).resolves.toMatchObject({
      printerId: "another-printer",
    });
  });

  it("commits both SQLite records and preserves them across reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "printtune-printer-creation-"));
    const path = join(directory, "printtune.sqlite");
    try {
      const first = openPrintTuneDatabase(path);
      first.migrate();
      await first.createWorkspaceRepository().save({
        id: "workspace-a",
        name: "A",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      });
      const created = await deterministicService(
        first.createPrinterCreationPersistence()
      ).createPrinterWithInitialState({ workspaceId: "workspace-a", printerName: "Drucker" });
      first.close();

      const second = openPrintTuneDatabase(path);
      second.migrate();
      try {
        await expect(second.createPrinterRepository().findById(PRINTER_ID)).resolves.toEqual(
          created.printer
        );
        await expect(
          second.createPrinterStateRepository().listByPrinterId(PRINTER_ID)
        ).resolves.toEqual([created.initialState]);
      } finally {
        second.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rolls back completely for an unknown SQLite Workspace", async () => {
    const database = openPrintTuneDatabase(":memory:");
    database.migrate();
    const service = deterministicService(database.createPrinterCreationPersistence());

    await expect(
      service.createPrinterWithInitialState({ workspaceId: "missing", printerName: "Drucker" })
    ).rejects.toThrow();
    await expect(database.createPrinterRepository().findById(PRINTER_ID)).resolves.toBeUndefined();
    await expect(
      database.createPrinterStateRepository().findById(STATE_ID)
    ).resolves.toBeUndefined();
    database.close();
  });

  it("rolls back the SQLite Printer when initial-state creation fails", async () => {
    const database = openPrintTuneDatabase(":memory:");
    database.migrate();
    await database.createWorkspaceRepository().save({
      id: "workspace-a",
      name: "A",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    await database.createPrinterRepository().save({
      id: "existing-printer",
      workspaceId: "workspace-a",
      name: "Bestehend",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    await database.createPrinterStateRepository().create({
      id: STATE_ID,
      printerId: "existing-printer",
      createdAt: TIMESTAMP,
    });

    await expect(
      deterministicService(
        database.createPrinterCreationPersistence()
      ).createPrinterWithInitialState({
        workspaceId: "workspace-a",
        printerName: "Neu",
      })
    ).rejects.toBeInstanceOf(DuplicatePrinterStateError);
    await expect(database.createPrinterRepository().findById(PRINTER_ID)).resolves.toBeUndefined();
    await expect(database.createPrinterStateRepository().findById(STATE_ID)).resolves.toMatchObject(
      {
        printerId: "existing-printer",
      }
    );
    database.close();
  });
});
