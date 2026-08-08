import type { Workspace } from "@printtune/contracts";
import type { WorkspaceRepository } from "@printtune/storage";

export class WorkspaceNotFoundError extends Error {
  override readonly name = "WorkspaceNotFoundError";

  constructor(readonly workspaceId: string) {
    super(`Workspace not found: ${workspaceId}`);
  }
}

export class ActiveWorkspaceSession {
  readonly #repository: WorkspaceRepository;
  #activeWorkspaceId: string | undefined;

  constructor(repository: WorkspaceRepository) {
    this.#repository = repository;
  }

  async getActiveWorkspace(): Promise<Workspace | undefined> {
    if (!this.#activeWorkspaceId) {
      return undefined;
    }

    const workspace = await this.#repository.findById(this.#activeWorkspaceId);
    if (!workspace) {
      this.#activeWorkspaceId = undefined;
    }

    return workspace;
  }

  async setActiveWorkspace(id: string): Promise<Workspace> {
    const workspace = await this.#repository.findById(id);
    if (!workspace) {
      throw new WorkspaceNotFoundError(id);
    }

    this.#activeWorkspaceId = workspace.id;
    return workspace;
  }
}
