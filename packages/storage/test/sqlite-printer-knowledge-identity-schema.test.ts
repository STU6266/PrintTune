import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { openConfiguredSqliteDatabase } from "../src/sqlite-connection";
import {
  PRINTTUNE_SQLITE_MIGRATIONS,
  UnsupportedSchemaVersionError,
  readSchemaVersion,
  runSqliteMigrations,
} from "../src/sqlite-migrations";

const TIMESTAMP = "2026-08-09T12:00:00.000Z";

function migrate(database: DatabaseSync): void {
  runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);
}

function seedPrinter(database: DatabaseSync, suffix: string): void {
  database
    .prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(`workspace-${suffix}`, `Workspace ${suffix}`, TIMESTAMP, TIMESTAMP);
  database
    .prepare(
      "INSERT INTO printers (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(`printer-${suffix}`, `workspace-${suffix}`, `Printer ${suffix}`, TIMESTAMP, TIMESTAMP);
}

function insertIdentity(
  database: DatabaseSync,
  values: {
    readonly id?: string;
    readonly printerId?: string;
    readonly kind?: string;
    readonly selectedAt?: string;
    readonly packageId?: string | null;
    readonly packageVersion?: string | null;
    readonly seriesId?: string | null;
    readonly modelId?: string | null;
    readonly manufacturerName?: string | null;
    readonly seriesName?: string | null;
    readonly modelName?: string | null;
  } = {}
): void {
  database
    .prepare(
      `INSERT INTO printer_knowledge_identities (
        id, printer_id, kind, selected_at,
        definition_package_id, definition_package_version, series_definition_id,
        model_definition_id, manufacturer_display_name, series_display_name, model_display_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      values.id ?? "identity-a",
      values.printerId ?? "printer-a",
      values.kind ?? "known",
      values.selectedAt ?? TIMESTAMP,
      values.packageId === undefined ? "printer-series.example" : values.packageId,
      values.packageVersion === undefined ? "opaque-v1" : values.packageVersion,
      values.seriesId === undefined ? "series-a" : values.seriesId,
      values.modelId === undefined ? null : values.modelId,
      values.manufacturerName === undefined ? "Example" : values.manufacturerName,
      values.seriesName === undefined ? "Series A" : values.seriesName,
      values.modelName === undefined ? null : values.modelName
    );
}

function insertUnclassified(database: DatabaseSync, id: string, printerId: string): void {
  insertIdentity(database, {
    id,
    printerId,
    kind: "unclassified",
    packageId: null,
    packageVersion: null,
    seriesId: null,
    modelId: null,
    manufacturerName: null,
    seriesName: null,
    modelName: null,
  });
}

describe("SQLite PrinterKnowledgeIdentity schema", () => {
  it("migrates a populated version-4 database through version 6 without losing existing data", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS.slice(0, 4));
      seedPrinter(database, "a");
      database
        .prepare("INSERT INTO printer_states (id, printer_id, created_at) VALUES (?, ?, ?)")
        .run("state-a", "printer-a", TIMESTAMP);
      database
        .prepare(
          "INSERT INTO component_installations (id, printer_state_id, component_instance_id, role, kind, display_name) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run("installation-a", "state-a", "instance-a", "toolhead.hotend", "hotend", "Hotend");
      database
        .prepare(
          `INSERT INTO field_claims (
            id, printer_state_id, field_path, value_type, number_value, unit,
            source_type, trust, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "claim-a",
          "state-a",
          "printer.nozzle.diameter",
          "number",
          0.4,
          "mm",
          "user_confirmed",
          "user_confirmed",
          TIMESTAMP
        );

      migrate(database);

      expect(readSchemaVersion(database)).toBe(6);
      for (const table of [
        "workspaces",
        "printers",
        "printer_states",
        "component_installations",
        "field_claims",
      ]) {
        expect(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({
          count: 1,
        });
      }
      expect(database.prepare("SELECT * FROM printer_knowledge_identity_selections").all()).toEqual(
        []
      );
    } finally {
      database.close();
    }
  });

  it("creates exact STRICT tables, foreign keys, and justified indexes", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      migrate(database);
      expect(readSchemaVersion(database)).toBe(6);
      expect(database.prepare("PRAGMA table_info(printer_knowledge_identities)").all()).toEqual([
        expect.objectContaining({ name: "id", type: "TEXT", notnull: 1, pk: 1 }),
        expect.objectContaining({ name: "printer_id", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "kind", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "selected_at", type: "TEXT", notnull: 1, pk: 0 }),
        ...[
          "definition_package_id",
          "definition_package_version",
          "series_definition_id",
          "model_definition_id",
          "manufacturer_display_name",
          "series_display_name",
          "model_display_name",
        ].map((name) => expect.objectContaining({ name, type: "TEXT", notnull: 0, pk: 0 })),
      ]);
      expect(
        database.prepare("PRAGMA table_info(printer_knowledge_identity_selections)").all()
      ).toEqual([
        expect.objectContaining({ name: "printer_id", type: "TEXT", notnull: 1, pk: 1 }),
        expect.objectContaining({ name: "identity_id", type: "TEXT", notnull: 1, pk: 0 }),
      ]);
      expect(database.prepare("PRAGMA table_list").all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "printer_knowledge_identities", strict: 1 }),
          expect.objectContaining({ name: "printer_knowledge_identity_selections", strict: 1 }),
        ])
      );
      expect(database.prepare("PRAGMA index_list(printer_knowledge_identities)").all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "printer_knowledge_identities_printer_history_idx",
            unique: 0,
          }),
          expect.objectContaining({ unique: 1 }),
        ])
      );
      expect(
        database.prepare("PRAGMA foreign_key_list(printer_knowledge_identities)").all()
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: "printers",
            from: "printer_id",
            to: "id",
            on_delete: "CASCADE",
          }),
        ])
      );
      const selectionForeignKeys = database
        .prepare("PRAGMA foreign_key_list(printer_knowledge_identity_selections)")
        .all();
      expect(selectionForeignKeys).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: "printers",
            from: "printer_id",
            to: "id",
            on_delete: "CASCADE",
          }),
          expect.objectContaining({
            table: "printer_knowledge_identities",
            from: "printer_id",
            to: "printer_id",
            on_delete: "CASCADE",
          }),
          expect.objectContaining({
            table: "printer_knowledge_identities",
            from: "identity_id",
            to: "id",
            on_delete: "CASCADE",
          }),
        ])
      );
      seedPrinter(database, "a");
      expect(() =>
        database
          .prepare(
            `INSERT INTO printer_knowledge_identities (
              id, printer_id, kind, selected_at
            ) VALUES (?, ?, ?, ?)`
          )
          .run(new Uint8Array([1]), "printer-a", "unclassified", TIMESTAMP)
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("accepts known series, known model, and unclassified identities", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      migrate(database);
      seedPrinter(database, "a");
      insertIdentity(database, { id: "series" });
      insertIdentity(database, { id: "model", modelId: "model-pro", modelName: "Model Pro" });
      insertUnclassified(database, "custom", "printer-a");
      expect(
        database.prepare("SELECT id FROM printer_knowledge_identities ORDER BY id").all()
      ).toEqual([{ id: "custom" }, { id: "model" }, { id: "series" }]);
    } finally {
      database.close();
    }
  });

  it.each([
    { id: "unknown-kind", kind: "suggested" },
    { id: "known-no-package", packageId: null },
    { id: "known-no-version", packageVersion: null },
    { id: "known-no-series", seriesId: null },
    { id: "known-no-manufacturer", manufacturerName: null },
    { id: "known-no-series-name", seriesName: null },
    { id: "model-id-only", modelId: "model-pro" },
    { id: "model-name-only", modelName: "Model Pro" },
  ])("rejects malformed known identity $id", (values) => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      migrate(database);
      seedPrinter(database, "a");
      expect(() => insertIdentity(database, values)).toThrow();
    } finally {
      database.close();
    }
  });

  it("rejects reference or display data on unclassified identities", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      migrate(database);
      seedPrinter(database, "a");
      expect(() =>
        insertIdentity(database, {
          id: "unclassified-package",
          kind: "unclassified",
          manufacturerName: null,
          seriesName: null,
          modelName: null,
        })
      ).toThrow();
      expect(() =>
        insertIdentity(database, {
          id: "unclassified-display",
          kind: "unclassified",
          packageId: null,
          packageVersion: null,
          seriesId: null,
          modelId: null,
          manufacturerName: "Custom",
          seriesName: null,
          modelName: null,
        })
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("enforces Printer ownership, permits history, and rejects duplicate identity IDs", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      migrate(database);
      seedPrinter(database, "a");
      insertIdentity(database, { id: "history-a" });
      insertIdentity(database, { id: "history-b", selectedAt: "2026-08-09T13:00:00.000Z" });
      expect(() => insertIdentity(database, { id: "history-a" })).toThrow();
      expect(() =>
        insertIdentity(database, { id: "orphan", printerId: "printer-missing" })
      ).toThrow();
      expect(
        database
          .prepare(
            "SELECT id FROM printer_knowledge_identities WHERE printer_id = ? ORDER BY selected_at, id"
          )
          .all("printer-a")
      ).toEqual([{ id: "history-a" }, { id: "history-b" }]);
    } finally {
      database.close();
    }
  });

  it("enforces zero-or-one same-Printer current selection and permits an explicit raw SQL update", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      migrate(database);
      seedPrinter(database, "a");
      seedPrinter(database, "b");
      insertIdentity(database, { id: "identity-a1", printerId: "printer-a" });
      insertIdentity(database, { id: "identity-a2", printerId: "printer-a" });
      insertIdentity(database, { id: "identity-b", printerId: "printer-b" });
      expect(database.prepare("SELECT * FROM printer_knowledge_identity_selections").all()).toEqual(
        []
      );
      const insert = database.prepare(
        "INSERT INTO printer_knowledge_identity_selections (printer_id, identity_id) VALUES (?, ?)"
      );
      insert.run("printer-a", "identity-a1");
      expect(() => insert.run("printer-a", "identity-a2")).toThrow();
      expect(() => insert.run("printer-a", "identity-b")).toThrow();
      database
        .prepare(
          "UPDATE printer_knowledge_identity_selections SET identity_id = ? WHERE printer_id = ?"
        )
        .run("identity-a2", "printer-a");
      expect(database.prepare("SELECT * FROM printer_knowledge_identity_selections").all()).toEqual(
        [{ printer_id: "printer-a", identity_id: "identity-a2" }]
      );
    } finally {
      database.close();
    }
  });

  it("cascades Printer deletion to its history and selection without affecting another Printer", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      migrate(database);
      for (const suffix of ["a", "b"]) {
        seedPrinter(database, suffix);
        insertIdentity(database, { id: `identity-${suffix}`, printerId: `printer-${suffix}` });
        database
          .prepare(
            "INSERT INTO printer_knowledge_identity_selections (printer_id, identity_id) VALUES (?, ?)"
          )
          .run(`printer-${suffix}`, `identity-${suffix}`);
      }
      database.prepare("DELETE FROM printers WHERE id = ?").run("printer-a");
      expect(database.prepare("SELECT id FROM printer_knowledge_identities").all()).toEqual([
        { id: "identity-b" },
      ]);
      expect(database.prepare("SELECT * FROM printer_knowledge_identity_selections").all()).toEqual(
        [{ printer_id: "printer-b", identity_id: "identity-b" }]
      );
    } finally {
      database.close();
    }
  });

  it("persists history and selection across reopen and remains idempotent", () => {
    const directory = mkdtempSync(join(tmpdir(), "printtune-printer-knowledge-schema-"));
    const path = join(directory, "printtune.sqlite");
    try {
      const first = openConfiguredSqliteDatabase(path);
      migrate(first);
      seedPrinter(first, "a");
      insertIdentity(first);
      first
        .prepare(
          "INSERT INTO printer_knowledge_identity_selections (printer_id, identity_id) VALUES (?, ?)"
        )
        .run("printer-a", "identity-a");
      first.close();

      const second = openConfiguredSqliteDatabase(path);
      try {
        migrate(second);
        migrate(second);
        expect(readSchemaVersion(second)).toBe(6);
        expect(second.prepare("SELECT id FROM printer_knowledge_identities").all()).toEqual([
          { id: "identity-a" },
        ]);
        expect(second.prepare("SELECT * FROM printer_knowledge_identity_selections").all()).toEqual(
          [{ printer_id: "printer-a", identity_id: "identity-a" }]
        );
      } finally {
        second.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
    expect(existsSync(directory)).toBe(false);
  });

  it("retains unsupported newer-schema rejection at version 7", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    database.exec("PRAGMA user_version = 7");
    try {
      expect(() => migrate(database)).toThrow(UnsupportedSchemaVersionError);
      expect(readSchemaVersion(database)).toBe(7);
    } finally {
      database.close();
    }
  });
});
