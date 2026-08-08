import { DatabaseSync } from "node:sqlite";

export const NODE_SQLITE_SMOKE_ARGUMENT = "--node-sqlite-smoke";
export const NODE_SQLITE_SMOKE_RESULT_PREFIX = "NODE_SQLITE_SMOKE_RESULT ";

export interface NodeSqliteCompatibilityResult {
  readonly nodeVersion: string;
  readonly sqliteVersion: string;
  readonly strictTable: true;
  readonly preparedInsert: true;
  readonly preparedRead: true;
  readonly preparedUpdate: true;
  readonly preparedDelete: true;
  readonly transactionCommit: true;
  readonly transactionRollback: true;
  readonly foreignKeys: true;
  readonly extensionLoadingDisabled: true;
  readonly defensiveModeAvailable: true;
  readonly defensiveModeEnabled: true;
}

function assertCheck(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`node:sqlite compatibility check failed: ${message}`);
  }
}

export function runNodeSqliteCompatibilityCheck(): NodeSqliteCompatibilityResult {
  const database = new DatabaseSync(":memory:", {
    allowExtension: false,
    defensive: true,
    enableForeignKeyConstraints: true,
  });

  try {
    const versionRow = database.prepare("SELECT sqlite_version() AS version").get() as
      { version?: unknown } | undefined;
    assertCheck(typeof versionRow?.version === "string", "SQLite version is unavailable");

    const defensiveModeAvailable = typeof database.enableDefensive === "function";
    assertCheck(defensiveModeAvailable, "defensive mode API is unavailable");
    database.enableDefensive(true);

    let extensionLoadingDisabled = false;
    try {
      database.enableLoadExtension(true);
    } catch {
      extensionLoadingDisabled = true;
    }
    assertCheck(extensionLoadingDisabled, "extension loading could be enabled");

    database.exec(`
      CREATE TABLE smoke_items (
        id INTEGER PRIMARY KEY,
        value INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE smoke_parents (id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE smoke_children (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER NOT NULL REFERENCES smoke_parents(id)
      ) STRICT;
    `);

    const insertItem = database.prepare("INSERT INTO smoke_items (id, value) VALUES (?, ?)");
    const readItem = database.prepare("SELECT value FROM smoke_items WHERE id = ?");
    const updateItem = database.prepare("UPDATE smoke_items SET value = ? WHERE id = ?");
    const deleteItem = database.prepare("DELETE FROM smoke_items WHERE id = ?");

    let strictTable = false;
    try {
      insertItem.run(99, "not-an-integer");
    } catch {
      strictTable = true;
    }
    assertCheck(strictTable, "STRICT type enforcement was not observed");

    assertCheck(insertItem.run(1, 10).changes === 1, "prepared insert failed");
    const insertedRow = readItem.get(1) as { value?: unknown } | undefined;
    assertCheck(insertedRow?.value === 10, "prepared read failed");
    assertCheck(updateItem.run(20, 1).changes === 1, "prepared update failed");
    const updatedRow = readItem.get(1) as { value?: unknown } | undefined;
    assertCheck(updatedRow?.value === 20, "updated value was not read back");
    assertCheck(deleteItem.run(1).changes === 1, "prepared delete failed");
    assertCheck(readItem.get(1) === undefined, "deleted row remains present");

    database.exec("BEGIN");
    insertItem.run(2, 20);
    database.exec("COMMIT");
    assertCheck(readItem.get(2) !== undefined, "transaction commit was not persisted");

    let transactionFailed = false;
    database.exec("BEGIN");
    try {
      insertItem.run(3, 30);
      insertItem.run(3, 31);
      database.exec("COMMIT");
    } catch {
      transactionFailed = true;
      database.exec("ROLLBACK");
    }
    assertCheck(transactionFailed, "failing transaction did not fail");
    assertCheck(readItem.get(3) === undefined, "failing transaction was not rolled back");

    const foreignKeysRow = database.prepare("PRAGMA foreign_keys").get() as
      { foreign_keys?: unknown } | undefined;
    assertCheck(foreignKeysRow?.foreign_keys === 1, "foreign-key enforcement is disabled");
    let foreignKeyRejected = false;
    try {
      database.prepare("INSERT INTO smoke_children (id, parent_id) VALUES (?, ?)").run(1, 404);
    } catch {
      foreignKeyRejected = true;
    }
    assertCheck(foreignKeyRejected, "invalid foreign key was accepted");

    return {
      nodeVersion: process.versions.node,
      sqliteVersion: versionRow.version,
      strictTable: true,
      preparedInsert: true,
      preparedRead: true,
      preparedUpdate: true,
      preparedDelete: true,
      transactionCommit: true,
      transactionRollback: true,
      foreignKeys: true,
      extensionLoadingDisabled: true,
      defensiveModeAvailable: true,
      defensiveModeEnabled: true,
    };
  } finally {
    database.close();
  }
}
