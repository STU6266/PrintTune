import type { Workspace } from "@printtune/contracts";

export function isWorkspaceActive(
  activeWorkspace: Workspace | undefined,
  workspace: Workspace
): boolean {
  return activeWorkspace?.id === workspace.id;
}
