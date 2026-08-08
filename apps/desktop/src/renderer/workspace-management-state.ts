import type { Workspace } from "@printtune/contracts";

export interface WorkspaceManagementState {
  readonly rename: { readonly id: string; readonly name: string } | undefined;
  readonly deleteConfirmationId: string | undefined;
}

export type WorkspaceManagementAction =
  | { readonly type: "begin-rename"; readonly workspace: Workspace }
  | { readonly type: "change-rename-name"; readonly name: string }
  | { readonly type: "cancel-rename" }
  | { readonly type: "request-delete"; readonly id: string }
  | { readonly type: "cancel-delete" }
  | { readonly type: "reset" };

export const INITIAL_WORKSPACE_MANAGEMENT_STATE: WorkspaceManagementState = {
  rename: undefined,
  deleteConfirmationId: undefined,
};

export function reduceWorkspaceManagementState(
  state: WorkspaceManagementState,
  action: WorkspaceManagementAction
): WorkspaceManagementState {
  switch (action.type) {
    case "begin-rename":
      return {
        rename: { id: action.workspace.id, name: action.workspace.name },
        deleteConfirmationId: undefined,
      };
    case "change-rename-name":
      return state.rename ? { ...state, rename: { ...state.rename, name: action.name } } : state;
    case "cancel-rename":
      return { ...state, rename: undefined };
    case "request-delete":
      return { rename: undefined, deleteConfirmationId: action.id };
    case "cancel-delete":
      return { ...state, deleteConfirmationId: undefined };
    case "reset":
      return INITIAL_WORKSPACE_MANAGEMENT_STATE;
  }
}
