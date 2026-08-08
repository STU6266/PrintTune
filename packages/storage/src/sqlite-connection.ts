import { DatabaseSync } from "node:sqlite";

export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

function readNumber(database: DatabaseSync, sql: string, column: string): number {
  const row = database.prepare(sql).get() as Record<string, unknown> | undefined;
  const value = row?.[column];

  if (typeof value !== "number") {
    throw new Error(`Expected numeric SQLite value for ${column}`);
  }

  return value;
}

export function openConfiguredSqliteDatabase(path: string): DatabaseSync {
  if (path.trim().length === 0) {
    throw new Error("A SQLite database path is required");
  }

  const database = new DatabaseSync(path, {
    allowExtension: false,
    defensive: true,
    enableForeignKeyConstraints: true,
  });

  try {
    database.enableDefensive(true);
    database.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);

    if (path !== ":memory:") {
      database.exec("PRAGMA journal_mode = WAL");
    }

    if (readNumber(database, "PRAGMA foreign_keys", "foreign_keys") !== 1) {
      throw new Error("SQLite foreign-key enforcement could not be enabled");
    }

    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
