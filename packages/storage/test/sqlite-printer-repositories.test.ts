import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createPrinter, createPrinterState, createWorkspace } from "@printtune/core";
import { describe, expect, it } from "vitest";

import {
  PrinterDataIntegrityError,
  PrinterStateDataIntegrityError,
  openPrintTuneDatabase,
} from "../src/index";
import { parsePrinterRow } from "../src/sqlite-printer-repository";
import { parsePrinterStateRow } from "../src/sqlite-printer-state-repository";
import { describePrinterRepository } from "./printer-repository-contract";
import { describePrinterStateRepository } from "./printer-state-repository-contract";

const TIMESTAMP = "2026-08-08T10:00:00.000Z";

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "printtune-printer-repositories-"));
  return { directory, path: join(directory, "printtune.sqlite") };
}

async function seedWorkspaces(database: ReturnType<typeof openPrintTuneDatabase>): Promise<void> {
  const repository = database.createWorkspaceRepository();
  await repository.save(createWorkspace({ id: "workspace-a", name: "A", timestamp: TIMESTAMP }));
  await repository.save(createWorkspace({ id: "workspace-b", name: "B", timestamp: TIMESTAMP }));
}

async function seedPrinters(database: ReturnType<typeof openPrintTuneDatabase>): Promise<void> {
  await seedWorkspaces(database);
  const repository = database.createPrinterRepository();
  await repository.save(
    createPrinter({
      id: "printer-a",
      workspaceId: "workspace-a",
      name: "A",
      timestamp: TIMESTAMP,
    })
  );
  await repository.save(
    createPrinter({
      id: "printer-b",
      workspaceId: "workspace-b",
      name: "B",
      timestamp: TIMESTAMP,
    })
  );
}

describePrinterRepository("SqlitePrinterRepository", async () => {
  const { directory, path } = temporaryDatabase();
  const database = openPrintTuneDatabase(path);
  database.migrate();
  await seedWorkspaces(database);
  return {
    repository: database.createPrinterRepository(),
    close() {
      database.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
});

describePrinterStateRepository("SqlitePrinterStateRepository", async () => {
  const { directory, path } = temporaryDatabase();
  const database = openPrintTuneDatabase(path);
  database.migrate();
  await seedPrinters(database);
  return {
    repository: database.createPrinterStateRepository(),
    close() {
      database.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
});

describe("SQLite Printer repository persistence and integrity", () => {
  it("reconstructs a leap-day timestamp accepted by Core", () => {
    const printer = createPrinter({
      id: "printer-leap-day",
      workspaceId: "workspace-a",
      name: "Leap day",
      timestamp: "2024-02-29T10:00:00.12Z",
    });

    expect(
      parsePrinterRow({
        id: printer.id,
        workspace_id: printer.workspaceId,
        name: printer.name,
        created_at: printer.createdAt,
        updated_at: printer.updatedAt,
      })
    ).toEqual(printer);
  });

  it("persists Printer and PrinterState records across close and reopen", async () => {
    const { directory, path } = temporaryDatabase();
    const printer = createPrinter({
      id: "printer-persisted",
      workspaceId: "workspace-a",
      name: "Dauerhaft",
      timestamp: TIMESTAMP,
    });
    const state = createPrinterState({
      id: "state-persisted",
      printerId: printer.id,
      timestamp: TIMESTAMP,
    });

    try {
      const first = openPrintTuneDatabase(path);
      first.migrate();
      await seedWorkspaces(first);
      await first.createPrinterRepository().save(printer);
      await first.createPrinterStateRepository().create(state);
      first.close();

      const second = openPrintTuneDatabase(path);
      second.migrate();
      try {
        await expect(second.createPrinterRepository().findById(printer.id)).resolves.toEqual(
          printer
        );
        await expect(second.createPrinterStateRepository().findById(state.id)).resolves.toEqual(
          state
        );
      } finally {
        second.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rejects malformed persisted rows through explicit parsers", () => {
    expect(() =>
      parsePrinterRow({
        id: 42,
        workspace_id: "workspace-a",
        name: "A",
        created_at: TIMESTAMP,
        updated_at: TIMESTAMP,
      })
    ).toThrow(PrinterDataIntegrityError);
    expect(() =>
      parsePrinterStateRow({ id: "state-a", printer_id: " ", created_at: TIMESTAMP })
    ).toThrow(PrinterStateDataIntegrityError);
  });

  it("detects malformed values read from SQLite", async () => {
    const { directory, path } = temporaryDatabase();
    try {
      const setup = openPrintTuneDatabase(path);
      setup.migrate();
      await seedPrinters(setup);
      setup.close();

      const corruption = new DatabaseSync(path);
      corruption
        .prepare(
          "INSERT INTO printers (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        )
        .run("printer-corrupt", "workspace-a", "   ", TIMESTAMP, TIMESTAMP);
      corruption
        .prepare("INSERT INTO printer_states (id, printer_id, created_at) VALUES (?, ?, ?)")
        .run("state-corrupt", "printer-a", "invalid");
      corruption.close();

      const database = openPrintTuneDatabase(path);
      database.migrate();
      try {
        await expect(
          database.createPrinterRepository().findById("printer-corrupt")
        ).rejects.toBeInstanceOf(PrinterDataIntegrityError);
        await expect(
          database.createPrinterStateRepository().findById("state-corrupt")
        ).rejects.toBeInstanceOf(PrinterStateDataIntegrityError);
      } finally {
        database.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("enforces parent relationships and both cascade paths", async () => {
    const { directory, path } = temporaryDatabase();
    try {
      const database = openPrintTuneDatabase(path);
      database.migrate();
      await seedPrinters(database);
      const printers = database.createPrinterRepository();
      const states = database.createPrinterStateRepository();

      await expect(
        printers.save(
          createPrinter({
            id: "orphan",
            workspaceId: "missing",
            name: "Orphan",
            timestamp: TIMESTAMP,
          })
        )
      ).rejects.toThrow();
      await expect(
        states.create(
          createPrinterState({ id: "orphan-state", printerId: "missing", timestamp: TIMESTAMP })
        )
      ).rejects.toThrow();

      await states.create(
        createPrinterState({ id: "state-a", printerId: "printer-a", timestamp: TIMESTAMP })
      );
      await printers.delete("printer-a");
      await expect(states.findById("state-a")).resolves.toBeUndefined();

      await states.create(
        createPrinterState({ id: "state-b", printerId: "printer-b", timestamp: TIMESTAMP })
      );
      await database.createWorkspaceRepository().delete("workspace-b");
      await expect(printers.findById("printer-b")).resolves.toBeUndefined();
      await expect(states.findById("state-b")).resolves.toBeUndefined();
      database.close();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
