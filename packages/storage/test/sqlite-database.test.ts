import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { openPrintTuneDatabase } from "../src/printtune-database";
import {
  PRINTTUNE_SQLITE_MIGRATIONS,
  UnsupportedSchemaVersionError,
  readSchemaVersion,
  runSqliteMigrations,
  type SqliteMigration,
} from "../src/sqlite-migrations";
import { SQLITE_BUSY_TIMEOUT_MS, openConfiguredSqliteDatabase } from "../src/sqlite-connection";

const temporaryDirectories: string[] = [];

function createTemporaryDatabasePath(): { directory: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), "printtune-storage-"));
  temporaryDirectories.push(directory);
  return { directory, path: join(directory, "printtune.sqlite") };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("PrintTune SQLite database", () => {
  it("opens a new database with explicit lifecycle", () => {
    const database = openPrintTuneDatabase(":memory:");

    expect(database.schemaVersion()).toBe(0);
    database.close();
  });

  it("applies all migrations and records schema version 3", () => {
    const { path } = createTemporaryDatabasePath();
    const database = openPrintTuneDatabase(path);
    database.migrate();

    expect(database.schemaVersion()).toBe(3);
    database.close();

    const inspectionDatabase = new DatabaseSync(path);
    try {
      const columns = inspectionDatabase.prepare("PRAGMA table_info(workspaces)").all();
      expect(columns).toEqual([
        expect.objectContaining({ name: "id", type: "TEXT", notnull: 1, pk: 1 }),
        expect.objectContaining({ name: "name", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "created_at", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "updated_at", type: "TEXT", notnull: 1, pk: 0 }),
      ]);
      expect(readSchemaVersion(inspectionDatabase)).toBe(3);
    } finally {
      inspectionDatabase.close();
    }
  });

  it("is idempotent when an up-to-date database is migrated again", () => {
    const database = openPrintTuneDatabase(":memory:");

    database.migrate();
    database.migrate();

    expect(database.schemaVersion()).toBe(3);
    database.close();
  });

  it("enables foreign keys, disables extensions, configures timeout and uses WAL for files", () => {
    const { path } = createTemporaryDatabasePath();
    const database = openConfiguredSqliteDatabase(path);

    try {
      expect(database.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(database.prepare("PRAGMA busy_timeout").get()).toEqual({
        timeout: SQLITE_BUSY_TIMEOUT_MS,
      });
      expect(database.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
      expect(() => database.enableLoadExtension(true)).toThrow();
      expect(() => database.enableDefensive(true)).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("creates the workspaces table in STRICT mode", () => {
    const database = openConfiguredSqliteDatabase(":memory:");

    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);
      expect(() =>
        database
          .prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
          .run(
            new Uint8Array([1]),
            "Workspace",
            "2026-08-08T00:00:00.000Z",
            "2026-08-08T00:00:00.000Z"
          )
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("rolls back a failed migration", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    const failingMigrations: readonly SqliteMigration[] = [
      {
        version: 1,
        migrate(databaseConnection) {
          databaseConnection.exec("CREATE TABLE should_rollback (id INTEGER) STRICT");
          throw new Error("migration failure");
        },
      },
    ];

    try {
      expect(() => runSqliteMigrations(database, failingMigrations)).toThrow("migration failure");
      expect(readSchemaVersion(database)).toBe(0);
      expect(
        database
          .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?")
          .get("should_rollback")
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("rejects a schema version newer than the application supports", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    database.exec("PRAGMA user_version = 4");

    try {
      expect(() => runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS)).toThrow(
        UnsupportedSchemaVersionError
      );
      expect(readSchemaVersion(database)).toBe(4);
    } finally {
      database.close();
    }
  });

  it("preserves the migrated schema after a file-backed database is reopened", () => {
    const { directory, path } = createTemporaryDatabasePath();
    const firstConnection = openPrintTuneDatabase(path);
    firstConnection.migrate();
    firstConnection.close();

    const secondConnection = openPrintTuneDatabase(path);
    try {
      expect(secondConnection.schemaVersion()).toBe(3);
      secondConnection.migrate();
    } finally {
      secondConnection.close();
    }

    rmSync(directory, { force: true, recursive: true });
    expect(existsSync(directory)).toBe(false);
    temporaryDirectories.splice(temporaryDirectories.indexOf(directory), 1);
  });

  it("migrates an existing version-1 database while preserving Workspace rows", () => {
    const database = openConfiguredSqliteDatabase(":memory:");

    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS.slice(0, 1));
      database
        .prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .run(
          "workspace-existing",
          "Bestehend",
          "2026-08-08T10:00:00.000Z",
          "2026-08-08T10:00:00.000Z"
        );

      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);

      expect(readSchemaVersion(database)).toBe(3);
      expect(
        database.prepare("SELECT name FROM workspaces WHERE id = ?").get("workspace-existing")
      ).toEqual({ name: "Bestehend" });
    } finally {
      database.close();
    }
  });

  it("creates the exact STRICT Printer and PrinterState schemas", () => {
    const database = openConfiguredSqliteDatabase(":memory:");

    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);

      expect(database.prepare("PRAGMA table_info(printers)").all()).toEqual([
        expect.objectContaining({ name: "id", type: "TEXT", notnull: 1, pk: 1 }),
        expect.objectContaining({ name: "workspace_id", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "name", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "created_at", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "updated_at", type: "TEXT", notnull: 1, pk: 0 }),
      ]);
      expect(database.prepare("PRAGMA table_info(printer_states)").all()).toEqual([
        expect.objectContaining({ name: "id", type: "TEXT", notnull: 1, pk: 1 }),
        expect.objectContaining({ name: "printer_id", type: "TEXT", notnull: 1, pk: 0 }),
        expect.objectContaining({ name: "created_at", type: "TEXT", notnull: 1, pk: 0 }),
      ]);
      expect(database.prepare("PRAGMA table_list").all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "printers", strict: 1 }),
          expect.objectContaining({ name: "printer_states", strict: 1 }),
        ])
      );
      expect(database.prepare("PRAGMA index_list(printers)").all()).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "printers_workspace_id_idx" })])
      );
      expect(database.prepare("PRAGMA index_list(printer_states)").all()).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "printer_states_printer_id_idx" })])
      );
    } finally {
      database.close();
    }
  });

  it("enforces the Printer and PrinterState foreign keys", () => {
    const database = openConfiguredSqliteDatabase(":memory:");

    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);

      expect(() =>
        database
          .prepare(
            "INSERT INTO printers (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
          )
          .run(
            "printer-orphan",
            "workspace-missing",
            "Verwaist",
            "2026-08-08T10:00:00.000Z",
            "2026-08-08T10:00:00.000Z"
          )
      ).toThrow();
      expect(() =>
        database
          .prepare("INSERT INTO printer_states (id, printer_id, created_at) VALUES (?, ?, ?)")
          .run("state-orphan", "printer-missing", "2026-08-08T10:00:00.000Z")
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("cascades Workspace deletion without affecting unrelated data", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    const timestamp = "2026-08-08T10:00:00.000Z";

    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);
      const insertWorkspace = database.prepare(
        "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
      );
      const insertPrinter = database.prepare(
        "INSERT INTO printers (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      );
      const insertState = database.prepare(
        "INSERT INTO printer_states (id, printer_id, created_at) VALUES (?, ?, ?)"
      );

      insertWorkspace.run("workspace-a", "A", timestamp, timestamp);
      insertWorkspace.run("workspace-b", "B", timestamp, timestamp);
      insertPrinter.run("printer-a", "workspace-a", "A", timestamp, timestamp);
      insertPrinter.run("printer-b", "workspace-b", "B", timestamp, timestamp);
      insertState.run("state-a", "printer-a", timestamp);
      insertState.run("state-b", "printer-b", timestamp);

      database.prepare("DELETE FROM workspaces WHERE id = ?").run("workspace-a");

      expect(database.prepare("SELECT id FROM printers ORDER BY id").all()).toEqual([
        { id: "printer-b" },
      ]);
      expect(database.prepare("SELECT id FROM printer_states ORDER BY id").all()).toEqual([
        { id: "state-b" },
      ]);
      expect(database.prepare("SELECT id FROM workspaces ORDER BY id").all()).toEqual([
        { id: "workspace-b" },
      ]);
    } finally {
      database.close();
    }
  });

  it("cascades Printer deletion to its states", () => {
    const database = openConfiguredSqliteDatabase(":memory:");
    const timestamp = "2026-08-08T10:00:00.000Z";

    try {
      runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS);
      database
        .prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .run("workspace-a", "A", timestamp, timestamp);
      database
        .prepare(
          "INSERT INTO printers (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        )
        .run("printer-a", "workspace-a", "A", timestamp, timestamp);
      database
        .prepare("INSERT INTO printer_states (id, printer_id, created_at) VALUES (?, ?, ?)")
        .run("state-a", "printer-a", timestamp);

      database.prepare("DELETE FROM printers WHERE id = ?").run("printer-a");

      expect(database.prepare("SELECT id FROM printer_states").all()).toEqual([]);
      expect(database.prepare("SELECT id FROM workspaces").all()).toEqual([{ id: "workspace-a" }]);
    } finally {
      database.close();
    }
  });

  it("preserves the current schema and existing data across reopen and remains idempotent", () => {
    const { path } = createTemporaryDatabasePath();
    const timestamp = "2026-08-08T10:00:00.000Z";
    const firstDatabase = openConfiguredSqliteDatabase(path);

    runSqliteMigrations(firstDatabase, PRINTTUNE_SQLITE_MIGRATIONS);
    firstDatabase
      .prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run("workspace-a", "A", timestamp, timestamp);
    firstDatabase
      .prepare(
        "INSERT INTO printers (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run("printer-a", "workspace-a", "A", timestamp, timestamp);
    firstDatabase
      .prepare("INSERT INTO printer_states (id, printer_id, created_at) VALUES (?, ?, ?)")
      .run("state-a", "printer-a", timestamp);
    firstDatabase.close();

    const secondDatabase = openConfiguredSqliteDatabase(path);
    try {
      runSqliteMigrations(secondDatabase, PRINTTUNE_SQLITE_MIGRATIONS);
      runSqliteMigrations(secondDatabase, PRINTTUNE_SQLITE_MIGRATIONS);

      expect(readSchemaVersion(secondDatabase)).toBe(3);
      expect(secondDatabase.prepare("SELECT id FROM printers").all()).toEqual([
        { id: "printer-a" },
      ]);
      expect(secondDatabase.prepare("SELECT id FROM printer_states").all()).toEqual([
        { id: "state-a" },
      ]);
    } finally {
      secondDatabase.close();
    }
  });
});
