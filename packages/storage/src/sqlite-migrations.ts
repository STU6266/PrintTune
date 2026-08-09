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

const migration002: SqliteMigration = {
  version: 2,
  migrate(database) {
    database.exec(`
      CREATE TABLE printers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX printers_workspace_id_idx ON printers(workspace_id);

      CREATE TABLE printer_states (
        id TEXT PRIMARY KEY,
        printer_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX printer_states_printer_id_idx ON printer_states(printer_id);
    `);
  },
};

const migration003: SqliteMigration = {
  version: 3,
  migrate(database) {
    database.exec(`
      CREATE TABLE component_installations (
        id TEXT PRIMARY KEY,
        printer_state_id TEXT NOT NULL,
        component_instance_id TEXT NOT NULL,
        role TEXT NOT NULL,
        kind TEXT NOT NULL,
        display_name TEXT NOT NULL,
        definition_package_id TEXT,
        definition_package_version TEXT,
        definition_id TEXT,
        FOREIGN KEY (printer_state_id) REFERENCES printer_states(id) ON DELETE CASCADE,
        UNIQUE (printer_state_id, role),
        CHECK (
          (
            definition_package_id IS NULL
            AND definition_package_version IS NULL
            AND definition_id IS NULL
          )
          OR
          (
            definition_package_id IS NOT NULL
            AND definition_package_version IS NOT NULL
            AND definition_id IS NOT NULL
          )
        )
      ) STRICT;

      CREATE INDEX component_installations_component_instance_id_idx
        ON component_installations(component_instance_id);
    `);
  },
};

export const PRINTTUNE_SQLITE_MIGRATIONS: readonly SqliteMigration[] = Object.freeze([
  migration001,
  migration002,
  migration003,
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
