import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { runNodeSqliteCompatibilityCheck } from "../src/main/spikes/node-sqlite-compatibility";

describe("node:sqlite compatibility", () => {
  it("supports the required in-memory capabilities", () => {
    expect(runNodeSqliteCompatibilityCheck()).toEqual({
      nodeVersion: process.versions.node,
      sqliteVersion: expect.any(String),
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
    });
  });

  it("persists data after a temporary file-backed database is reopened", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "printtune-node-sqlite-"));
    const databasePath = join(temporaryDirectory, "compatibility.sqlite");

    try {
      const firstConnection = new DatabaseSync(databasePath, {
        allowExtension: false,
        defensive: true,
      });
      firstConnection.exec("CREATE TABLE fixture (id INTEGER PRIMARY KEY, value TEXT) STRICT");
      firstConnection.prepare("INSERT INTO fixture (id, value) VALUES (?, ?)").run(1, "persisted");
      firstConnection.close();

      const secondConnection = new DatabaseSync(databasePath, {
        allowExtension: false,
        defensive: true,
      });
      try {
        expect(secondConnection.prepare("SELECT value FROM fixture WHERE id = ?").get(1)).toEqual({
          value: "persisted",
        });
      } finally {
        secondConnection.close();
      }
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
