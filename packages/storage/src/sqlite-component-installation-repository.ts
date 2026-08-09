import type { ComponentDefinitionReference, ComponentInstallation } from "@printtune/contracts";

import {
  DuplicateComponentInstallationError,
  DuplicateComponentRoleError,
  type ComponentInstallationRepository,
} from "./component-installation-repository.js";

type SqliteValue = string | null;

interface ComponentInstallationSqliteStatement {
  run(...values: SqliteValue[]): { readonly changes: number | bigint };
  get(...values: string[]): unknown;
  all(...values: string[]): unknown[];
}

interface ComponentInstallationSqliteConnection {
  prepare(sql: string): ComponentInstallationSqliteStatement;
}

export class ComponentInstallationDataIntegrityError extends Error {
  override readonly name = "ComponentInstallationDataIntegrityError";

  constructor(
    readonly field: string,
    reason: string
  ) {
    super(`Invalid persisted ComponentInstallation field "${field}": ${reason}`);
  }
}

const DOTTED_IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

function readString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new ComponentInstallationDataIntegrityError(field, "expected a string");
  }
  return value;
}

function validateId(value: string, field: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new ComponentInstallationDataIntegrityError(field, "expected a non-empty, trimmed ID");
  }
  return value;
}

function validateDottedIdentifier(value: string, field: string): string {
  if (!DOTTED_IDENTIFIER_PATTERN.test(value)) {
    throw new ComponentInstallationDataIntegrityError(
      field,
      "expected a normalized dotted identifier"
    );
  }
  return value;
}

function validateDisplayName(value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new ComponentInstallationDataIntegrityError(
      "display_name",
      "expected a non-empty, normalized display name"
    );
  }
  return value;
}

function parseDefinitionReference(
  row: Record<string, unknown>
): ComponentDefinitionReference | undefined {
  const packageId = row.definition_package_id;
  const packageVersion = row.definition_package_version;
  const definitionId = row.definition_id;

  if (packageId === null && packageVersion === null && definitionId === null) {
    return undefined;
  }
  if (
    typeof packageId !== "string" ||
    typeof packageVersion !== "string" ||
    typeof definitionId !== "string"
  ) {
    throw new ComponentInstallationDataIntegrityError(
      "definition_ref",
      "expected all provenance fields or none"
    );
  }

  return Object.freeze({
    packageId: validateId(packageId, "definition_package_id"),
    packageVersion: validateId(packageVersion, "definition_package_version"),
    definitionId: validateId(definitionId, "definition_id"),
  });
}

export function parseComponentInstallationRow(value: unknown): ComponentInstallation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ComponentInstallationDataIntegrityError("row", "expected a SQLite row object");
  }
  const row = value as Record<string, unknown>;
  const installation = {
    id: validateId(readString(row, "id"), "id"),
    printerStateId: validateId(readString(row, "printer_state_id"), "printer_state_id"),
    componentInstanceId: validateId(
      readString(row, "component_instance_id"),
      "component_instance_id"
    ),
    role: validateDottedIdentifier(readString(row, "role"), "role"),
    kind: validateDottedIdentifier(readString(row, "kind"), "kind"),
    displayName: validateDisplayName(readString(row, "display_name")),
  };
  const definitionRef = parseDefinitionReference(row);

  return Object.freeze(
    definitionRef === undefined ? installation : { ...installation, definitionRef }
  );
}

export class SqliteComponentInstallationRepository implements ComponentInstallationRepository {
  readonly #create: ComponentInstallationSqliteStatement;
  readonly #findById: ComponentInstallationSqliteStatement;
  readonly #findByRole: ComponentInstallationSqliteStatement;
  readonly #listByState: ComponentInstallationSqliteStatement;
  readonly #listByInstance: ComponentInstallationSqliteStatement;

  constructor(database: ComponentInstallationSqliteConnection) {
    this.#create = database.prepare(`
      INSERT INTO component_installations (
        id, printer_state_id, component_instance_id, role, kind, display_name,
        definition_package_id, definition_package_version, definition_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#findById = database.prepare(`
      SELECT id, printer_state_id, component_instance_id, role, kind, display_name,
             definition_package_id, definition_package_version, definition_id
      FROM component_installations WHERE id = ?
    `);
    this.#findByRole = database.prepare(`
      SELECT id FROM component_installations WHERE printer_state_id = ? AND role = ?
    `);
    this.#listByState = database.prepare(`
      SELECT id, printer_state_id, component_instance_id, role, kind, display_name,
             definition_package_id, definition_package_version, definition_id
      FROM component_installations
      WHERE printer_state_id = ?
      ORDER BY role, id
    `);
    this.#listByInstance = database.prepare(`
      SELECT ci.id, ci.printer_state_id, ci.component_instance_id, ci.role, ci.kind,
             ci.display_name, ci.definition_package_id, ci.definition_package_version,
             ci.definition_id
      FROM component_installations AS ci
      INNER JOIN printer_states AS ps ON ps.id = ci.printer_state_id
      WHERE ci.component_instance_id = ?
      ORDER BY ps.created_at, ps.id, ci.id
    `);
  }

  async create(installation: ComponentInstallation): Promise<void> {
    try {
      this.#create.run(
        installation.id,
        installation.printerStateId,
        installation.componentInstanceId,
        installation.role,
        installation.kind,
        installation.displayName,
        installation.definitionRef?.packageId ?? null,
        installation.definitionRef?.packageVersion ?? null,
        installation.definitionRef?.definitionId ?? null
      );
    } catch (error) {
      if (this.#findById.get(installation.id) !== undefined) {
        throw new DuplicateComponentInstallationError(installation.id);
      }
      if (this.#findByRole.get(installation.printerStateId, installation.role) !== undefined) {
        throw new DuplicateComponentRoleError(installation.printerStateId, installation.role);
      }
      throw error;
    }
  }

  async findById(id: string): Promise<ComponentInstallation | undefined> {
    const row = this.#findById.get(id);
    return row === undefined ? undefined : parseComponentInstallationRow(row);
  }

  async listByPrinterStateId(printerStateId: string): Promise<ComponentInstallation[]> {
    return this.#listByState.all(printerStateId).map(parseComponentInstallationRow);
  }

  async listByComponentInstanceId(componentInstanceId: string): Promise<ComponentInstallation[]> {
    return this.#listByInstance.all(componentInstanceId).map(parseComponentInstallationRow);
  }
}
