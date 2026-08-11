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

const migration006: SqliteMigration = {
  version: 6,
  migrate(database) {
    database.exec(`
      ALTER TABLE field_claims ADD COLUMN source_fact_id TEXT
        CHECK (
          source_fact_id IS NULL
          OR
          (
            source_type = 'knowledge_package'
            AND length(source_fact_id) > 0
            AND trim(source_fact_id) = source_fact_id
          )
        )
    `);
  },
};

const migration007: SqliteMigration = {
  version: 7,
  migrate(database) {
    database.exec(`
      CREATE TABLE installed_knowledge_packages (
        package_id TEXT NOT NULL
          CHECK (length(package_id) > 0 AND trim(package_id) = package_id),
        package_version TEXT NOT NULL
          CHECK (length(package_version) > 0 AND trim(package_version) = package_version),
        format_version INTEGER NOT NULL CHECK (format_version = 1),
        package_type TEXT NOT NULL CHECK (package_type = 'printer_series'),
        raw_text TEXT NOT NULL CHECK (length(raw_text) > 0),
        content_sha256 TEXT NOT NULL CHECK (
          length(content_sha256) = 64
          AND content_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        installation_source TEXT NOT NULL CHECK (
          installation_source IN ('bundled_official', 'customer_verified_installation')
        ),
        trust TEXT NOT NULL CHECK (trust IN ('developer_verified', 'customer_verified')),
        installed_at TEXT NOT NULL,
        PRIMARY KEY (package_id, package_version),
        CHECK (
          (installation_source = 'bundled_official' AND trust = 'developer_verified')
          OR
          (
            installation_source = 'customer_verified_installation'
            AND trust = 'customer_verified'
          )
        )
      ) STRICT
    `);
  },
};

const migration008: SqliteMigration = {
  version: 8,
  migrate(database) {
    database.exec(`
      CREATE UNIQUE INDEX printer_states_printer_id_id_unique_idx
        ON printer_states(printer_id, id);

      CREATE TABLE package_applications (
        id TEXT PRIMARY KEY CHECK (length(id) > 0 AND trim(id) = id),
        printer_id TEXT NOT NULL CHECK (length(printer_id) > 0 AND trim(printer_id) = printer_id),
        printer_state_id TEXT NOT NULL
          CHECK (length(printer_state_id) > 0 AND trim(printer_state_id) = printer_state_id),
        printer_knowledge_identity_id TEXT NOT NULL
          CHECK (
            length(printer_knowledge_identity_id) > 0
            AND trim(printer_knowledge_identity_id) = printer_knowledge_identity_id
          ),
        package_id TEXT NOT NULL
          CHECK (length(package_id) > 0 AND trim(package_id) = package_id),
        package_version TEXT NOT NULL
          CHECK (length(package_version) > 0 AND trim(package_version) = package_version),
        series_definition_id TEXT NOT NULL
          CHECK (length(series_definition_id) > 0 AND trim(series_definition_id) = series_definition_id),
        model_definition_id TEXT
          CHECK (
            model_definition_id IS NULL
            OR (length(model_definition_id) > 0 AND trim(model_definition_id) = model_definition_id)
          ),
        core_contract_version TEXT NOT NULL
          CHECK (length(core_contract_version) > 0 AND trim(core_contract_version) = core_contract_version),
        package_trust TEXT NOT NULL
          CHECK (package_trust IN ('developer_verified', 'customer_verified')),
        applied_at TEXT NOT NULL,
        FOREIGN KEY (printer_id) REFERENCES printers(id),
        FOREIGN KEY (printer_id, printer_state_id)
          REFERENCES printer_states(printer_id, id),
        FOREIGN KEY (printer_id, printer_knowledge_identity_id)
          REFERENCES printer_knowledge_identities(printer_id, id)
      ) STRICT;

      CREATE UNIQUE INDEX package_applications_series_once_idx
        ON package_applications(
          printer_state_id, package_id, package_version, series_definition_id,
          core_contract_version
        ) WHERE model_definition_id IS NULL;

      CREATE UNIQUE INDEX package_applications_model_once_idx
        ON package_applications(
          printer_state_id, package_id, package_version, series_definition_id,
          model_definition_id, core_contract_version
        ) WHERE model_definition_id IS NOT NULL;

      CREATE INDEX package_applications_printer_state_history_idx
        ON package_applications(printer_state_id, applied_at, id);

      CREATE TABLE package_application_claims (
        application_id TEXT NOT NULL,
        claim_id TEXT NOT NULL,
        claim_order INTEGER NOT NULL CHECK (claim_order >= 0),
        PRIMARY KEY (application_id, claim_id),
        UNIQUE (claim_id),
        UNIQUE (application_id, claim_order),
        FOREIGN KEY (application_id) REFERENCES package_applications(id),
        FOREIGN KEY (claim_id) REFERENCES field_claims(id)
      ) STRICT;
    `);
  },
};

export class AmbiguousLegacyPrinterStateError extends Error {
  override readonly name = "AmbiguousLegacyPrinterStateError";

  constructor(
    readonly printerId: string,
    readonly stateCount: number
  ) {
    super(
      `Cannot establish working PrinterState for legacy Printer ${printerId}: expected exactly one State, found ${stateCount}`
    );
  }
}

const migration009: SqliteMigration = {
  version: 9,
  migrate(database) {
    const invalid = database
      .prepare(
        `SELECT p.id AS printer_id, count(ps.id) AS state_count
         FROM printers p
         LEFT JOIN printer_states ps ON ps.printer_id = p.id
         GROUP BY p.id
         HAVING count(ps.id) != 1
         ORDER BY p.id
         LIMIT 1`
      )
      .get() as { printer_id?: unknown; state_count?: unknown } | undefined;
    if (invalid !== undefined) {
      if (typeof invalid.printer_id !== "string" || typeof invalid.state_count !== "number") {
        throw new Error("Unable to validate legacy PrinterState counts");
      }
      throw new AmbiguousLegacyPrinterStateError(invalid.printer_id, invalid.state_count);
    }

    database.exec(`
      CREATE TABLE printer_state_lineage (
        printer_id TEXT NOT NULL
          CHECK (length(printer_id) > 0 AND trim(printer_id) = printer_id),
        child_printer_state_id TEXT PRIMARY KEY
          CHECK (
            length(child_printer_state_id) > 0
            AND trim(child_printer_state_id) = child_printer_state_id
          ),
        parent_printer_state_id TEXT NOT NULL
          CHECK (
            length(parent_printer_state_id) > 0
            AND trim(parent_printer_state_id) = parent_printer_state_id
          ),
        CHECK (child_printer_state_id != parent_printer_state_id),
        FOREIGN KEY (printer_id, child_printer_state_id)
          REFERENCES printer_states(printer_id, id) ON DELETE CASCADE,
        FOREIGN KEY (printer_id, parent_printer_state_id)
          REFERENCES printer_states(printer_id, id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE printer_state_selections (
        printer_id TEXT PRIMARY KEY
          CHECK (length(printer_id) > 0 AND trim(printer_id) = printer_id),
        printer_state_id TEXT NOT NULL
          CHECK (length(printer_state_id) > 0 AND trim(printer_state_id) = printer_state_id),
        FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE CASCADE,
        FOREIGN KEY (printer_id, printer_state_id)
          REFERENCES printer_states(printer_id, id) ON DELETE CASCADE
      ) STRICT;

      INSERT INTO printer_state_selections (printer_id, printer_state_id)
      SELECT p.id, ps.id
      FROM printers p
      JOIN printer_states ps ON ps.printer_id = p.id;
    `);
  },
};

const migration010: SqliteMigration = {
  version: 10,
  migrate(database) {
    database.exec(`
      CREATE UNIQUE INDEX printer_state_lineage_command_fk_idx
        ON printer_state_lineage(printer_id, child_printer_state_id, parent_printer_state_id);

      CREATE TABLE printer_state_transition_commands (
        command_id TEXT PRIMARY KEY CHECK (length(command_id) > 0 AND trim(command_id) = command_id),
        printer_id TEXT NOT NULL CHECK (length(printer_id) > 0 AND trim(printer_id) = printer_id),
        source_printer_state_id TEXT NOT NULL
          CHECK (length(source_printer_state_id) > 0 AND trim(source_printer_state_id) = source_printer_state_id),
        target_printer_state_id TEXT NOT NULL UNIQUE
          CHECK (length(target_printer_state_id) > 0 AND trim(target_printer_state_id) = target_printer_state_id),
        FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE CASCADE,
        FOREIGN KEY (printer_id, target_printer_state_id, source_printer_state_id)
          REFERENCES printer_state_lineage(
            printer_id, child_printer_state_id, parent_printer_state_id
          ) ON DELETE CASCADE
      ) STRICT;

      CREATE TEMP TABLE package_application_claims_v10_backup AS
        SELECT application_id, claim_id, claim_order FROM package_application_claims;
      DROP TABLE package_application_claims;

      CREATE TABLE field_claims_v10 (
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
            'user_confirmed', 'user_entered', 'imported_file', 'slicer_profile',
            'firmware_read', 'knowledge_package', 'component_definition', 'test_result',
            'ai_unverified', 'state_transition'
          )
        ),
        source_reference_id TEXT,
        source_package_id TEXT,
        source_package_version TEXT,
        source_definition_id TEXT,
        trust TEXT NOT NULL CHECK (
          trust IN (
            'developer_verified', 'customer_verified', 'user_confirmed', 'user_entered',
            'imported_observation', 'ai_generated_unverified'
          )
        ),
        confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
        created_at TEXT NOT NULL,
        source_fact_id TEXT CHECK (
          source_fact_id IS NULL OR (length(source_fact_id) > 0 AND trim(source_fact_id) = source_fact_id)
        ),
        source_claim_id TEXT CHECK (
          source_claim_id IS NULL OR (length(source_claim_id) > 0 AND trim(source_claim_id) = source_claim_id)
        ),
        transition_command_id TEXT CHECK (
          transition_command_id IS NULL OR (length(transition_command_id) > 0 AND trim(transition_command_id) = transition_command_id)
        ),
        FOREIGN KEY (printer_state_id) REFERENCES printer_states(id) ON DELETE CASCADE,
        FOREIGN KEY (component_installation_id)
          REFERENCES component_installations(id) ON DELETE CASCADE,
        FOREIGN KEY (source_claim_id) REFERENCES field_claims_v10(id),
        FOREIGN KEY (transition_command_id)
          REFERENCES printer_state_transition_commands(command_id),
        CHECK (
          (printer_state_id IS NOT NULL AND component_installation_id IS NULL)
          OR (printer_state_id IS NULL AND component_installation_id IS NOT NULL)
        ),
        CHECK (
          (value_type = 'string' AND string_value IS NOT NULL AND number_value IS NULL AND boolean_value IS NULL)
          OR (value_type = 'number' AND string_value IS NULL AND number_value IS NOT NULL
              AND number_value >= -1.7976931348623157e308
              AND number_value <= 1.7976931348623157e308 AND boolean_value IS NULL)
          OR (value_type = 'boolean' AND string_value IS NULL AND number_value IS NULL
              AND boolean_value IN (0, 1))
        ),
        CHECK (unit IS NULL OR value_type = 'number'),
        CHECK (
          (source_type IN ('user_confirmed', 'user_entered', 'ai_unverified')
            AND source_reference_id IS NULL AND source_package_id IS NULL
            AND source_package_version IS NULL AND source_definition_id IS NULL
            AND source_fact_id IS NULL AND source_claim_id IS NULL AND transition_command_id IS NULL)
          OR (source_type IN ('imported_file', 'slicer_profile', 'firmware_read', 'test_result')
            AND source_reference_id IS NOT NULL AND source_package_id IS NULL
            AND source_package_version IS NULL AND source_definition_id IS NULL
            AND source_fact_id IS NULL AND source_claim_id IS NULL AND transition_command_id IS NULL)
          OR (source_type = 'knowledge_package' AND source_reference_id IS NULL
            AND source_package_id IS NOT NULL AND source_package_version IS NOT NULL
            AND source_definition_id IS NULL AND source_claim_id IS NULL AND transition_command_id IS NULL)
          OR (source_type = 'component_definition' AND source_reference_id IS NULL
            AND source_package_id IS NOT NULL AND source_package_version IS NOT NULL
            AND source_definition_id IS NOT NULL AND source_fact_id IS NULL
            AND source_claim_id IS NULL AND transition_command_id IS NULL)
          OR (source_type = 'state_transition' AND source_reference_id IS NULL
            AND source_package_id IS NULL AND source_package_version IS NULL
            AND source_definition_id IS NULL AND source_fact_id IS NULL
            AND source_claim_id IS NOT NULL AND transition_command_id IS NOT NULL)
        )
      ) STRICT;

      INSERT INTO field_claims_v10 (
        id, printer_state_id, component_installation_id, field_path, value_type,
        string_value, number_value, boolean_value, unit, source_type, source_reference_id,
        source_package_id, source_package_version, source_definition_id, trust, confidence,
        created_at, source_fact_id, source_claim_id, transition_command_id
      )
      SELECT id, printer_state_id, component_installation_id, field_path, value_type,
        string_value, number_value, boolean_value, unit, source_type, source_reference_id,
        source_package_id, source_package_version, source_definition_id, trust, confidence,
        created_at, source_fact_id, NULL, NULL
      FROM field_claims;

      DROP TABLE field_claims;
      ALTER TABLE field_claims_v10 RENAME TO field_claims;

      CREATE INDEX field_claims_printer_state_field_path_idx
        ON field_claims(printer_state_id, field_path);
      CREATE INDEX field_claims_component_installation_field_path_idx
        ON field_claims(component_installation_id, field_path);

      CREATE TABLE package_application_claims (
        application_id TEXT NOT NULL,
        claim_id TEXT NOT NULL,
        claim_order INTEGER NOT NULL CHECK (claim_order >= 0),
        PRIMARY KEY (application_id, claim_id),
        UNIQUE (claim_id),
        UNIQUE (application_id, claim_order),
        FOREIGN KEY (application_id) REFERENCES package_applications(id),
        FOREIGN KEY (claim_id) REFERENCES field_claims(id)
      ) STRICT;
      INSERT INTO package_application_claims (application_id, claim_id, claim_order)
        SELECT application_id, claim_id, claim_order
        FROM package_application_claims_v10_backup ORDER BY application_id, claim_order;
      DROP TABLE package_application_claims_v10_backup;
    `);
  },
};

export const PRINTTUNE_SQLITE_MIGRATIONS: readonly SqliteMigration[] = Object.freeze([
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
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
