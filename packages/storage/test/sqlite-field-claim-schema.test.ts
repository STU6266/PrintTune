import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

const TIMESTAMP = "2026-08-09T10:00:00.000Z";

interface ClaimRow {
  readonly id: string;
  readonly printerStateId: string | null;
  readonly componentInstallationId: string | null;
  readonly fieldPath: string;
  readonly valueType: string;
  readonly stringValue: string | null;
  readonly numberValue: number | null;
  readonly booleanValue: number | null;
  readonly unit: string | null;
  readonly sourceType: string;
  readonly sourceReferenceId: string | null;
  readonly sourcePackageId: string | null;
  readonly sourcePackageVersion: string | null;
  readonly sourceDefinitionId: string | null;
  readonly trust: string;
  readonly confidence: number | null;
  readonly createdAt: string;
}

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

function insertInstallation(database: DatabaseSync, id: string, stateId: string): void {
  database
    .prepare(
      `INSERT INTO component_installations (
        id, printer_state_id, component_instance_id, role, kind, display_name
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, stateId, `instance-${id}`, `test.${id}`, "test-component", id);
}

function seedHierarchy(database: DatabaseSync, suffix = "a"): void {
  insertWorkspace(database, `workspace-${suffix}`);
  insertPrinter(database, `printer-${suffix}`, `workspace-${suffix}`);
  insertState(database, `state-${suffix}`, `printer-${suffix}`);
  insertInstallation(database, `installation-${suffix}`, `state-${suffix}`);
}

function defaultClaim(overrides: Partial<ClaimRow> = {}): ClaimRow {
  return {
    id: "claim-a",
    printerStateId: "state-a",
    componentInstallationId: null,
    fieldPath: "printer.nozzle.diameter",
    valueType: "number",
    stringValue: null,
    numberValue: 0.4,
    booleanValue: null,
    unit: "mm",
    sourceType: "user_confirmed",
    sourceReferenceId: null,
    sourcePackageId: null,
    sourcePackageVersion: null,
    sourceDefinitionId: null,
    trust: "user_confirmed",
    confidence: null,
    createdAt: TIMESTAMP,
    ...overrides,
  };
}

function insertClaim(database: DatabaseSync, overrides: Partial<ClaimRow> = {}): void {
  const row = defaultClaim(overrides);
  database
    .prepare(
      `INSERT INTO field_claims (
        id,
        printer_state_id,
        component_installation_id,
        field_path,
        value_type,
        string_value,
        number_value,
        boolean_value,
        unit,
        source_type,
        source_reference_id,
        source_package_id,
        source_package_version,
        source_definition_id,
        trust,
        confidence,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.printerStateId,
      row.componentInstallationId,
      row.fieldPath,
      row.valueType,
      row.stringValue,
      row.numberValue,
      row.booleanValue,
      row.unit,
      row.sourceType,
      row.sourceReferenceId,
      row.sourcePackageId,
      row.sourcePackageVersion,
      row.sourceDefinitionId,
      row.trust,
      row.confidence,
      row.createdAt
    );
}

function openMigratedDatabase(): DatabaseSync {
  const database = openConfiguredSqliteDatabase(":memory:");
  runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);
  return database;
}

describe("SQLite FieldClaim schema", () => {
  it("creates the exact STRICT table at schema version 4", () => {
    const database = openMigratedDatabase();
    try {
      expect(readSchemaVersion(database)).toBe(4);
      expect(database.prepare("PRAGMA table_info(field_claims)").all()).toEqual([
        expect.objectContaining({ name: "id", type: "TEXT", notnull: 1, pk: 1 }),
        expect.objectContaining({ name: "printer_state_id", type: "TEXT", notnull: 0, pk: 0 }),
        expect.objectContaining({
          name: "component_installation_id",
          type: "TEXT",
          notnull: 0,
          pk: 0,
        }),
        expect.objectContaining({ name: "field_path", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "value_type", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "string_value", type: "TEXT", notnull: 0, pk: 0 }),
        expect.objectContaining({ name: "number_value", type: "REAL", notnull: 0, pk: 0 }),
        expect.objectContaining({ name: "boolean_value", type: "INTEGER", notnull: 0, pk: 0 }),
        expect.objectContaining({ name: "unit", type: "TEXT", notnull: 0, pk: 0 }),
        expect.objectContaining({ name: "source_type", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({
          name: "source_reference_id",
          type: "TEXT",
          notnull: 0,
          pk: 0,
        }),
        expect.objectContaining({ name: "source_package_id", type: "TEXT", notnull: 0, pk: 0 }),
        expect.objectContaining({
          name: "source_package_version",
          type: "TEXT",
          notnull: 0,
          pk: 0,
        }),
        expect.objectContaining({ name: "source_definition_id", type: "TEXT", notnull: 0, pk: 0 }),
        expect.objectContaining({ name: "trust", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "confidence", type: "REAL", notnull: 0, pk: 0 }),
        expect.objectContaining({ name: "created_at", type: "TEXT", notnull: 1, pk: 0 }),
      ]);
      expect(database.prepare("PRAGMA table_list").all()).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "field_claims", strict: 1 })])
      );
      expect(database.prepare("PRAGMA index_list(field_claims)").all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "field_claims_printer_state_field_path_idx", unique: 0 }),
          expect.objectContaining({
            name: "field_claims_component_installation_field_path_idx",
            unique: 0,
          }),
        ])
      );
    } finally {
      database.close();
    }
  });

  it("migrates version 3 to 4 transactionally while preserving existing hierarchy data", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS.slice(0, 3));
      seedHierarchy(database);

      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);

      expect(readSchemaVersion(database)).toBe(4);
      expect(database.prepare("SELECT id FROM workspaces").all()).toEqual([{ id: "workspace-a" }]);
      expect(database.prepare("SELECT id FROM printers").all()).toEqual([{ id: "printer-a" }]);
      expect(database.prepare("SELECT id FROM printer_states").all()).toEqual([{ id: "state-a" }]);
      expect(database.prepare("SELECT id FROM component_installations").all()).toEqual([
        { id: "installation-a" },
      ]);
    } finally {
      database.close();
    }
  });

  it("accepts exactly one valid target and enforces both foreign keys", () => {
    const database = openMigratedDatabase();
    try {
      seedHierarchy(database);
      insertClaim(database, { id: "state-claim" });
      insertClaim(database, {
        id: "installation-claim",
        printerStateId: null,
        componentInstallationId: "installation-a",
      });
      expect(database.prepare("SELECT id FROM field_claims ORDER BY id").all()).toEqual([
        { id: "installation-claim" },
        { id: "state-claim" },
      ]);

      for (const row of [
        { id: "neither", printerStateId: null, componentInstallationId: null },
        {
          id: "both",
          printerStateId: "state-a",
          componentInstallationId: "installation-a",
        },
        { id: "missing-state", printerStateId: "state-missing", componentInstallationId: null },
        {
          id: "missing-installation",
          printerStateId: null,
          componentInstallationId: "installation-missing",
        },
      ]) {
        expect(() => insertClaim(database, row)).toThrow();
      }
    } finally {
      database.close();
    }
  });

  it.each([
    { id: "string", valueType: "string", stringValue: "klipper", numberValue: null },
    { id: "number", valueType: "number", numberValue: 12.5 },
    { id: "false", valueType: "boolean", numberValue: null, booleanValue: 0 },
    { id: "true", valueType: "boolean", numberValue: null, booleanValue: 1 },
  ])("accepts typed $valueType value", (value) => {
    const database = openMigratedDatabase();
    try {
      seedHierarchy(database);
      insertClaim(database, { unit: null, ...value });
    } finally {
      database.close();
    }
  });

  it.each([
    { id: "bad-type", valueType: "json" },
    { id: "multiple", stringValue: "also populated" },
    { id: "missing-string", valueType: "string", stringValue: null, numberValue: null },
    { id: "missing-number", valueType: "number", numberValue: null },
    { id: "bad-boolean", valueType: "boolean", numberValue: null, booleanValue: 2 },
  ])("rejects malformed typed value $id", (value) => {
    const database = openMigratedDatabase();
    try {
      seedHierarchy(database);
      expect(() => insertClaim(database, { unit: null, ...value })).toThrow();
    } finally {
      database.close();
    }
  });

  it.each(["mm", "mm/s", "mm/s2", "degC", "mm3/s", "ratio", null])(
    "accepts canonical or absent unit %s",
    (unit) => {
      const database = openMigratedDatabase();
      try {
        seedHierarchy(database);
        insertClaim(database, { unit });
      } finally {
        database.close();
      }
    }
  );

  it("rejects unsupported units and units on non-numeric values", () => {
    const database = openMigratedDatabase();
    try {
      seedHierarchy(database);
      expect(() => insertClaim(database, { unit: "cm" })).toThrow();
      expect(() =>
        insertClaim(database, {
          valueType: "string",
          stringValue: "klipper",
          numberValue: null,
          unit: "mm",
        })
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it.each([null, 0, 1])("accepts confidence %s", (confidence) => {
    const database = openMigratedDatabase();
    try {
      seedHierarchy(database);
      insertClaim(database, { confidence });
    } finally {
      database.close();
    }
  });

  it.each([-0.01, 1.01])("rejects confidence %s", (confidence) => {
    const database = openMigratedDatabase();
    try {
      seedHierarchy(database);
      expect(() => insertClaim(database, { confidence })).toThrow();
    } finally {
      database.close();
    }
  });

  const provenanceCases: readonly Partial<ClaimRow>[] = [
    { id: "user-confirmed", sourceType: "user_confirmed", trust: "user_confirmed" },
    { id: "user-entered", sourceType: "user_entered", trust: "user_entered" },
    {
      id: "imported",
      sourceType: "imported_file",
      sourceReferenceId: "import-snapshot-1",
      trust: "imported_observation",
    },
    {
      id: "slicer",
      sourceType: "slicer_profile",
      sourceReferenceId: "slicer-snapshot-1",
      trust: "imported_observation",
    },
    {
      id: "firmware",
      sourceType: "firmware_read",
      sourceReferenceId: "firmware-snapshot-1",
      trust: "imported_observation",
    },
    {
      id: "package",
      sourceType: "knowledge_package",
      sourcePackageId: "base",
      sourcePackageVersion: "1.0.0",
      trust: "developer_verified",
    },
    {
      id: "definition",
      sourceType: "component_definition",
      sourcePackageId: "base",
      sourcePackageVersion: "1.0.0",
      sourceDefinitionId: "hotend-1",
      trust: "developer_verified",
    },
    {
      id: "test",
      sourceType: "test_result",
      sourceReferenceId: "test-run-1",
      trust: "imported_observation",
    },
    {
      id: "ai",
      sourceType: "ai_unverified",
      trust: "ai_generated_unverified",
    },
  ];

  it.each(provenanceCases)("accepts provenance $sourceType", (provenance) => {
    const database = openMigratedDatabase();
    try {
      seedHierarchy(database);
      insertClaim(database, provenance);
    } finally {
      database.close();
    }
  });

  it.each([
    { id: "package-incomplete", sourceType: "knowledge_package", sourcePackageId: "base" },
    {
      id: "definition-partial",
      sourceType: "component_definition",
      sourcePackageId: "base",
      sourcePackageVersion: "1.0.0",
    },
    { id: "user-with-reference", sourceType: "user_entered", sourceReferenceId: "not-allowed" },
    {
      id: "import-with-package",
      sourceType: "imported_file",
      sourceReferenceId: "import-1",
      sourcePackageId: "not-allowed",
    },
    { id: "unknown-source", sourceType: "external" },
  ])("rejects impossible provenance $id", (provenance) => {
    const database = openMigratedDatabase();
    try {
      seedHierarchy(database);
      expect(() => insertClaim(database, provenance)).toThrow();
    } finally {
      database.close();
    }
  });

  it("enforces every trust category", () => {
    const database = openMigratedDatabase();
    try {
      seedHierarchy(database);
      for (const [index, trust] of [
        "developer_verified",
        "customer_verified",
        "user_confirmed",
        "user_entered",
        "imported_observation",
        "ai_generated_unverified",
      ].entries()) {
        insertClaim(database, { id: `trust-${index}`, trust });
      }
      expect(() => insertClaim(database, { id: "bad-trust", trust: "trusted" })).toThrow();
    } finally {
      database.close();
    }
  });

  it("stores conflicting claims independently", () => {
    const database = openMigratedDatabase();
    try {
      seedHierarchy(database);
      insertClaim(database, {
        id: "package-claim",
        sourceType: "knowledge_package",
        sourcePackageId: "base",
        sourcePackageVersion: "1.0.0",
        trust: "developer_verified",
      });
      insertClaim(database, {
        id: "user-claim",
        numberValue: 0.6,
        sourceType: "user_confirmed",
        trust: "user_confirmed",
      });

      expect(
        database
          .prepare(
            "SELECT id, number_value FROM field_claims WHERE printer_state_id = ? AND field_path = ? ORDER BY id"
          )
          .all("state-a", "printer.nozzle.diameter")
      ).toEqual([
        { id: "package-claim", number_value: 0.4 },
        { id: "user-claim", number_value: 0.6 },
      ]);
    } finally {
      database.close();
    }
  });

  it("cascades claims through ComponentInstallation, PrinterState, Printer, and Workspace deletion", () => {
    const database = openMigratedDatabase();
    try {
      for (const suffix of ["installation", "state", "printer", "workspace", "unrelated"]) {
        seedHierarchy(database, suffix);
        insertClaim(database, {
          id: `direct-${suffix}`,
          printerStateId: `state-${suffix}`,
        });
        insertClaim(database, {
          id: `component-${suffix}`,
          printerStateId: null,
          componentInstallationId: `installation-${suffix}`,
        });
      }

      database
        .prepare("DELETE FROM component_installations WHERE id = ?")
        .run("installation-installation");
      database.prepare("DELETE FROM printer_states WHERE id = ?").run("state-state");
      database.prepare("DELETE FROM printers WHERE id = ?").run("printer-printer");
      database.prepare("DELETE FROM workspaces WHERE id = ?").run("workspace-workspace");

      expect(database.prepare("SELECT id FROM field_claims ORDER BY id").all()).toEqual([
        { id: "component-unrelated" },
        { id: "direct-installation" },
        { id: "direct-unrelated" },
      ]);
    } finally {
      database.close();
    }
  });

  it("persists claims across close/reopen, remains idempotent, and cleans temporary data", () => {
    const directory = mkdtempSync(join(tmpdir(), "printtune-field-claims-schema-"));
    const path = join(directory, "printtune.sqlite");
    try {
      const first = openConfiguredSqliteDatabase(path);
      runSqliteMigrations(first, PRINTTUNE_SQLITE_MIGRATIONS);
      seedHierarchy(first);
      insertClaim(first);
      first.close();

      const second = openConfiguredSqliteDatabase(path);
      try {
        runSqliteMigrations(second, PRINTTUNE_SQLITE_MIGRATIONS);
        runSqliteMigrations(second, PRINTTUNE_SQLITE_MIGRATIONS);
        expect(readSchemaVersion(second)).toBe(4);
        expect(second.prepare("SELECT id FROM field_claims").all()).toEqual([{ id: "claim-a" }]);
      } finally {
        second.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
    expect(existsSync(directory)).toBe(false);
  });
});
