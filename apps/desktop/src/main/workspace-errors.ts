export class WorkspaceNotFoundError extends Error {
  override readonly name = "WorkspaceNotFoundError";

  constructor(readonly workspaceId: string) {
    super(`Workspace not found: ${workspaceId}`);
  }
}
