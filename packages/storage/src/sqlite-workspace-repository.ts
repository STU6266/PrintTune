import type { Workspace } from "@printtune/contracts";

import type { WorkspaceRepository } from "./workspace-repository.js";

const ISO_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

interface WorkspaceSqliteStatement {
  run(...values: string[]): { readonly changes: number | bigint };
  get(...values: string[]): unknown;
  all(): unknown[];
}

interface WorkspaceSqliteConnection {
  prepare(sql: string): WorkspaceSqliteStatement;
}

export class WorkspaceDataIntegrityError extends Error {
  override readonly name = "WorkspaceDataIntegrityError";

  constructor(
    readonly field: string,
    reason: string
  ) {
    super(`Invalid persisted Workspace field "${field}": ${reason}`);
  }
}

function readString(row: Record<string, unknown>, field: string): string {
  const value = row[field];

  if (typeof value !== "string") {
    throw new WorkspaceDataIntegrityError(field, "expected a string");
  }

  return value;
}

function validateId(id: string): string {
  if (id.length === 0 || id.trim() !== id) {
    throw new WorkspaceDataIntegrityError("id", "expected a non-empty, trimmed ID");
  }

  return id;
}

function validateName(name: string): string {
  if (name.trim().length === 0) {
    throw new WorkspaceDataIntegrityError("name", "expected a non-empty name");
  }

  return name;
}

function validateTimestamp(timestamp: string, field: string): string {
  const milliseconds = Date.parse(timestamp);
  if (!ISO_UTC_TIMESTAMP_PATTERN.test(timestamp) || Number.isNaN(milliseconds)) {
    throw new WorkspaceDataIntegrityError(field, "expected an ISO-8601 UTC timestamp");
  }

  const normalizedTimestamp = timestamp.includes(".")
    ? timestamp.replace(/\.(\d{1,3})Z$/, (_, fraction: string) => `.${fraction.padEnd(3, "0")}Z`)
    : timestamp.replace("Z", ".000Z");

  if (new Date(milliseconds).toISOString() !== normalizedTimestamp) {
    throw new WorkspaceDataIntegrityError(field, "expected a valid ISO-8601 UTC timestamp");
  }

  return timestamp;
}

export function parseWorkspaceRow(value: unknown): Workspace {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WorkspaceDataIntegrityError("row", "expected a SQLite row object");
  }

  const row = value as Record<string, unknown>;

  return {
    id: validateId(readString(row, "id")),
    name: validateName(readString(row, "name")),
    createdAt: validateTimestamp(readString(row, "created_at"), "created_at"),
    updatedAt: validateTimestamp(readString(row, "updated_at"), "updated_at"),
  };
}

export class SqliteWorkspaceRepository implements WorkspaceRepository {
  readonly #saveStatement: WorkspaceSqliteStatement;
  readonly #findByIdStatement: WorkspaceSqliteStatement;
  readonly #listStatement: WorkspaceSqliteStatement;
  readonly #deleteStatement: WorkspaceSqliteStatement;

  constructor(database: WorkspaceSqliteConnection) {
    this.#saveStatement = database.prepare(`
      INSERT INTO workspaces (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `);
    this.#findByIdStatement = database.prepare(`
      SELECT id, name, created_at, updated_at
      FROM workspaces
      WHERE id = ?
    `);
    this.#listStatement = database.prepare(`
      SELECT id, name, created_at, updated_at
      FROM workspaces
      ORDER BY created_at, id
    `);
    this.#deleteStatement = database.prepare("DELETE FROM workspaces WHERE id = ?");
  }

  async save(workspace: Workspace): Promise<void> {
    this.#saveStatement.run(workspace.id, workspace.name, workspace.createdAt, workspace.updatedAt);
  }

  async findById(id: string): Promise<Workspace | undefined> {
    const row = this.#findByIdStatement.get(id);
    return row === undefined ? undefined : parseWorkspaceRow(row);
  }

  async list(): Promise<Workspace[]> {
    return this.#listStatement.all().map(parseWorkspaceRow);
  }

  async delete(id: string): Promise<boolean> {
    return this.#deleteStatement.run(id).changes > 0;
  }
}
