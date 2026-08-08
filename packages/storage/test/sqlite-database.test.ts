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

  it("applies migration 001 and records its schema version", () => {
    const { path } = createTemporaryDatabasePath();
    const database = openPrintTuneDatabase(path);
    database.migrate();

    expect(database.schemaVersion()).toBe(1);
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
      expect(readSchemaVersion(inspectionDatabase)).toBe(1);
    } finally {
      inspectionDatabase.close();
    }
  });

  it("is idempotent when an up-to-date database is migrated again", () => {
    const database = openPrintTuneDatabase(":memory:");

    database.migrate();
    database.migrate();

    expect(database.schemaVersion()).toBe(1);
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
    database.exec("PRAGMA user_version = 2");

    try {
      expect(() => runSqliteMigrations(database, PRINTTUNE_SQLITE_MIGRATIONS)).toThrow(
        UnsupportedSchemaVersionError
      );
      expect(readSchemaVersion(database)).toBe(2);
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
      expect(secondConnection.schemaVersion()).toBe(1);
      secondConnection.migrate();
    } finally {
      secondConnection.close();
    }

    rmSync(directory, { force: true, recursive: true });
    expect(existsSync(directory)).toBe(false);
    temporaryDirectories.splice(temporaryDirectories.indexOf(directory), 1);
  });
});
