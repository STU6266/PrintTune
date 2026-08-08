import type { Workspace } from "@printtune/contracts";

import type { WorkspaceRepository } from "./workspace-repository.js";

function copyWorkspace(workspace: Workspace): Workspace {
  return { ...workspace };
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  readonly #workspaces = new Map<string, Workspace>();

  async save(workspace: Workspace): Promise<void> {
    this.#workspaces.set(workspace.id, copyWorkspace(workspace));
  }

  async findById(id: string): Promise<Workspace | undefined> {
    const workspace = this.#workspaces.get(id);
    return workspace ? copyWorkspace(workspace) : undefined;
  }

  async list(): Promise<Workspace[]> {
    return [...this.#workspaces.values()]
      .sort(
        (left, right) =>
          compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id)
      )
      .map(copyWorkspace);
  }

  async delete(id: string): Promise<boolean> {
    return this.#workspaces.delete(id);
  }
}
