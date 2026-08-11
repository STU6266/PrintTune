import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  PRINTTUNE_SQLITE_MIGRATIONS,
  readSchemaVersion,
  runSqliteMigrations,
} from "../src/sqlite-migrations";

function insertVersion7History(database: DatabaseSync): void {
  database
    .prepare("INSERT INTO workspaces VALUES (?, ?, ?, ?)")
    .run("workspace-a", "Workspace", "2026-08-10T08:00:00Z", "2026-08-10T08:00:00Z");
  const printer = database.prepare("INSERT INTO printers VALUES (?, ?, ?, ?, ?)");
  printer.run("printer-a", "workspace-a", "A", "2026-08-10T08:00:00Z", "2026-08-10T08:00:00Z");
  printer.run("printer-b", "workspace-a", "B", "2026-08-10T08:00:00Z", "2026-08-10T08:00:00Z");
  const state = database.prepare("INSERT INTO printer_states VALUES (?, ?, ?)");
  state.run("state-a", "printer-a", "2026-08-10T08:00:00Z");
  state.run("state-b", "printer-b", "2026-08-10T08:00:00Z");
  database
    .prepare(
      `INSERT INTO component_installations
       (id, printer_state_id, component_instance_id, role, kind, display_name)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run("component-a", "state-a", "instance-a", "toolhead.nozzle", "nozzle", "Nozzle");
  database
    .prepare(
      `INSERT INTO field_claims (
        id, printer_state_id, field_path, value_type, number_value, unit,
        source_type, source_package_id, source_package_version, trust, created_at, source_fact_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "historical-claim",
      "state-a",
      "printer.nozzle.diameter",
      "number",
      0.4,
      "mm",
      "knowledge_package",
      "package-a",
      "1.0.0",
      "developer_verified",
      "2026-08-10T08:00:00Z",
      "stock-nozzle-diameter"
    );
  const identity = database.prepare(
    `INSERT INTO printer_knowledge_identities
     (id, printer_id, kind, selected_at) VALUES (?, ?, 'unclassified', ?)`
  );
  identity.run("identity-a", "printer-a", "2026-08-10T08:00:00Z");
  identity.run("identity-b", "printer-b", "2026-08-10T08:00:00Z");
  database
    .prepare("INSERT INTO printer_knowledge_identity_selections VALUES (?, ?)")
    .run("printer-a", "identity-a");
  database
    .prepare("INSERT INTO installed_knowledge_packages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      "package-a",
      "1.0.0",
      1,
      "printer_series",
      "{}",
      "a".repeat(64),
      "bundled_official",
      "developer_verified",
      "2026-08-10T08:00:00Z"
    );
}

describe("SQLite migration 008", () => {
  it("migrates version 7 history without fabricating applications or Claim links", () => {
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS.slice(0, 7));
      insertVersion7History(database);
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);

      expect(readSchemaVersion(database)).toBe(9);
      expect(database.prepare("SELECT id, source_fact_id FROM field_claims").all()).toEqual([
        { id: "historical-claim", source_fact_id: "stock-nozzle-diameter" },
      ]);
      expect(database.prepare("SELECT * FROM package_applications").all()).toEqual([]);
      expect(database.prepare("SELECT * FROM package_application_claims").all()).toEqual([]);
      expect(database.prepare("SELECT package_id FROM installed_knowledge_packages").all()).toEqual(
        [{ package_id: "package-a" }]
      );
      expect(database.prepare("PRAGMA table_list").all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "package_applications", strict: 1 }),
          expect.objectContaining({ name: "package_application_claims", strict: 1 }),
        ])
      );
    } finally {
      database.close();
    }
  });

  it("enforces same-Printer ownership, semantic uniqueness, and exact Claim membership", () => {
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS.slice(0, 7));
      insertVersion7History(database);
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);
      const insert = database.prepare(
        `INSERT INTO package_applications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      expect(() =>
        insert.run(
          "mixed",
          "printer-a",
          "state-b",
          "identity-a",
          "package-a",
          "1.0.0",
          "series-a",
          null,
          "1.0.0",
          "developer_verified",
          "2026-08-10T10:00:00Z"
        )
      ).toThrow();
      insert.run(
        "application-a",
        "printer-a",
        "state-a",
        "identity-a",
        "package-a",
        "1.0.0",
        "series-a",
        null,
        "1.0.0",
        "developer_verified",
        "2026-08-10T10:00:00Z"
      );
      expect(() =>
        insert.run(
          "application-b",
          "printer-a",
          "state-a",
          "identity-a",
          "package-a",
          "1.0.0",
          "series-a",
          null,
          "1.0.0",
          "developer_verified",
          "2026-08-10T11:00:00Z"
        )
      ).toThrow();
      database
        .prepare("INSERT INTO package_application_claims VALUES (?, ?, ?)")
        .run("application-a", "historical-claim", 0);
      expect(() =>
        database
          .prepare("INSERT INTO package_application_claims VALUES (?, ?, ?)")
          .run("application-a", "missing", 1)
      ).toThrow();
    } finally {
      database.close();
    }
  });
});
