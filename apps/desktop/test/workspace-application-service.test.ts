import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InvalidWorkspaceNameError } from "@printtune/core";
import {
  InMemoryWorkspaceRepository,
  openPrintTuneDatabase,
  type WorkspaceRepository,
} from "@printtune/storage";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceApplicationService } from "../src/main/workspace-application-service";

const ID = "00000000-0000-4000-8000-000000000001";
const TIMESTAMP = "2026-08-08T12:00:00.000Z";

describe("WorkspaceApplicationService", () => {
  it("creates deterministically with main-owned ID and time", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = new WorkspaceApplicationService(repository, {
      createId: () => ID,
      now: () => TIMESTAMP,
    });

    await expect(service.createWorkspace({ name: "  Mein Druckraum  " })).resolves.toEqual({
      id: ID,
      name: "Mein Druckraum",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    await expect(repository.list()).resolves.toHaveLength(1);
  });

  it("delegates listing to the repository", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const repository: WorkspaceRepository = {
      save: vi.fn(),
      findById: vi.fn(),
      list,
      delete: vi.fn(),
    };
    const service = new WorkspaceApplicationService(repository);

    await expect(service.listWorkspaces()).resolves.toEqual([]);
    expect(list).toHaveBeenCalledOnce();
  });

  it("rejects an invalid Workspace name through domain validation", async () => {
    const service = new WorkspaceApplicationService(new InMemoryWorkspaceRepository(), {
      createId: () => ID,
      now: () => TIMESTAMP,
    });

    await expect(service.createWorkspace({ name: "   " })).rejects.toBeInstanceOf(
      InvalidWorkspaceNameError
    );
  });

  it("persists creation across a SQLite close and reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "printtune-workspace-service-"));
    const databasePath = join(directory, "printtune.sqlite");

    try {
      const firstDatabase = openPrintTuneDatabase(databasePath);
      firstDatabase.migrate();
      const firstService = new WorkspaceApplicationService(
        firstDatabase.createWorkspaceRepository(),
        {
          createId: () => ID,
          now: () => TIMESTAMP,
        }
      );
      const created = await firstService.createWorkspace({ name: "Persistiert" });
      firstDatabase.close();

      const secondDatabase = openPrintTuneDatabase(databasePath);
      secondDatabase.migrate();
      try {
        const secondService = new WorkspaceApplicationService(
          secondDatabase.createWorkspaceRepository()
        );
        await expect(secondService.listWorkspaces()).resolves.toEqual([created]);
      } finally {
        secondDatabase.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
