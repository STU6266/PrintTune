import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createWorkspace } from "@printtune/core";
import { describe, expect, it } from "vitest";

import { WorkspaceDataIntegrityError, openPrintTuneDatabase } from "../src/index";
import { parseWorkspaceRow } from "../src/sqlite-workspace-repository";
import { describeWorkspaceRepository } from "./workspace-repository-contract";

function createTemporaryDatabase(): { directory: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), "printtune-workspace-repository-"));
  return { directory, path: join(directory, "printtune.sqlite") };
}

describeWorkspaceRepository("SqliteWorkspaceRepository", () => {
  const { directory, path } = createTemporaryDatabase();
  const database = openPrintTuneDatabase(path);
  database.migrate();

  return {
    repository: database.createWorkspaceRepository(),
    close() {
      database.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
});

describe("SqliteWorkspaceRepository persistence and integrity", () => {
  it("persists a Workspace after close and reopen", async () => {
    const { directory, path } = createTemporaryDatabase();
    const savedWorkspace = createWorkspace({
      id: "workspace-persisted",
      name: "Dauerhaft",
      timestamp: "2026-08-08T10:00:00.000Z",
    });

    try {
      const firstDatabase = openPrintTuneDatabase(path);
      firstDatabase.migrate();
      await firstDatabase.createWorkspaceRepository().save(savedWorkspace);
      firstDatabase.close();

      const secondDatabase = openPrintTuneDatabase(path);
      secondDatabase.migrate();
      try {
        await expect(
          secondDatabase.createWorkspaceRepository().findById(savedWorkspace.id)
        ).resolves.toEqual(savedWorkspace);
      } finally {
        secondDatabase.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it.each([
    ["id", "", "Workspace", "2026-08-08T10:00:00.000Z", "2026-08-08T10:00:00.000Z"],
    ["name", "workspace-corrupt", "   ", "2026-08-08T10:00:00.000Z", "2026-08-08T10:00:00.000Z"],
    ["created_at", "workspace-corrupt", "Workspace", "invalid", "2026-08-08T10:00:00.000Z"],
    ["updated_at", "workspace-corrupt", "Workspace", "2026-08-08T10:00:00.000Z", "invalid"],
  ])("rejects a corrupt %s field", async (field, id, name, createdAt, updatedAt) => {
    const { directory, path } = createTemporaryDatabase();

    try {
      const setupDatabase = openPrintTuneDatabase(path);
      setupDatabase.migrate();
      setupDatabase.close();

      const corruptionConnection = new DatabaseSync(path);
      corruptionConnection
        .prepare("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .run(id, name, createdAt, updatedAt);
      corruptionConnection.close();

      const database = openPrintTuneDatabase(path);
      database.migrate();
      try {
        await expect(database.createWorkspaceRepository().list()).rejects.toMatchObject({
          name: "WorkspaceDataIntegrityError",
          field,
        } satisfies Partial<WorkspaceDataIntegrityError>);
      } finally {
        database.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rejects unexpected SQLite value types", () => {
    expect(() =>
      parseWorkspaceRow({
        id: 42,
        name: "Workspace",
        created_at: "2026-08-08T10:00:00.000Z",
        updated_at: "2026-08-08T10:00:00.000Z",
      })
    ).toThrow(WorkspaceDataIntegrityError);
  });
});
