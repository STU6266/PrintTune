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
import { WorkspaceNotFoundError } from "../src/main/workspace-errors";

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

  it("renames an existing Workspace with a main-owned timestamp", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = new WorkspaceApplicationService(repository, {
      createId: () => ID,
      now: () => TIMESTAMP,
    });
    const created = await service.createWorkspace({ name: "Alt" });
    const renamedAt = "2026-08-08T13:00:00.000Z";
    const renameService = new WorkspaceApplicationService(repository, { now: () => renamedAt });

    await expect(renameService.renameWorkspace({ id: ID, name: "  Neu  " })).resolves.toEqual({
      ...created,
      name: "Neu",
      updatedAt: renamedAt,
    });
  });

  it("rejects invalid rename names without changing stored data", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = new WorkspaceApplicationService(repository, {
      createId: () => ID,
      now: () => TIMESTAMP,
    });
    const created = await service.createWorkspace({ name: "Unverändert" });

    await expect(service.renameWorkspace({ id: ID, name: "   " })).rejects.toBeInstanceOf(
      InvalidWorkspaceNameError
    );
    await expect(repository.findById(ID)).resolves.toEqual(created);
  });

  it("rejects rename and delete for a missing Workspace", async () => {
    const service = new WorkspaceApplicationService(new InMemoryWorkspaceRepository());

    await expect(service.renameWorkspace({ id: "missing", name: "Neu" })).rejects.toBeInstanceOf(
      WorkspaceNotFoundError
    );
    await expect(service.deleteWorkspace({ id: "missing" })).rejects.toBeInstanceOf(
      WorkspaceNotFoundError
    );
  });

  it("deletes an existing Workspace", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = new WorkspaceApplicationService(repository, {
      createId: () => ID,
      now: () => TIMESTAMP,
    });
    await service.createWorkspace({ name: "Löschen" });

    await expect(service.deleteWorkspace({ id: ID })).resolves.toBe(true);
    await expect(repository.findById(ID)).resolves.toBeUndefined();
  });

  it("persists rename and deletion across SQLite close and reopen", async () => {
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
      const created = await firstService.createWorkspace({ name: "Alt" });
      const renamed = await new WorkspaceApplicationService(
        firstDatabase.createWorkspaceRepository(),
        { now: () => "2026-08-08T13:00:00.000Z" }
      ).renameWorkspace({ id: created.id, name: "Persistiert" });
      firstDatabase.close();

      const secondDatabase = openPrintTuneDatabase(databasePath);
      secondDatabase.migrate();
      try {
        const secondService = new WorkspaceApplicationService(
          secondDatabase.createWorkspaceRepository()
        );
        await expect(secondService.listWorkspaces()).resolves.toEqual([renamed]);
        await secondService.deleteWorkspace({ id: ID });
      } finally {
        secondDatabase.close();
      }

      const thirdDatabase = openPrintTuneDatabase(databasePath);
      thirdDatabase.migrate();
      try {
        await expect(
          new WorkspaceApplicationService(
            thirdDatabase.createWorkspaceRepository()
          ).listWorkspaces()
        ).resolves.toEqual([]);
      } finally {
        thirdDatabase.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
