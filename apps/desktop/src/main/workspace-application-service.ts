import { randomUUID } from "node:crypto";

import type { Workspace } from "@printtune/contracts";
import {
  createWorkspace as createDomainWorkspace,
  renameWorkspace as renameDomainWorkspace,
} from "@printtune/core";
import type { WorkspaceRepository } from "@printtune/storage";

import type {
  CreateWorkspaceRequest,
  DeleteWorkspaceRequest,
  RenameWorkspaceRequest,
} from "../shared/workspace-api";
import { WorkspaceNotFoundError } from "./workspace-errors";

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

  async renameWorkspace(input: RenameWorkspaceRequest): Promise<Workspace> {
    const workspace = await this.#repository.findById(input.id);
    if (!workspace) {
      throw new WorkspaceNotFoundError(input.id);
    }

    const renamedWorkspace = renameDomainWorkspace(workspace, input.name, this.#now());
    await this.#repository.save(renamedWorkspace);
    return renamedWorkspace;
  }

  async deleteWorkspace(input: DeleteWorkspaceRequest): Promise<boolean> {
    const workspace = await this.#repository.findById(input.id);
    if (!workspace || !(await this.#repository.delete(input.id))) {
      throw new WorkspaceNotFoundError(input.id);
    }

    return true;
  }
}
