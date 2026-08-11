import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPrinter, createPrinterState, createWorkspace } from "@printtune/core";
import { expect, it } from "vitest";

import {
  InMemoryPrinterStateRepository,
  InMemoryPrinterStateSelectionPersistence,
  openPrintTuneDatabase,
} from "../src/index";
import { describePrinterStateSelectionPersistence } from "./printer-state-selection-contract";

const TIMESTAMP = "2026-08-09T10:00:00.000Z";

describePrinterStateSelectionPersistence("InMemoryPrinterStateSelectionPersistence", () => {
  const states = new InMemoryPrinterStateRepository();
  return {
    selection: new InMemoryPrinterStateSelectionPersistence(states),
    createState: (state) => states.create(state),
    close() {},
  };
});

describePrinterStateSelectionPersistence("SqlitePrinterStateSelectionPersistence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "printtune-state-selection-contract-"));
  const database = openPrintTuneDatabase(join(directory, "printtune.sqlite"));
  database.migrate();
  const workspaces = database.createWorkspaceRepository();
  const printers = database.createPrinterRepository();
  await workspaces.save(createWorkspace({ id: "workspace-a", name: "A", timestamp: TIMESTAMP }));
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
      workspaceId: "workspace-a",
      name: "B",
      timestamp: TIMESTAMP,
    })
  );
  const states = database.createPrinterStateRepository();
  return {
    selection: database.createPrinterStateSelectionPersistence(),
    createState: (state) => states.create(state),
    close() {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
});

it("persists the explicitly selected older State across close and reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "printtune-state-selection-restart-"));
  const path = join(directory, "printtune.sqlite");
  try {
    const first = openPrintTuneDatabase(path);
    first.migrate();
    await first
      .createWorkspaceRepository()
      .save(createWorkspace({ id: "workspace-a", name: "A", timestamp: TIMESTAMP }));
    await first.createPrinterRepository().save(
      createPrinter({
        id: "printer-a",
        workspaceId: "workspace-a",
        name: "A",
        timestamp: TIMESTAMP,
      })
    );
    const states = first.createPrinterStateRepository();
    await states.create(
      createPrinterState({ id: "state-a", printerId: "printer-a", timestamp: TIMESTAMP })
    );
    await states.create(
      createPrinterState({
        id: "state-b",
        printerId: "printer-a",
        parentPrinterStateId: "state-a",
        timestamp: "2026-08-10T11:00:00.000Z",
      })
    );
    await first.createPrinterStateSelectionPersistence().setSelectedState("printer-a", "state-a");
    first.close();

    const second = openPrintTuneDatabase(path);
    second.migrate();
    try {
      await expect(
        second.createPrinterStateSelectionPersistence().getSelectedStateId("printer-a")
      ).resolves.toBe("state-a");
    } finally {
      second.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
