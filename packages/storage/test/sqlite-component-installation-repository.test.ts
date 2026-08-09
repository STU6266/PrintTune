import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createComponentInstallation,
  createPrinter,
  createPrinterState,
  createWorkspace,
} from "@printtune/core";
import { describe, expect, it } from "vitest";

import {
  ComponentInstallationDataIntegrityError,
  openPrintTuneDatabase,
  type PrintTuneDatabase,
} from "../src/index";
import { parseComponentInstallationRow } from "../src/sqlite-component-installation-repository";
import { describeComponentInstallationRepository } from "./component-installation-repository-contract";

const EARLY = "2026-08-08T10:00:00.000Z";
const LATE = "2026-08-09T10:00:00.000Z";

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "printtune-component-repository-"));
  return { directory, path: join(directory, "printtune.sqlite") };
}

async function seedHierarchy(database: PrintTuneDatabase): Promise<void> {
  const workspaces = database.createWorkspaceRepository();
  const printers = database.createPrinterRepository();
  const states = database.createPrinterStateRepository();
  await workspaces.save(createWorkspace({ id: "workspace-a", name: "A", timestamp: EARLY }));
  await printers.save(
    createPrinter({
      id: "printer-a",
      workspaceId: "workspace-a",
      name: "A",
      timestamp: EARLY,
    })
  );
  await states.create(
    createPrinterState({ id: "state-early", printerId: "printer-a", timestamp: EARLY })
  );
  await states.create(
    createPrinterState({ id: "state-tie-a", printerId: "printer-a", timestamp: LATE })
  );
  await states.create(
    createPrinterState({ id: "state-tie-b", printerId: "printer-a", timestamp: LATE })
  );
  await states.create(
    createPrinterState({ id: "state-other", printerId: "printer-a", timestamp: LATE })
  );
}

describeComponentInstallationRepository("SqliteComponentInstallationRepository", async () => {
  const { directory, path } = temporaryDatabase();
  const database = openPrintTuneDatabase(path);
  database.migrate();
  await seedHierarchy(database);
  return {
    repository: database.createComponentInstallationRepository(),
    close() {
      database.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
});

describe("SQLite ComponentInstallation repository integration", () => {
  it("rejects an unknown PrinterState", async () => {
    const database = openPrintTuneDatabase(":memory:");
    database.migrate();
    try {
      await expect(
        database.createComponentInstallationRepository().create(
          createComponentInstallation({
            id: "installation-orphan",
            printerStateId: "missing",
            componentInstanceId: "instance-a",
            role: "toolhead.hotend",
            kind: "hotend",
            displayName: "Hotend",
          })
        )
      ).rejects.toThrow();
    } finally {
      database.close();
    }
  });

  it("persists known and unknown installations safely across close and reopen", async () => {
    const { directory, path } = temporaryDatabase();
    const unknown = createComponentInstallation({
      id: "installation-unknown",
      printerStateId: "state-early",
      componentInstanceId: "instance-unknown",
      role: "cooling.part.1",
      kind: "cooling-fan",
      displayName: `O'Reillys 日本語 "Fan"; DROP TABLE component_installations; --`,
    });
    const known = createComponentInstallation({
      id: "installation-known",
      printerStateId: "state-early",
      componentInstanceId: "instance-known",
      role: "toolhead.hotend",
      kind: "hotend",
      displayName: "Known hotend",
      definitionRef: {
        packageId: "components.base",
        packageVersion: "1.0.0",
        definitionId: "hotend.known",
      },
    });
    try {
      const first = openPrintTuneDatabase(path);
      first.migrate();
      await seedHierarchy(first);
      await first.createComponentInstallationRepository().create(unknown);
      await first.createComponentInstallationRepository().create(known);
      first.close();

      const second = openPrintTuneDatabase(path);
      second.migrate();
      try {
        await expect(
          second.createComponentInstallationRepository().listByPrinterStateId("state-early")
        ).resolves.toEqual([unknown, known]);
      } finally {
        second.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("preserves state, Printer, and Workspace cascade behavior", async () => {
    const database = openPrintTuneDatabase(":memory:");
    database.migrate();
    try {
      await seedHierarchy(database);
      const installations = database.createComponentInstallationRepository();
      const value = (id: string, stateId: string, role: string) =>
        createComponentInstallation({
          id,
          printerStateId: stateId,
          componentInstanceId: `instance-${id}`,
          role,
          kind: "hotend",
          displayName: id,
        });
      await installations.create(value("state-cascade", "state-early", "toolhead.hotend"));
      await database
        .createPrinterStateRepository()
        .create(
          createPrinterState({ id: "state-printer", printerId: "printer-a", timestamp: LATE })
        );
      await installations.create(value("printer-cascade", "state-printer", "toolhead.hotend"));

      await database.createPrinterRepository().delete("printer-a");
      await expect(installations.findById("state-cascade")).resolves.toBeUndefined();
      await expect(installations.findById("printer-cascade")).resolves.toBeUndefined();

      await database.createPrinterRepository().save(
        createPrinter({
          id: "printer-b",
          workspaceId: "workspace-a",
          name: "B",
          timestamp: EARLY,
        })
      );
      await database
        .createPrinterStateRepository()
        .create(
          createPrinterState({ id: "state-workspace", printerId: "printer-b", timestamp: EARLY })
        );
      await installations.create(value("workspace-cascade", "state-workspace", "toolhead.hotend"));
      await database.createWorkspaceRepository().delete("workspace-a");
      await expect(installations.findById("workspace-cascade")).resolves.toBeUndefined();
    } finally {
      database.close();
    }
  });

  it.each([
    ["id", { id: "", role: "toolhead.hotend", kind: "hotend", display_name: "Hotend" }],
    ["role", { id: "installation-a", role: "Toolhead", kind: "hotend", display_name: "Hotend" }],
    [
      "kind",
      { id: "installation-a", role: "toolhead.hotend", kind: "Hotend", display_name: "Hotend" },
    ],
    [
      "display_name",
      { id: "installation-a", role: "toolhead.hotend", kind: "hotend", display_name: " Hotend" },
    ],
    [
      "definition_ref",
      {
        id: "installation-a",
        role: "toolhead.hotend",
        kind: "hotend",
        display_name: "Hotend",
        definition_package_id: "package",
      },
    ],
  ])("detects a corrupt %s field", (field, values) => {
    expect(() =>
      parseComponentInstallationRow({
        printer_state_id: "state-early",
        component_instance_id: "instance-a",
        definition_package_id: null,
        definition_package_version: null,
        definition_id: null,
        ...values,
      })
    ).toThrow(ComponentInstallationDataIntegrityError);
  });

  it("rejects unexpected SQLite value types", () => {
    expect(() =>
      parseComponentInstallationRow({
        id: 42,
        printer_state_id: "state-early",
        component_instance_id: "instance-a",
        role: "toolhead.hotend",
        kind: "hotend",
        display_name: "Hotend",
        definition_package_id: null,
        definition_package_version: null,
        definition_id: null,
      })
    ).toThrow(ComponentInstallationDataIntegrityError);
  });
});
