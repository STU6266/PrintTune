import { createWorkspace, renameWorkspace } from "@printtune/core";
import { InMemoryWorkspaceRepository } from "@printtune/storage";
import { describe, expect, it } from "vitest";

import {
  ActiveWorkspaceSession,
  WorkspaceNotFoundError,
} from "../src/main/active-workspace-session";

const FIRST_TIMESTAMP = "2026-08-08T12:00:00.000Z";
const SECOND_TIMESTAMP = "2026-08-08T13:00:00.000Z";

function workspace(id: string, name: string) {
  return createWorkspace({ id, name, timestamp: FIRST_TIMESTAMP });
}

describe("ActiveWorkspaceSession", () => {
  it("initially has no active Workspace even when the repository contains one", async () => {
    const repository = new InMemoryWorkspaceRepository();
    await repository.save(workspace("workspace-a", "Werkstatt A"));
    const session = new ActiveWorkspaceSession(repository);

    await expect(session.getActiveWorkspace()).resolves.toBeUndefined();
  });

  it("selects and retrieves an existing Workspace", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const existingWorkspace = workspace("workspace-a", "Werkstatt A");
    await repository.save(existingWorkspace);
    const session = new ActiveWorkspaceSession(repository);

    await expect(session.setActiveWorkspace(existingWorkspace.id)).resolves.toEqual(
      existingWorkspace
    );
    await expect(session.getActiveWorkspace()).resolves.toEqual(existingWorkspace);
  });

  it("rejects a missing Workspace ID", async () => {
    const session = new ActiveWorkspaceSession(new InMemoryWorkspaceRepository());

    await expect(session.setActiveWorkspace("missing")).rejects.toBeInstanceOf(
      WorkspaceNotFoundError
    );
    await expect(session.getActiveWorkspace()).resolves.toBeUndefined();
  });

  it("uses the repository as the source of returned Workspace data", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const original = workspace("workspace-a", "Alter Name");
    await repository.save(original);
    const session = new ActiveWorkspaceSession(repository);
    await session.setActiveWorkspace(original.id);

    const replacement = renameWorkspace(original, "Neuer Name", SECOND_TIMESTAMP);
    await repository.save(replacement);

    await expect(session.getActiveWorkspace()).resolves.toEqual(replacement);
  });

  it("switches between existing Workspaces", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const first = workspace("workspace-a", "Werkstatt A");
    const second = workspace("workspace-b", "Werkstatt B");
    await repository.save(first);
    await repository.save(second);
    const session = new ActiveWorkspaceSession(repository);

    await session.setActiveWorkspace(first.id);
    await session.setActiveWorkspace(second.id);

    await expect(session.getActiveWorkspace()).resolves.toEqual(second);
  });
});
