import type {
  CanonicalUnit,
  ClaimProvenance,
  ClaimSourceType,
  ClaimTrust,
  FieldClaim,
  FieldClaimTarget,
  FieldClaimValue,
} from "@printtune/contracts";
import { createFieldClaim } from "@printtune/core";

import {
  DuplicateFieldClaimError,
  StateTransitionFieldClaimWriteError,
  type FieldClaimRepository,
} from "./field-claim-repository.js";

type SqliteValue = string | number | null;

export interface FieldClaimSqliteStatement {
  run(...values: SqliteValue[]): { readonly changes: number | bigint };
  get(...values: string[]): unknown;
  all(...values: string[]): unknown[];
}

export interface FieldClaimSqliteConnection {
  readonly isTransaction: boolean;
  exec(sql: string): void;
  prepare(sql: string): FieldClaimSqliteStatement;
}

export class FieldClaimDataIntegrityError extends Error {
  override readonly name = "FieldClaimDataIntegrityError";

  constructor(
    readonly field: string,
    reason: string
  ) {
    super(`Invalid persisted FieldClaim field "${field}": ${reason}`);
  }
}

const SELECT_COLUMNS = `
  id, printer_state_id, component_installation_id, field_path,
  value_type, string_value, number_value, boolean_value, unit,
  source_type, source_reference_id, source_package_id, source_package_version,
  source_definition_id, source_fact_id, source_claim_id, transition_command_id,
  trust, confidence, created_at
`;

function asRow(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FieldClaimDataIntegrityError("row", "expected a SQLite row object");
  }
  return value as Record<string, unknown>;
}

function readString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new FieldClaimDataIntegrityError(field, "expected a string");
  }
  return value;
}

function readNullableString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value !== null && typeof value !== "string") {
    throw new FieldClaimDataIntegrityError(field, "expected a string or NULL");
  }
  return value;
}

function readNullableNumber(row: Record<string, unknown>, field: string): number | null {
  const value = row[field];
  if (value !== null && typeof value !== "number") {
    throw new FieldClaimDataIntegrityError(field, "expected a number or NULL");
  }
  return value;
}

function requireNull(value: unknown, field: string): void {
  if (value !== null) {
    throw new FieldClaimDataIntegrityError(field, "expected NULL for this discriminator");
  }
}

function parseTarget(row: Record<string, unknown>): FieldClaimTarget {
  const printerStateId = readNullableString(row, "printer_state_id");
  const componentInstallationId = readNullableString(row, "component_installation_id");
  if (printerStateId !== null && componentInstallationId === null) {
    return { type: "printer_state", printerStateId };
  }
  if (printerStateId === null && componentInstallationId !== null) {
    return { type: "component_installation", componentInstallationId };
  }
  throw new FieldClaimDataIntegrityError("target", "expected exactly one target identifier");
}

function parseValue(row: Record<string, unknown>): FieldClaimValue {
  const type = readString(row, "value_type");
  const stringValue = readNullableString(row, "string_value");
  const numberValue = readNullableNumber(row, "number_value");
  const booleanValue = readNullableNumber(row, "boolean_value");
  switch (type) {
    case "string":
      if (stringValue === null) {
        throw new FieldClaimDataIntegrityError("string_value", "expected a string value");
      }
      requireNull(numberValue, "number_value");
      requireNull(booleanValue, "boolean_value");
      return { type, value: stringValue };
    case "number":
      requireNull(stringValue, "string_value");
      requireNull(booleanValue, "boolean_value");
      if (numberValue === null || !Number.isFinite(numberValue)) {
        throw new FieldClaimDataIntegrityError("number_value", "expected a finite number");
      }
      return { type, value: numberValue };
    case "boolean":
      requireNull(stringValue, "string_value");
      requireNull(numberValue, "number_value");
      if (booleanValue !== 0 && booleanValue !== 1) {
        throw new FieldClaimDataIntegrityError("boolean_value", "expected 0 or 1");
      }
      return { type, value: booleanValue === 1 };
    default:
      throw new FieldClaimDataIntegrityError("value_type", "unsupported value type");
  }
}

function parseProvenance(row: Record<string, unknown>): ClaimProvenance {
  const sourceType = readString(row, "source_type") as ClaimSourceType;
  const referenceId = readNullableString(row, "source_reference_id");
  const packageId = readNullableString(row, "source_package_id");
  const packageVersion = readNullableString(row, "source_package_version");
  const definitionId = readNullableString(row, "source_definition_id");
  const factId = readNullableString(row, "source_fact_id");
  const sourceClaimId = readNullableString(row, "source_claim_id");
  const transitionCommandId = readNullableString(row, "transition_command_id");
  const noPackageFields = (): void => {
    requireNull(packageId, "source_package_id");
    requireNull(packageVersion, "source_package_version");
    requireNull(definitionId, "source_definition_id");
    requireNull(factId, "source_fact_id");
  };
  const noTransitionFields = (): void => {
    requireNull(sourceClaimId, "source_claim_id");
    requireNull(transitionCommandId, "transition_command_id");
  };
  const idReference = (
    type: "import_snapshot" | "slicer_profile_snapshot" | "firmware_snapshot" | "test_run"
  ) => {
    if (referenceId === null) {
      throw new FieldClaimDataIntegrityError("source_reference_id", "expected a reference ID");
    }
    noPackageFields();
    noTransitionFields();
    return { sourceType, sourceRef: { type, id: referenceId } } as ClaimProvenance;
  };

  switch (sourceType) {
    case "user_confirmed":
    case "user_entered":
    case "ai_unverified":
      requireNull(referenceId, "source_reference_id");
      noPackageFields();
      noTransitionFields();
      return { sourceType };
    case "imported_file":
      return idReference("import_snapshot");
    case "slicer_profile":
      return idReference("slicer_profile_snapshot");
    case "firmware_read":
      return idReference("firmware_snapshot");
    case "test_result":
      return idReference("test_run");
    case "knowledge_package":
      requireNull(referenceId, "source_reference_id");
      requireNull(definitionId, "source_definition_id");
      if (packageId === null || packageVersion === null) {
        throw new FieldClaimDataIntegrityError("provenance", "expected complete package reference");
      }
      return {
        sourceType,
        sourceRef: {
          type: "knowledge_package",
          packageId,
          packageVersion,
          ...(factId === null ? {} : { factId }),
        },
      };
    case "component_definition":
      requireNull(referenceId, "source_reference_id");
      requireNull(factId, "source_fact_id");
      if (packageId === null || packageVersion === null || definitionId === null) {
        throw new FieldClaimDataIntegrityError(
          "provenance",
          "expected complete component definition reference"
        );
      }
      return {
        sourceType,
        sourceRef: {
          type: "component_definition",
          packageId,
          packageVersion,
          definitionId,
        },
      };
    case "state_transition":
      requireNull(referenceId, "source_reference_id");
      noPackageFields();
      if (sourceClaimId === null || transitionCommandId === null) {
        throw new FieldClaimDataIntegrityError(
          "provenance",
          "expected complete transition reference"
        );
      }
      return {
        sourceType,
        sourceRef: { type: "state_transition", sourceClaimId, transitionCommandId },
      };
    default:
      throw new FieldClaimDataIntegrityError("source_type", "unsupported source type");
  }
}

export function parseFieldClaimRow(value: unknown): FieldClaim {
  const row = asRow(value);
  const confidence = readNullableNumber(row, "confidence");
  const unit = readNullableString(row, "unit");
  try {
    return createFieldClaim({
      id: readString(row, "id"),
      target: parseTarget(row),
      fieldPath: readString(row, "field_path"),
      value: parseValue(row),
      ...(unit === null ? {} : { unit: unit as CanonicalUnit }),
      provenance: parseProvenance(row),
      trust: readString(row, "trust") as ClaimTrust,
      ...(confidence === null ? {} : { confidence }),
      timestamp: readString(row, "created_at"),
    });
  } catch (error) {
    if (error instanceof FieldClaimDataIntegrityError) {
      throw error;
    }
    throw new FieldClaimDataIntegrityError(
      "row",
      error instanceof Error ? error.message : "failed domain validation"
    );
  }
}

function targetValues(target: FieldClaimTarget): readonly [string | null, string | null] {
  return target.type === "printer_state"
    ? [target.printerStateId, null]
    : [null, target.componentInstallationId];
}

function valueColumns(
  value: FieldClaimValue
): readonly [string | null, number | null, number | null] {
  switch (value.type) {
    case "string":
      return [value.value, null, null];
    case "number":
      return [null, value.value, null];
    case "boolean":
      return [null, null, value.value ? 1 : 0];
  }
}

function provenanceColumns(
  provenance: ClaimProvenance
): readonly [
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
] {
  const reference = provenance.sourceRef;
  if (!reference) return [null, null, null, null, null, null, null];
  switch (reference.type) {
    case "import_snapshot":
    case "slicer_profile_snapshot":
    case "firmware_snapshot":
    case "test_run":
      return [reference.id, null, null, null, null, null, null];
    case "knowledge_package":
      return [
        null,
        reference.packageId,
        reference.packageVersion,
        null,
        reference.factId ?? null,
        null,
        null,
      ];
    case "component_definition":
      return [
        null,
        reference.packageId,
        reference.packageVersion,
        reference.definitionId,
        null,
        null,
        null,
      ];
    case "state_transition":
      return [null, null, null, null, null, reference.sourceClaimId, reference.transitionCommandId];
  }
}

export class SqliteFieldClaimRepository implements FieldClaimRepository {
  readonly #database: FieldClaimSqliteConnection;
  readonly #create: FieldClaimSqliteStatement;
  readonly #find: FieldClaimSqliteStatement;
  readonly #listByState: FieldClaimSqliteStatement;
  readonly #listByInstallation: FieldClaimSqliteStatement;
  readonly #listByStateAndPath: FieldClaimSqliteStatement;
  readonly #listByInstallationAndPath: FieldClaimSqliteStatement;

  constructor(database: FieldClaimSqliteConnection) {
    this.#database = database;
    this.#create = prepareFieldClaimInsert(database);
    this.#find = database.prepare(`SELECT ${SELECT_COLUMNS} FROM field_claims WHERE id = ?`);
    this.#listByState = database.prepare(`
      SELECT ${SELECT_COLUMNS} FROM field_claims
      WHERE printer_state_id = ? ORDER BY created_at, id
    `);
    this.#listByInstallation = database.prepare(`
      SELECT ${SELECT_COLUMNS} FROM field_claims
      WHERE component_installation_id = ? ORDER BY created_at, id
    `);
    this.#listByStateAndPath = database.prepare(`
      SELECT ${SELECT_COLUMNS} FROM field_claims
      WHERE printer_state_id = ? AND field_path = ? ORDER BY created_at, id
    `);
    this.#listByInstallationAndPath = database.prepare(`
      SELECT ${SELECT_COLUMNS} FROM field_claims
      WHERE component_installation_id = ? AND field_path = ? ORDER BY created_at, id
    `);
  }

  async create(claim: FieldClaim): Promise<void> {
    if (claim.provenance.sourceType === "state_transition") {
      throw new StateTransitionFieldClaimWriteError();
    }
    try {
      insertFieldClaim(this.#create, claim);
    } catch (error) {
      if (this.#find.get(claim.id) !== undefined) {
        throw new DuplicateFieldClaimError(claim.id);
      }
      throw error;
    }
  }

  async createBatch(claims: readonly FieldClaim[]): Promise<void> {
    if (claims.length === 0) return;

    const incomingIds = new Set<string>();
    for (const claim of claims) {
      if (claim.provenance.sourceType === "state_transition") {
        throw new StateTransitionFieldClaimWriteError();
      }
      if (incomingIds.has(claim.id) || this.#find.get(claim.id) !== undefined) {
        throw new DuplicateFieldClaimError(claim.id);
      }
      incomingIds.add(claim.id);
    }

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (const claim of claims) insertFieldClaim(this.#create, claim);
      this.#database.exec("COMMIT");
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  async findById(id: string): Promise<FieldClaim | undefined> {
    const row = this.#find.get(id);
    return row === undefined ? undefined : parseFieldClaimRow(row);
  }

  async listByTarget(target: FieldClaimTarget): Promise<FieldClaim[]> {
    const rows =
      target.type === "printer_state"
        ? this.#listByState.all(target.printerStateId)
        : this.#listByInstallation.all(target.componentInstallationId);
    return rows.map(parseFieldClaimRow);
  }

  async listByTargetAndFieldPath(
    target: FieldClaimTarget,
    fieldPath: string
  ): Promise<FieldClaim[]> {
    const rows =
      target.type === "printer_state"
        ? this.#listByStateAndPath.all(target.printerStateId, fieldPath)
        : this.#listByInstallationAndPath.all(target.componentInstallationId, fieldPath);
    return rows.map(parseFieldClaimRow);
  }
}

export function prepareFieldClaimInsert(
  database: Pick<FieldClaimSqliteConnection, "prepare">
): FieldClaimSqliteStatement {
  return database.prepare(`
      INSERT INTO field_claims (
        id, printer_state_id, component_installation_id, field_path,
        value_type, string_value, number_value, boolean_value, unit,
        source_type, source_reference_id, source_package_id, source_package_version,
        source_definition_id, source_fact_id, source_claim_id, transition_command_id,
        trust, confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
}

export function insertFieldClaim(
  statement: FieldClaimSqliteStatement,
  claim: FieldClaim,
  options: { readonly allowStateTransition?: boolean } = {}
): void {
  if (claim.provenance.sourceType === "state_transition" && !options.allowStateTransition) {
    throw new StateTransitionFieldClaimWriteError();
  }
  const [printerStateId, componentInstallationId] = targetValues(claim.target);
  const [stringValue, numberValue, booleanValue] = valueColumns(claim.value);
  const [
    referenceId,
    packageId,
    packageVersion,
    definitionId,
    factId,
    sourceClaimId,
    transitionCommandId,
  ] = provenanceColumns(claim.provenance);
  statement.run(
    claim.id,
    printerStateId,
    componentInstallationId,
    claim.fieldPath,
    claim.value.type,
    stringValue,
    numberValue,
    booleanValue,
    claim.unit ?? null,
    claim.provenance.sourceType,
    referenceId,
    packageId,
    packageVersion,
    definitionId,
    factId,
    sourceClaimId,
    transitionCommandId,
    claim.trust,
    claim.confidence ?? null,
    claim.createdAt
  );
}
