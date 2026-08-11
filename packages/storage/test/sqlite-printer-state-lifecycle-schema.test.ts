import type { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { openConfiguredSqliteDatabase } from "../src/sqlite-connection";
import {
  AmbiguousLegacyPrinterStateError,
  PRINTTUNE_SQLITE_MIGRATIONS,
  readSchemaVersion,
  runSqliteMigrations,
} from "../src/sqlite-migrations";

const TIMESTAMP = "2026-08-10T10:00:00.000Z";

function migrateToV8(database: DatabaseSync): void {
  runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS.slice(0, 8));
}

function seedWorkspaceAndPrinter(database: DatabaseSync, suffix = "a"): void {
  database
    .prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(`workspace-${suffix}`, `Workspace ${suffix}`, TIMESTAMP, TIMESTAMP);
  database
    .prepare(
      "INSERT INTO printers (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(`printer-${suffix}`, `workspace-${suffix}`, `Printer ${suffix}`, TIMESTAMP, TIMESTAMP);
}

describe("SQLite migration 009 PrinterState lifecycle schema", () => {
  it("creates Migration 010 command bookkeeping and relational transition provenance", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);
      expect(readSchemaVersion(database)).toBe(10);
      expect(database.prepare("PRAGMA table_list").all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "printer_state_transition_commands", strict: 1 }),
          expect.objectContaining({ name: "field_claims", strict: 1 }),
        ])
      );
      expect(database.prepare("PRAGMA foreign_key_list(field_claims)").all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: "source_claim_id",
            table: "field_claims",
            on_delete: "NO ACTION",
          }),
          expect.objectContaining({
            from: "transition_command_id",
            table: "printer_state_transition_commands",
            on_delete: "NO ACTION",
          }),
        ])
      );
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("preserves a representative v8 database and selects its exact existing State", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      migrateToV8(database);
      seedWorkspaceAndPrinter(database);
      database
        .prepare("INSERT INTO printer_states (id, printer_id, created_at) VALUES (?, ?, ?)")
        .run("state-a", "printer-a", TIMESTAMP);
      database
        .prepare(
          `INSERT INTO component_installations (
            id, printer_state_id, component_instance_id, role, kind, display_name
          ) VALUES (?, ?, ?, ?, ?, ?)`
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
      database
        .prepare(
          `INSERT INTO printer_knowledge_identities (
            id, printer_id, kind, selected_at, definition_package_id,
            definition_package_version, series_definition_id,
            manufacturer_display_name, series_display_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "identity-a",
          "printer-a",
          "known",
          TIMESTAMP,
          "package-a",
          "1.0.0",
          "series-a",
          "Maker",
          "Series"
        );
      database
        .prepare(
          "INSERT INTO printer_knowledge_identity_selections (printer_id, identity_id) VALUES (?, ?)"
        )
        .run("printer-a", "identity-a");
      database
        .prepare(
          `INSERT INTO installed_knowledge_packages (
            package_id, package_version, format_version, package_type, raw_text,
            content_sha256, installation_source, trust, installed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "package-a",
          "1.0.0",
          1,
          "printer_series",
          "{}",
          "0".repeat(64),
          "bundled_official",
          "developer_verified",
          TIMESTAMP
        );
      database
        .prepare(
          `INSERT INTO package_applications (
            id, printer_id, printer_state_id, printer_knowledge_identity_id,
            package_id, package_version, series_definition_id,
            core_contract_version, package_trust, applied_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "application-a",
          "printer-a",
          "state-a",
          "identity-a",
          "package-a",
          "1.0.0",
          "series-a",
          "1.0.0",
          "developer_verified",
          TIMESTAMP
        );
      database
        .prepare(
          `INSERT INTO package_application_claims (application_id, claim_id, claim_order)
           VALUES (?, ?, ?)`
        )
        .run("application-a", "claim-a", 0);

      const preservedTables = [
        "workspaces",
        "printers",
        "printer_states",
        "component_installations",
        "field_claims",
        "printer_knowledge_identities",
        "printer_knowledge_identity_selections",
        "installed_knowledge_packages",
        "package_applications",
        "package_application_claims",
      ] as const;
      const before = new Map(
        preservedTables.map((table) => [table, database.prepare(`SELECT * FROM ${table}`).all()])
      );

      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);

      expect(readSchemaVersion(database)).toBe(10);
      for (const table of preservedTables) {
        expect(database.prepare(`SELECT * FROM ${table}`).all()).toEqual(
          before.get(table)?.map((row) => expect.objectContaining(row as Record<string, unknown>))
        );
      }
      expect(database.prepare("SELECT * FROM printer_state_selections").all()).toEqual([
        { printer_id: "printer-a", printer_state_id: "state-a" },
      ]);
      expect(database.prepare("SELECT * FROM printer_state_lineage").all()).toEqual([]);
      expect(database.prepare("SELECT count(*) AS count FROM field_claims").get()).toEqual({
        count: 1,
      });
      expect(database.prepare("SELECT count(*) AS count FROM package_applications").get()).toEqual({
        count: 1,
      });
      expect(
        database.prepare("SELECT count(*) AS count FROM component_installations").get()
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  it.each([0, 2])("rejects a legacy Printer with %i States without guessing", (stateCount) => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      migrateToV8(database);
      seedWorkspaceAndPrinter(database);
      for (let index = 0; index < stateCount; index += 1) {
        database
          .prepare("INSERT INTO printer_states (id, printer_id, created_at) VALUES (?, ?, ?)")
          .run(`state-${index}`, "printer-a", TIMESTAMP);
      }

      expect(() => runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS)).toThrow(
        AmbiguousLegacyPrinterStateError
      );
      expect(readSchemaVersion(database)).toBe(8);
      expect(
        database
          .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?")
          .get("printer_state_selections")
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("creates STRICT ownership-constrained lineage and selection relations", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);
      expect(database.prepare("PRAGMA table_list").all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "printer_state_lineage", strict: 1 }),
          expect.objectContaining({ name: "printer_state_selections", strict: 1 }),
        ])
      );
      seedWorkspaceAndPrinter(database, "a");
      seedWorkspaceAndPrinter(database, "b");
      for (const [stateId, printerId] of [
        ["state-a1", "printer-a"],
        ["state-a2", "printer-a"],
        ["state-b1", "printer-b"],
      ] as const) {
        database
          .prepare("INSERT INTO printer_states (id, printer_id, created_at) VALUES (?, ?, ?)")
          .run(stateId, printerId, TIMESTAMP);
      }
      database
        .prepare(
          `INSERT INTO printer_state_lineage (
            printer_id, child_printer_state_id, parent_printer_state_id
          ) VALUES (?, ?, ?)`
        )
        .run("printer-a", "state-a2", "state-a1");
      expect(() =>
        database
          .prepare(
            `INSERT INTO printer_state_lineage (
              printer_id, child_printer_state_id, parent_printer_state_id
            ) VALUES (?, ?, ?)`
          )
          .run("printer-b", "state-b1", "state-a1")
      ).toThrow();
      expect(() =>
        database
          .prepare(
            "INSERT INTO printer_state_selections (printer_id, printer_state_id) VALUES (?, ?)"
          )
          .run("printer-a", "state-b1")
      ).toThrow();
    } finally {
      database.close();
    }
  });
});
