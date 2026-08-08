import type { IpcMain, WebContents } from "electron";

import {
  WORKSPACE_CREATE_CHANNEL,
  WORKSPACE_DELETE_CHANNEL,
  WORKSPACE_GET_ACTIVE_CHANNEL,
  WORKSPACE_LIST_CHANNEL,
  WORKSPACE_RENAME_CHANNEL,
  WORKSPACE_SET_ACTIVE_CHANNEL,
  assertCreateWorkspaceRequest,
  assertDeleteWorkspaceRequest,
  assertRenameWorkspaceRequest,
  assertSetActiveWorkspaceRequest,
} from "../shared/workspace-api";
import type { ActiveWorkspaceSession } from "./active-workspace-session";
import { assertTrustedRendererSender } from "./trusted-renderer";
import type { WorkspaceApplicationService } from "./workspace-application-service";

export function registerWorkspaceIpcHandlers(
  ipc: Pick<IpcMain, "handle">,
  service: WorkspaceApplicationService,
  activeWorkspaceSession: ActiveWorkspaceSession,
  getTrustedRenderer: () => WebContents | undefined
): void {
  ipc.handle(WORKSPACE_LIST_CHANNEL, async (event) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    return service.listWorkspaces();
  });

  ipc.handle(WORKSPACE_CREATE_CHANNEL, async (event, payload: unknown) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    return service.createWorkspace(assertCreateWorkspaceRequest(payload));
  });

  ipc.handle(WORKSPACE_GET_ACTIVE_CHANNEL, async (event) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    return activeWorkspaceSession.getActiveWorkspace();
  });

  ipc.handle(WORKSPACE_SET_ACTIVE_CHANNEL, async (event, payload: unknown) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    const request = assertSetActiveWorkspaceRequest(payload);
    return activeWorkspaceSession.setActiveWorkspace(request.id);
  });

  ipc.handle(WORKSPACE_RENAME_CHANNEL, async (event, payload: unknown) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    return service.renameWorkspace(assertRenameWorkspaceRequest(payload));
  });

  ipc.handle(WORKSPACE_DELETE_CHANNEL, async (event, payload: unknown) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    const request = assertDeleteWorkspaceRequest(payload);
    const deleted = await service.deleteWorkspace(request);
    activeWorkspaceSession.clearIfActive(request.id);
    return deleted;
  });
}
