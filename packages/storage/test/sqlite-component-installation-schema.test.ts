import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { openConfiguredSqliteDatabase } from "../src/sqlite-connection";
import {
  PRINTTUNE_SQLITE_MIGRATIONS,
  readSchemaVersion,
  runSqliteMigrations,
} from "../src/sqlite-migrations";

const TIMESTAMP = "2026-08-09T08:00:00.000Z";

function insertWorkspace(database: DatabaseSync, id: string): void {
  database
    .prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, id, TIMESTAMP, TIMESTAMP);
}

function insertPrinter(database: DatabaseSync, id: string, workspaceId: string): void {
  database
    .prepare(
      "INSERT INTO printers (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, workspaceId, id, TIMESTAMP, TIMESTAMP);
}

function insertState(database: DatabaseSync, id: string, printerId: string): void {
  database
    .prepare("INSERT INTO printer_states (id, printer_id, created_at) VALUES (?, ?, ?)")
    .run(id, printerId, TIMESTAMP);
}

function installationStatement(database: DatabaseSync) {
  return database.prepare(`
    INSERT INTO component_installations (
      id,
      printer_state_id,
      component_instance_id,
      role,
      kind,
      display_name,
      definition_package_id,
      definition_package_version,
      definition_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
}

function seedState(database: DatabaseSync): void {
  insertWorkspace(database, "workspace-a");
  insertPrinter(database, "printer-a", "workspace-a");
  insertState(database, "state-a", "printer-a");
}

describe("SQLite ComponentInstallation schema", () => {
  it("migrates version 2 to 3 without changing existing hierarchy data", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS.slice(0, 2));
      seedState(database);
      expect(readSchemaVersion(database)).toBe(2);

      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS.slice(0, 3));

      expect(readSchemaVersion(database)).toBe(3);
      expect(database.prepare("SELECT id FROM workspaces").all()).toEqual([{ id: "workspace-a" }]);
      expect(database.prepare("SELECT id FROM printers").all()).toEqual([{ id: "printer-a" }]);
      expect(database.prepare("SELECT id FROM printer_states").all()).toEqual([{ id: "state-a" }]);
    } finally {
      database.close();
    }
  });

  it("creates the exact STRICT table and justified indexes", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);
      seedState(database);

      expect(database.prepare("PRAGMA table_info(component_installations)").all()).toEqual([
        expect.objectContaining({ name: "id", type: "TEXT", notnull: 1, pk: 1 }),
        expect.objectContaining({ name: "printer_state_id", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "component_instance_id", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "role", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "kind", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "display_name", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "definition_package_id", type: "TEXT", notnull: 0, pk: 0 }),
        expect.objectContaining({
          name: "definition_package_version",
          type: "TEXT",
          notnull: 0,
          pk: 0,
        }),
        expect.objectContaining({ name: "definition_id", type: "TEXT", notnull: 0, pk: 0 }),
      ]);
      expect(database.prepare("PRAGMA table_list").all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "component_installations", strict: 1 }),
        ])
      );
      expect(database.prepare("PRAGMA index_list(component_installations)").all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "component_installations_component_instance_id_idx",
            unique: 0,
          }),
          expect.objectContaining({ unique: 1 }),
        ])
      );
      expect(() =>
        installationStatement(database).run(
          new Uint8Array([1]),
          "state-a",
          "instance-a",
          "toolhead.hotend",
          "hotend",
          "Hotend",
          null,
          null,
          null
        )
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("enforces the PrinterState foreign key", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);
      expect(() =>
        installationStatement(database).run(
          "installation-orphan",
          "state-missing",
          "instance-a",
          "toolhead.hotend",
          "hotend",
          "Hotend",
          null,
          null,
          null
        )
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("allows repeated kinds but enforces role uniqueness only within a PrinterState", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);
      seedState(database);
      insertState(database, "state-b", "printer-a");
      const insert = installationStatement(database);

      insert.run(
        "installation-left",
        "state-a",
        "motor-left",
        "motion.z.motor.left",
        "stepper-motor",
        "Left Z motor",
        null,
        null,
        null
      );
      insert.run(
        "installation-right",
        "state-a",
        "motor-right",
        "motion.z.motor.right",
        "stepper-motor",
        "Right Z motor",
        null,
        null,
        null
      );
      expect(() =>
        insert.run(
          "installation-duplicate-role",
          "state-a",
          "motor-other",
          "motion.z.motor.left",
          "stepper-motor",
          "Other motor",
          null,
          null,
          null
        )
      ).toThrow();
      expect(() =>
        insert.run(
          "installation-other-state",
          "state-b",
          "motor-left",
          "motion.z.motor.left",
          "stepper-motor",
          "Left Z motor",
          null,
          null,
          null
        )
      ).not.toThrow();

      expect(
        database
          .prepare("SELECT id FROM component_installations WHERE kind = ? ORDER BY id")
          .all("stepper-motor")
      ).toHaveLength(3);
    } finally {
      database.close();
    }
  });

  it("accepts absent or complete definition references and rejects partial references", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);
      seedState(database);
      const insert = installationStatement(database);
      insert.run(
        "installation-unknown",
        "state-a",
        "instance-unknown",
        "cooling.part.1",
        "cooling-fan",
        "Generic blower",
        null,
        null,
        null
      );
      insert.run(
        "installation-known",
        "state-a",
        "instance-known",
        "toolhead.hotend",
        "hotend",
        "Known hotend",
        "components.base",
        "1.0.0",
        "hotend.known"
      );

      for (const [packageId, packageVersion, definitionId] of [
        ["components.base", null, null],
        ["components.base", "1.0.0", null],
        [null, "1.0.0", "hotend.known"],
      ] as const) {
        expect(() =>
          insert.run(
            `partial-${String(packageId)}-${String(packageVersion)}`,
            "state-a",
            `instance-${String(packageId)}-${String(packageVersion)}`,
            `test.partial-${String(packageId)}-${String(packageVersion)}`,
            "test-component",
            "Partial",
            packageId,
            packageVersion,
            definitionId
          )
        ).toThrow();
      }
    } finally {
      database.close();
    }
  });

  it("cascades the full hierarchy while preserving unrelated installations", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);
      insertWorkspace(database, "workspace-a");
      insertWorkspace(database, "workspace-b");
      insertPrinter(database, "printer-a", "workspace-a");
      insertPrinter(database, "printer-a2", "workspace-a");
      insertPrinter(database, "printer-b", "workspace-b");
      insertState(database, "state-direct", "printer-a");
      insertState(database, "state-printer", "printer-a");
      insertState(database, "state-workspace", "printer-a2");
      insertState(database, "state-unrelated", "printer-b");
      const insert = installationStatement(database);
      for (const [id, stateId] of [
        ["installation-direct", "state-direct"],
        ["installation-printer", "state-printer"],
        ["installation-workspace", "state-workspace"],
        ["installation-unrelated", "state-unrelated"],
      ]) {
        insert.run(id, stateId, id, "toolhead.hotend", "hotend", id, null, null, null);
      }

      database.prepare("DELETE FROM printer_states WHERE id = ?").run("state-direct");
      expect(
        database
          .prepare("SELECT id FROM component_installations WHERE id = ?")
          .get("installation-direct")
      ).toBeUndefined();
      database.prepare("DELETE FROM printers WHERE id = ?").run("printer-a");
      expect(
        database
          .prepare("SELECT id FROM component_installations WHERE id = ?")
          .get("installation-printer")
      ).toBeUndefined();
      database.prepare("DELETE FROM workspaces WHERE id = ?").run("workspace-a");

      expect(database.prepare("SELECT id FROM component_installations").all()).toEqual([
        { id: "installation-unrelated" },
      ]);
    } finally {
      database.close();
    }
  });

  it("preserves installation records across reopen and remains idempotent", () => {
    const directory = mkdtempSync(join(tmpdir(), "printtune-component-schema-"));
    const path = join(directory, "printtune.sqlite");
    try {
      const first = openConfiguredSqliteDatabase(path);
      runSqliteMigrations(first, PRINTTUNE_SQLITE_MIGRATIONS);
      seedState(first);
      installationStatement(first).run(
        "installation-a",
        "state-a",
        "instance-a",
        "toolhead.hotend",
        "hotend",
        "Hotend",
        null,
        null,
        null
      );
      first.close();

      const second = openConfiguredSqliteDatabase(path);
      try {
        runSqliteMigrations(second, PRINTTUNE_SQLITE_MIGRATIONS);
        runSqliteMigrations(second, PRINTTUNE_SQLITE_MIGRATIONS);
        expect(readSchemaVersion(second)).toBe(9);
        expect(second.prepare("SELECT id FROM component_installations").all()).toEqual([
          { id: "installation-a" },
        ]);
      } finally {
        second.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
