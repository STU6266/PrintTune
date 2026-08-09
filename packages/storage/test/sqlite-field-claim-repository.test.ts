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
  FieldClaimDataIntegrityError,
  openPrintTuneDatabase,
  type PrintTuneDatabase,
} from "../src/index";
import { parseFieldClaimRow } from "../src/sqlite-field-claim-repository";
import { claim, describeFieldClaimRepository } from "./field-claim-repository-contract";

const TIMESTAMP = "2026-08-08T10:00:00.000Z";

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "printtune-field-claim-repository-"));
  return { directory, path: join(directory, "printtune.sqlite") };
}

async function seedHierarchy(database: PrintTuneDatabase): Promise<void> {
  await database
    .createWorkspaceRepository()
    .save(createWorkspace({ id: "workspace-a", name: "A", timestamp: TIMESTAMP }));
  await database.createPrinterRepository().save(
    createPrinter({
      id: "printer-a",
      workspaceId: "workspace-a",
      name: "A",
      timestamp: TIMESTAMP,
    })
  );
  await database
    .createPrinterStateRepository()
    .create(createPrinterState({ id: "state-a", printerId: "printer-a", timestamp: TIMESTAMP }));
  await database.createComponentInstallationRepository().create(
    createComponentInstallation({
      id: "installation-a",
      printerStateId: "state-a",
      componentInstanceId: "instance-a",
      role: "toolhead.hotend",
      kind: "hotend",
      displayName: "Hotend",
    })
  );
}

describeFieldClaimRepository("SqliteFieldClaimRepository", async () => {
  const { directory, path } = temporaryDatabase();
  const database = openPrintTuneDatabase(path);
  database.migrate();
  await seedHierarchy(database);
  return {
    repository: database.createFieldClaimRepository(),
    close() {
      database.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
});

describe("SqliteFieldClaimRepository integration", () => {
  it("rejects missing PrinterState and ComponentInstallation targets", async () => {
    const database = openPrintTuneDatabase(":memory:");
    database.migrate();
    try {
      const repository = database.createFieldClaimRepository();
      await expect(
        repository.create(
          claim("missing-state", {
            target: { type: "printer_state", printerStateId: "missing" },
          })
        )
      ).rejects.toThrow();
      await expect(
        repository.create(
          claim("missing-installation", {
            target: { type: "component_installation", componentInstallationId: "missing" },
          })
        )
      ).rejects.toThrow();
    } finally {
      database.close();
    }
  });

  it("persists special strings safely across close and reopen", async () => {
    const { directory, path } = temporaryDatabase();
    const expected = claim("persistent", {
      value: { type: "string", value: `Größe O'Reilly; DROP TABLE workspaces; -- 日本語` },
      unit: undefined,
      fieldPath: "firmware.type",
    });
    try {
      const first = openPrintTuneDatabase(path);
      first.migrate();
      await seedHierarchy(first);
      await first.createFieldClaimRepository().create(expected);
      first.close();

      const second = openPrintTuneDatabase(path);
      second.migrate();
      try {
        await expect(second.createFieldClaimRepository().findById(expected.id)).resolves.toEqual(
          expected
        );
        await expect(
          second.createWorkspaceRepository().findById("workspace-a")
        ).resolves.toBeDefined();
      } finally {
        second.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("preserves direct and installation target cascades while retaining unrelated claims", async () => {
    const database = openPrintTuneDatabase(":memory:");
    database.migrate();
    try {
      await seedHierarchy(database);
      await database
        .createWorkspaceRepository()
        .save(createWorkspace({ id: "workspace-b", name: "B", timestamp: TIMESTAMP }));
      await database.createPrinterRepository().save(
        createPrinter({
          id: "printer-b",
          workspaceId: "workspace-b",
          name: "B",
          timestamp: TIMESTAMP,
        })
      );
      await database
        .createPrinterStateRepository()
        .create(
          createPrinterState({ id: "state-b", printerId: "printer-b", timestamp: TIMESTAMP })
        );
      const claims = database.createFieldClaimRepository();
      await claims.create(claim("direct"));
      await claims.create(
        claim("installation", {
          target: { type: "component_installation", componentInstallationId: "installation-a" },
        })
      );
      await claims.create(
        claim("unrelated", { target: { type: "printer_state", printerStateId: "state-b" } })
      );

      await database.createWorkspaceRepository().delete("workspace-a");
      await expect(claims.findById("direct")).resolves.toBeUndefined();
      await expect(claims.findById("installation")).resolves.toBeUndefined();
      await expect(claims.findById("unrelated")).resolves.toBeDefined();
    } finally {
      database.close();
    }
  });

  const validRow = {
    id: "claim-a",
    printer_state_id: "state-a",
    component_installation_id: null,
    field_path: "printer.nozzle.diameter",
    value_type: "number",
    string_value: null,
    number_value: 0.4,
    boolean_value: null,
    unit: "mm",
    source_type: "user_confirmed",
    source_reference_id: null,
    source_package_id: null,
    source_package_version: null,
    source_definition_id: null,
    trust: "user_confirmed",
    confidence: null,
    created_at: TIMESTAMP,
  };

  it.each([
    ["id", { id: "" }],
    ["target", { printer_state_id: null }],
    ["field path", { field_path: "Invalid Path" }],
    ["value type", { value_type: "json" }],
    ["boolean", { value_type: "boolean", number_value: null, boolean_value: 2 }],
    ["unit", { unit: "cm" }],
    ["provenance", { source_type: "knowledge_package" }],
    ["trust", { trust: "trusted" }],
    ["confidence", { confidence: 2 }],
    ["timestamp", { created_at: "invalid" }],
    ["SQLite type", { id: 42 }],
  ])("detects corrupt %s data", (_name, corrupt) => {
    expect(() => parseFieldClaimRow({ ...validRow, ...corrupt })).toThrow(
      FieldClaimDataIntegrityError
    );
  });
});
