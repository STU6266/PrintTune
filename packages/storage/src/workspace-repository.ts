import type { Workspace } from "@printtune/contracts";

export interface WorkspaceRepository {
  save(workspace: Workspace): Promise<void>;
  findById(id: string): Promise<Workspace | undefined>;
  list(): Promise<Workspace[]>;
  delete(id: string): Promise<boolean>;
}
