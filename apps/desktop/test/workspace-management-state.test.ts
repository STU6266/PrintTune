import { describe, expect, it } from "vitest";

import {
  INITIAL_WORKSPACE_MANAGEMENT_STATE,
  reduceWorkspaceManagementState,
} from "../src/renderer/workspace-management-state";

describe("Workspace management renderer state", () => {
  it("starts, edits, and cancels inline rename state", () => {
    const editing = reduceWorkspaceManagementState(INITIAL_WORKSPACE_MANAGEMENT_STATE, {
      type: "begin-rename",
      workspace: {
        id: "workspace-a",
        name: "Alt",
        createdAt: "2026-08-08T12:00:00.000Z",
        updatedAt: "2026-08-08T12:00:00.000Z",
      },
    });
    const changed = reduceWorkspaceManagementState(editing, {
      type: "change-rename-name",
      name: "Neu",
    });

    expect(changed.rename).toEqual({ id: "workspace-a", name: "Neu" });
    expect(reduceWorkspaceManagementState(changed, { type: "cancel-rename" })).toEqual(
      INITIAL_WORKSPACE_MANAGEMENT_STATE
    );
  });

  it("requires and can cancel an explicit delete confirmation", () => {
    const confirming = reduceWorkspaceManagementState(INITIAL_WORKSPACE_MANAGEMENT_STATE, {
      type: "request-delete",
      id: "workspace-a",
    });

    expect(confirming.deleteConfirmationId).toBe("workspace-a");
    expect(reduceWorkspaceManagementState(confirming, { type: "cancel-delete" })).toEqual(
      INITIAL_WORKSPACE_MANAGEMENT_STATE
    );
  });
});
