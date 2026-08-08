import type { Workspace } from "@printtune/contracts";
import { createWorkspace, renameWorkspace } from "@printtune/core";
import { describe, expect, it } from "vitest";

import { InMemoryWorkspaceRepository } from "../src/index";

const FIRST_TIMESTAMP = "2026-08-08T10:00:00.000Z";
const SECOND_TIMESTAMP = "2026-08-09T10:00:00.000Z";

function workspace(id: string, createdAt = FIRST_TIMESTAMP): Workspace {
  return createWorkspace({ id, name: `Workspace ${id}`, timestamp: createdAt });
}

describe("InMemoryWorkspaceRepository", () => {
  it("starts empty", async () => {
    const repository = new InMemoryWorkspaceRepository();

    await expect(repository.list()).resolves.toEqual([]);
  });

  it("saves and finds a Workspace by ID", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const savedWorkspace = workspace("workspace-001");

    await repository.save(savedWorkspace);

    await expect(repository.findById(savedWorkspace.id)).resolves.toEqual(savedWorkspace);
  });

  it("returns undefined for a missing Workspace", async () => {
    const repository = new InMemoryWorkspaceRepository();

    await expect(repository.findById("missing")).resolves.toBeUndefined();
  });

  it("replaces a saved Workspace with the same ID", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const original = workspace("workspace-001");
    const replacement = renameWorkspace(original, "Umbenannt", SECOND_TIMESTAMP);

    await repository.save(original);
    await repository.save(replacement);

    await expect(repository.list()).resolves.toEqual([replacement]);
  });

  it("lists multiple Workspaces by createdAt and then ID", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const later = workspace("workspace-003", SECOND_TIMESTAMP);
    const tiedSecond = workspace("workspace-002");
    const tiedFirst = workspace("workspace-001");

    await repository.save(later);
    await repository.save(tiedSecond);
    await repository.save(tiedFirst);

    await expect(repository.list()).resolves.toEqual([tiedFirst, tiedSecond, later]);
  });

  it("deletes an existing Workspace", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const savedWorkspace = workspace("workspace-001");
    await repository.save(savedWorkspace);

    await expect(repository.delete(savedWorkspace.id)).resolves.toBe(true);
    await expect(repository.findById(savedWorkspace.id)).resolves.toBeUndefined();
  });

  it("returns false when deleting a missing Workspace", async () => {
    const repository = new InMemoryWorkspaceRepository();

    await expect(repository.delete("missing")).resolves.toBe(false);
  });

  it("does not retain a mutable reference passed to save", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const savedWorkspace = workspace("workspace-001");
    await repository.save(savedWorkspace);

    (savedWorkspace as { name: string }).name = "Extern verändert";

    await expect(repository.findById(savedWorkspace.id)).resolves.toMatchObject({
      name: "Workspace workspace-001",
    });
  });

  it("returns defensive copies from findById and list", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const savedWorkspace = workspace("workspace-001");
    await repository.save(savedWorkspace);

    const found = await repository.findById(savedWorkspace.id);
    const listed = await repository.list();

    (found as { name: string }).name = "Fund verändert";
    (listed[0] as { name: string }).name = "Liste verändert";
    listed.length = 0;

    await expect(repository.findById(savedWorkspace.id)).resolves.toEqual(savedWorkspace);
    await expect(repository.list()).resolves.toEqual([savedWorkspace]);
  });
});
