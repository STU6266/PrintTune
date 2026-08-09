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

const migration004: SqliteMigration = {
  version: 4,
  migrate(database) {
    database.exec(`
      CREATE TABLE field_claims (
        id TEXT PRIMARY KEY,
        printer_state_id TEXT,
        component_installation_id TEXT,
        field_path TEXT NOT NULL,
        value_type TEXT NOT NULL CHECK (value_type IN ('string', 'number', 'boolean')),
        string_value TEXT,
        number_value REAL,
        boolean_value INTEGER,
        unit TEXT CHECK (unit IN ('mm', 'mm/s', 'mm/s2', 'degC', 'mm3/s', 'ratio')),
        source_type TEXT NOT NULL CHECK (
          source_type IN (
            'user_confirmed',
            'user_entered',
            'imported_file',
            'slicer_profile',
            'firmware_read',
            'knowledge_package',
            'component_definition',
            'test_result',
            'ai_unverified'
          )
        ),
        source_reference_id TEXT,
        source_package_id TEXT,
        source_package_version TEXT,
        source_definition_id TEXT,
        trust TEXT NOT NULL CHECK (
          trust IN (
            'developer_verified',
            'customer_verified',
            'user_confirmed',
            'user_entered',
            'imported_observation',
            'ai_generated_unverified'
          )
        ),
        confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
        created_at TEXT NOT NULL,
        FOREIGN KEY (printer_state_id) REFERENCES printer_states(id) ON DELETE CASCADE,
        FOREIGN KEY (component_installation_id)
          REFERENCES component_installations(id) ON DELETE CASCADE,
        CHECK (
          (printer_state_id IS NOT NULL AND component_installation_id IS NULL)
          OR
          (printer_state_id IS NULL AND component_installation_id IS NOT NULL)
        ),
        CHECK (
          (
            value_type = 'string'
            AND string_value IS NOT NULL
            AND number_value IS NULL
            AND boolean_value IS NULL
          )
          OR
          (
            value_type = 'number'
            AND string_value IS NULL
            AND number_value IS NOT NULL
            AND number_value >= -1.7976931348623157e308
            AND number_value <= 1.7976931348623157e308
            AND boolean_value IS NULL
          )
          OR
          (
            value_type = 'boolean'
            AND string_value IS NULL
            AND number_value IS NULL
            AND boolean_value IN (0, 1)
          )
        ),
        CHECK (unit IS NULL OR value_type = 'number'),
        CHECK (
          (
            source_type IN ('user_confirmed', 'user_entered', 'ai_unverified')
            AND source_reference_id IS NULL
            AND source_package_id IS NULL
            AND source_package_version IS NULL
            AND source_definition_id IS NULL
          )
          OR
          (
            source_type IN ('imported_file', 'slicer_profile', 'firmware_read', 'test_result')
            AND source_reference_id IS NOT NULL
            AND source_package_id IS NULL
            AND source_package_version IS NULL
            AND source_definition_id IS NULL
          )
          OR
          (
            source_type = 'knowledge_package'
            AND source_reference_id IS NULL
            AND source_package_id IS NOT NULL
            AND source_package_version IS NOT NULL
            AND source_definition_id IS NULL
          )
          OR
          (
            source_type = 'component_definition'
            AND source_reference_id IS NULL
            AND source_package_id IS NOT NULL
            AND source_package_version IS NOT NULL
            AND source_definition_id IS NOT NULL
          )
        )
      ) STRICT;

      CREATE INDEX field_claims_printer_state_field_path_idx
        ON field_claims(printer_state_id, field_path);

      CREATE INDEX field_claims_component_installation_field_path_idx
        ON field_claims(component_installation_id, field_path);
    `);
  },
};

const migration005: SqliteMigration = {
  version: 5,
  migrate(database) {
    database.exec(`
      CREATE TABLE printer_knowledge_identities (
        id TEXT PRIMARY KEY,
        printer_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('known', 'unclassified')),
        selected_at TEXT NOT NULL,
        definition_package_id TEXT,
        definition_package_version TEXT,
        series_definition_id TEXT,
        model_definition_id TEXT,
        manufacturer_display_name TEXT,
        series_display_name TEXT,
        model_display_name TEXT,
        FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE CASCADE,
        UNIQUE (printer_id, id),
        CHECK (
          (
            kind = 'known'
            AND definition_package_id IS NOT NULL
            AND length(trim(definition_package_id)) > 0
            AND definition_package_version IS NOT NULL
            AND length(trim(definition_package_version)) > 0
            AND series_definition_id IS NOT NULL
            AND length(trim(series_definition_id)) > 0
            AND manufacturer_display_name IS NOT NULL
            AND length(trim(manufacturer_display_name)) > 0
            AND series_display_name IS NOT NULL
            AND length(trim(series_display_name)) > 0
            AND (
              (model_definition_id IS NULL AND model_display_name IS NULL)
              OR
              (
                model_definition_id IS NOT NULL
                AND length(trim(model_definition_id)) > 0
                AND model_display_name IS NOT NULL
                AND length(trim(model_display_name)) > 0
              )
            )
          )
          OR
          (
            kind = 'unclassified'
            AND definition_package_id IS NULL
            AND definition_package_version IS NULL
            AND series_definition_id IS NULL
            AND model_definition_id IS NULL
            AND manufacturer_display_name IS NULL
            AND series_display_name IS NULL
            AND model_display_name IS NULL
          )
        )
      ) STRICT;

      CREATE INDEX printer_knowledge_identities_printer_history_idx
        ON printer_knowledge_identities(printer_id, selected_at, id);

      CREATE TABLE printer_knowledge_identity_selections (
        printer_id TEXT PRIMARY KEY,
        identity_id TEXT NOT NULL,
        FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE CASCADE,
        FOREIGN KEY (printer_id, identity_id)
          REFERENCES printer_knowledge_identities(printer_id, id) ON DELETE CASCADE
      ) STRICT;
    `);
  },
};

export const PRINTTUNE_SQLITE_MIGRATIONS: readonly SqliteMigration[] = Object.freeze([
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
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
