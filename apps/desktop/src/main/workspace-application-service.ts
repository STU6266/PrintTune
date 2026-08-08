import { randomUUID } from "node:crypto";

import type { Workspace } from "@printtune/contracts";
import { createWorkspace as createDomainWorkspace } from "@printtune/core";
import type { WorkspaceRepository } from "@printtune/storage";

import type { CreateWorkspaceRequest } from "../shared/workspace-api";

interface WorkspaceApplicationServiceDependencies {
  readonly createId?: () => string;
  readonly now?: () => string;
}

export class WorkspaceApplicationService {
  readonly #repository: WorkspaceRepository;
  readonly #createId: () => string;
  readonly #now: () => string;

  constructor(
    repository: WorkspaceRepository,
    dependencies: WorkspaceApplicationServiceDependencies = {}
  ) {
    this.#repository = repository;
    this.#createId = dependencies.createId ?? randomUUID;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async listWorkspaces(): Promise<Workspace[]> {
    return this.#repository.list();
  }

  async createWorkspace(input: CreateWorkspaceRequest): Promise<Workspace> {
    const workspace = createDomainWorkspace({
      id: this.#createId(),
      name: input.name,
      timestamp: this.#now(),
    });

    await this.#repository.save(workspace);
    return workspace;
  }
}
