import type { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { openConfiguredSqliteDatabase } from "../src/sqlite-connection";
import {
  PRINTTUNE_SQLITE_MIGRATIONS,
  readSchemaVersion,
  runSqliteMigrations,
} from "../src/sqlite-migrations";

const TIMESTAMP = "2026-08-09T10:00:00.000Z";
const DIGEST = "a".repeat(64);

function migrate(database: DatabaseSync): void {
  runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);
}

function insertPackage(
  database: DatabaseSync,
  overrides: {
    packageId?: unknown;
    packageVersion?: unknown;
    formatVersion?: unknown;
    packageType?: unknown;
    rawText?: unknown;
    digest?: unknown;
    source?: unknown;
    trust?: unknown;
    installedAt?: unknown;
  } = {}
): void {
  database
    .prepare(
      `INSERT INTO installed_knowledge_packages (
        package_id, package_version, format_version, package_type, raw_text, content_sha256,
        installation_source, trust, installed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      (overrides.packageId ?? "package-a") as string,
      (overrides.packageVersion ?? "1.0") as string,
      (overrides.formatVersion ?? 1) as number,
      (overrides.packageType ?? "printer_series") as string,
      (overrides.rawText ?? " {} ") as string,
      (overrides.digest ?? DIGEST) as string,
      (overrides.source ?? "bundled_official") as string,
      (overrides.trust ?? "developer_verified") as string,
      (overrides.installedAt ?? TIMESTAMP) as string
    );
}

describe("SQLite installed Knowledge Package schema", () => {
  it("creates migration 007 as one exact STRICT composite-key table", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      migrate(database);
      expect(readSchemaVersion(database)).toBe(8);
      expect(database.prepare("PRAGMA table_info(installed_knowledge_packages)").all()).toEqual([
        expect.objectContaining({ name: "package_id", type: "TEXT", notnull: 1, pk: 1 }),
        expect.objectContaining({ name: "package_version", type: "TEXT", notnull: 1, pk: 2 }),
        expect.objectContaining({ name: "format_version", type: "INTEGER", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "package_type", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "raw_text", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "content_sha256", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "installation_source", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "trust", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "installed_at", type: "TEXT", notnull: 1, pk: 0 }),
      ]);
      expect(database.prepare("PRAGMA table_list").all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "installed_knowledge_packages", strict: 1 }),
        ])
      );
      expect(
        database.prepare("PRAGMA foreign_key_list(installed_knowledge_packages)").all()
      ).toEqual([]);
    } finally {
      database.close();
    }
  });

  it.each([
    ["uppercase", "A".repeat(64)],
    ["invalid character", `${"a".repeat(63)}g`],
    ["short", "a".repeat(63)],
    ["long", "a".repeat(65)],
  ])("rejects %s SHA-256 representations while accepting lowercase 64-hex", (_label, digest) => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      migrate(database);
      expect(() => insertPackage(database, { digest })).toThrow(/CHECK constraint failed/);
      expect(() => insertPackage(database, { packageId: "valid", digest: DIGEST })).not.toThrow();
    } finally {
      database.close();
    }
  });

  it.each([
    ["bundled_official", "customer_verified"],
    ["customer_verified_installation", "developer_verified"],
    ["manual_import", "customer_verified"],
  ])("rejects invalid database source/trust pair %s → %s", (source, trust) => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      migrate(database);
      expect(() => insertPackage(database, { source, trust })).toThrow(/CHECK constraint failed/);
    } finally {
      database.close();
    }
  });

  it("allows exact raw-text whitespace and rejects a duplicate physical identity", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      migrate(database);
      insertPackage(database, { rawText: " \n{}\t " });
      expect(database.prepare("SELECT raw_text FROM installed_knowledge_packages").get()).toEqual({
        raw_text: " \n{}\t ",
      });
      expect(() => insertPackage(database)).toThrow(/UNIQUE constraint failed/);
      expect(
        database.prepare("SELECT count(*) AS count FROM installed_knowledge_packages").get()
      ).toEqual({
        count: 1,
      });
    } finally {
      database.close();
    }
  });

  it("migrates populated version 6 data to 7 without fabricating installed packages", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS.slice(0, 6));
      database
        .prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .run("workspace-a", "A", TIMESTAMP, TIMESTAMP);
      database
        .prepare(
          "INSERT INTO printers (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        )
        .run("printer-a", "workspace-a", "A", TIMESTAMP, TIMESTAMP);
      database
        .prepare("INSERT INTO printer_states (id, printer_id, created_at) VALUES (?, ?, ?)")
        .run("state-a", "printer-a", TIMESTAMP);
      database
        .prepare(
          "INSERT INTO component_installations (id, printer_state_id, component_instance_id, role, kind, display_name) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run("installation-a", "state-a", "component-a", "toolhead.hotend", "hotend", "Hotend");
      database
        .prepare(
          `INSERT INTO field_claims (
            id, printer_state_id, field_path, value_type, number_value, unit,
            source_type, source_package_id, source_package_version, source_fact_id,
            trust, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "claim-a",
          "state-a",
          "printer.nozzle.diameter",
          "number",
          0.4,
          "mm",
          "knowledge_package",
          "package-a",
          "1.0",
          "fact-a",
          "developer_verified",
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
          "1.0",
          "series-a",
          "Synthetic",
          "Series"
        );
      database
        .prepare(
          "INSERT INTO printer_knowledge_identity_selections (printer_id, identity_id) VALUES (?, ?)"
        )
        .run("printer-a", "identity-a");

      migrate(database);
      migrate(database);

      expect(readSchemaVersion(database)).toBe(8);
      for (const table of [
        "workspaces",
        "printers",
        "printer_states",
        "component_installations",
        "field_claims",
        "printer_knowledge_identities",
        "printer_knowledge_identity_selections",
      ]) {
        expect(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({
          count: 1,
        });
      }
      expect(database.prepare("SELECT source_fact_id FROM field_claims").get()).toEqual({
        source_fact_id: "fact-a",
      });
      expect(database.prepare("SELECT * FROM installed_knowledge_packages").all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
