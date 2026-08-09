import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPrinter, createWorkspace } from "@printtune/core";
import { describe, expect, it } from "vitest";

import {
  InMemoryPrinterKnowledgeIdentityRepository,
  InMemoryPrinterKnowledgeIdentitySelectionPersistence,
  PrinterKnowledgeIdentityDataIntegrityError,
  openPrintTuneDatabase,
  type PrintTuneDatabase,
} from "../src/index";
import { parsePrinterKnowledgeIdentityRow } from "../src/sqlite-printer-knowledge-identity-repository";
import {
  describePrinterKnowledgeIdentityRepository,
  knownIdentity,
  unclassifiedIdentity,
} from "./printer-knowledge-identity-repository-contract";
import { describePrinterKnowledgeIdentitySelection } from "./printer-knowledge-identity-selection-contract";

const TIMESTAMP = "2026-08-08T10:00:00.000Z";

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "printtune-printer-knowledge-"));
  return { directory, path: join(directory, "printtune.sqlite") };
}

async function seedPrinters(database: PrintTuneDatabase): Promise<void> {
  const workspaces = database.createWorkspaceRepository();
  const printers = database.createPrinterRepository();
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
}

describePrinterKnowledgeIdentityRepository("InMemoryPrinterKnowledgeIdentityRepository", () => ({
  repository: new InMemoryPrinterKnowledgeIdentityRepository(),
  close() {},
}));

describePrinterKnowledgeIdentityRepository("SqlitePrinterKnowledgeIdentityRepository", async () => {
  const { directory, path } = temporaryDatabase();
  const database = openPrintTuneDatabase(path);
  database.migrate();
  await seedPrinters(database);
  return {
    repository: database.createPrinterKnowledgeIdentityRepository(),
    close() {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
});

describePrinterKnowledgeIdentitySelection("InMemory selection persistence", () => {
  const repository = new InMemoryPrinterKnowledgeIdentityRepository();
  return {
    repository,
    selection: new InMemoryPrinterKnowledgeIdentitySelectionPersistence(repository),
    close() {},
  };
});

describePrinterKnowledgeIdentitySelection("SQLite selection persistence", async () => {
  const { directory, path } = temporaryDatabase();
  const database = openPrintTuneDatabase(path);
  database.migrate();
  await seedPrinters(database);
  return {
    repository: database.createPrinterKnowledgeIdentityRepository(),
    selection: database.createPrinterKnowledgeIdentitySelectionPersistence(),
    close() {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
});

describe("SQLite PrinterKnowledgeIdentity persistence and integrity", () => {
  it("rejects an identity whose Printer does not exist", async () => {
    const database = openPrintTuneDatabase(":memory:");
    database.migrate();
    try {
      await expect(
        database
          .createPrinterKnowledgeIdentityRepository()
          .create(knownIdentity("identity-orphan", "missing-printer"))
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      database.close();
    }
  });

  it.each([
    ["Unicode", "Prüfdrucker 日本語 🖨️", "Baureihe 東京", "Modell Ω"],
    ["quotes", `O'Reilly \"Factory\"`, "Maker's Series", `Model \"One\"`],
    ["SQL-like text", "'); DROP TABLE printers; --", "SELECT * FROM x", "-- model"],
  ])(
    "round-trips %s display snapshots as bound data",
    async (_label, manufacturer, series, model) => {
      const database = openPrintTuneDatabase(":memory:");
      database.migrate();
      await seedPrinters(database);
      const repository = database.createPrinterKnowledgeIdentityRepository();
      const identity = knownIdentity("identity-a", "printer-a", TIMESTAMP, true, {
        manufacturer,
        series,
        model,
      });
      try {
        await repository.create(identity);
        await expect(repository.findById(identity.id)).resolves.toEqual(identity);
      } finally {
        database.close();
      }
    }
  );

  it("persists history and current selection across close and reopen", async () => {
    const { directory, path } = temporaryDatabase();
    try {
      const first = openPrintTuneDatabase(path);
      first.migrate();
      await seedPrinters(first);
      await first.createPrinterKnowledgeIdentityRepository().create(knownIdentity("identity-a"));
      await first
        .createPrinterKnowledgeIdentitySelectionPersistence()
        .setSelectedIdentity("printer-a", "identity-a");
      first.close();

      const second = openPrintTuneDatabase(path);
      second.migrate();
      try {
        await expect(
          second.createPrinterKnowledgeIdentityRepository().findById("identity-a")
        ).resolves.toEqual(knownIdentity("identity-a"));
        await expect(
          second
            .createPrinterKnowledgeIdentitySelectionPersistence()
            .getSelectedIdentityId("printer-a")
        ).resolves.toBe("identity-a");
      } finally {
        second.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("cascades one Printer's history and selection without affecting another Printer", async () => {
    const database = openPrintTuneDatabase(":memory:");
    database.migrate();
    await seedPrinters(database);
    const repository = database.createPrinterKnowledgeIdentityRepository();
    const selection = database.createPrinterKnowledgeIdentitySelectionPersistence();
    await repository.create(knownIdentity("identity-a"));
    await repository.create(unclassifiedIdentity("identity-b", "printer-b"));
    await selection.setSelectedIdentity("printer-a", "identity-a");
    await selection.setSelectedIdentity("printer-b", "identity-b");

    await database.createPrinterRepository().delete("printer-a");

    await expect(repository.listByPrinterId("printer-a")).resolves.toEqual([]);
    await expect(selection.getSelectedIdentityId("printer-a")).resolves.toBeUndefined();
    await expect(repository.findById("identity-b")).resolves.toBeDefined();
    await expect(selection.getSelectedIdentityId("printer-b")).resolves.toBe("identity-b");
    database.close();
  });

  it.each([
    ["unexpected type", { id: 42 }],
    ["unknown kind", { kind: "guessed" }],
    ["partial known reference", { definition_package_version: null }],
    ["partial model pair", { model_display_name: null }],
    ["invalid timestamp", { selected_at: "2026-02-30T10:00:00Z" }],
    ["unclassified known-only data", { kind: "unclassified" }],
  ])("rejects corrupted rows: %s", (_label, overrides) => {
    const knownRow = {
      id: "identity-a",
      printer_id: "printer-a",
      kind: "known",
      selected_at: TIMESTAMP,
      definition_package_id: "package-a",
      definition_package_version: "opaque-version",
      series_definition_id: "series-a",
      model_definition_id: "model-a",
      manufacturer_display_name: "Hersteller",
      series_display_name: "Serie",
      model_display_name: "Modell",
      ...overrides,
    };
    if (overrides.kind === "unclassified") {
      knownRow.definition_package_id = "unexpected";
    }
    expect(() => parsePrinterKnowledgeIdentityRow(knownRow)).toThrow(
      PrinterKnowledgeIdentityDataIntegrityError
    );
  });
});
