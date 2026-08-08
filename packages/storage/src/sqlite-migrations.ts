import type { DatabaseSync } from "node:sqlite";

export interface SqliteMigration {
  readonly version: number;
  readonly migrate: (database: DatabaseSync) => void;
}

const migration001: SqliteMigration = {
  version: 1,
  migrate(database) {
    database.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT
    `);
  },
};

export const PRINTTUNE_SQLITE_MIGRATIONS: readonly SqliteMigration[] = Object.freeze([
  migration001,
]);

export function readSchemaVersion(database: DatabaseSync): number {
  const row = database.prepare("PRAGMA user_version").get() as
    { user_version?: unknown } | undefined;

  if (typeof row?.user_version !== "number") {
    throw new Error("Unable to read the SQLite schema version");
  }

  return row.user_version;
}

function validateMigrations(migrations: readonly SqliteMigration[]): void {
  for (const [index, migration] of migrations.entries()) {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Expected SQLite migration ${expectedVersion}, received ${migration.version}`
      );
    }
  }
}

export function runSqliteMigrations(
  database: DatabaseSync,
  migrations: readonly SqliteMigration[]
): void {
  validateMigrations(migrations);

  const currentVersion = readSchemaVersion(database);
  const latestVersion = migrations.length;

  if (currentVersion > latestVersion) {
    throw new UnsupportedSchemaVersionError(currentVersion, latestVersion);
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue;
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      migration.migrate(database);
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
    } catch (error) {
      if (database.isTransaction) {
        database.exec("ROLLBACK");
      }
      throw error;
    }
  }
}

export class UnsupportedSchemaVersionError extends Error {
  constructor(
    readonly databaseVersion: number,
    readonly supportedVersion: number
  ) {
    super(
      `SQLite schema version ${databaseVersion} is newer than supported version ${supportedVersion}`
    );
    this.name = "UnsupportedSchemaVersionError";
  }
}
