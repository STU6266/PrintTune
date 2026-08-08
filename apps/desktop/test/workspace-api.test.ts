import { describe, expect, it, vi } from "vitest";

import {
  WORKSPACE_CREATE_CHANNEL,
  WORKSPACE_DELETE_CHANNEL,
  WORKSPACE_GET_ACTIVE_CHANNEL,
  WORKSPACE_LIST_CHANNEL,
  WORKSPACE_RENAME_CHANNEL,
  WORKSPACE_SET_ACTIVE_CHANNEL,
  createWorkspaceApi,
} from "../src/shared/workspace-api";

const WORKSPACE = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Werkstatt",
  createdAt: "2026-08-08T12:00:00.000Z",
  updatedAt: "2026-08-08T12:00:00.000Z",
};

describe("Workspace preload API", () => {
  it("validates and freezes a Workspace list from the fixed channel", async () => {
    const invoke = vi.fn().mockResolvedValue([WORKSPACE]);
    const api = createWorkspaceApi(invoke);

    const workspaces = await api.listWorkspaces();

    expect(invoke).toHaveBeenCalledExactlyOnceWith(WORKSPACE_LIST_CHANNEL);
    expect(workspaces).toEqual([WORKSPACE]);
    expect(Object.isFrozen(workspaces)).toBe(true);
    expect(Object.isFrozen(workspaces[0])).toBe(true);
  });

  it.each([
    null,
    {},
    [null],
    [{ ...WORKSPACE, name: "" }],
    [{ ...WORKSPACE, createdAt: "2026-02-31T12:00:00.000Z" }],
    [{ ...WORKSPACE, extra: true }],
  ])("rejects a malformed Workspace list response: %j", async (response) => {
    const api = createWorkspaceApi(async () => response);

    await expect(api.listWorkspaces()).rejects.toThrow(TypeError);
  });

  it("validates and freezes the create result", async () => {
    const invoke = vi.fn().mockResolvedValue(WORKSPACE);
    const api = createWorkspaceApi(invoke);

    const workspace = await api.createWorkspace({ name: "Werkstatt" });

    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      WORKSPACE_CREATE_CHANNEL,
      Object.freeze({ name: "Werkstatt" })
    );
    expect(workspace).toEqual(WORKSPACE);
    expect(Object.isFrozen(workspace)).toBe(true);
  });

  it("rejects a malformed create result", async () => {
    const api = createWorkspaceApi(async () => ({ ...WORKSPACE, createdAt: "invalid" }));

    await expect(api.createWorkspace({ name: "Werkstatt" })).rejects.toThrow(TypeError);
  });

  it("rejects malformed create input before invoking IPC", async () => {
    const invoke = vi.fn();
    const api = createWorkspaceApi(invoke);

    await expect(api.createWorkspace({ name: 42 } as never)).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("accepts an undefined active Workspace", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const api = createWorkspaceApi(invoke);

    await expect(api.getActiveWorkspace()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledExactlyOnceWith(WORKSPACE_GET_ACTIVE_CHANNEL);
  });

  it("validates and freezes a returned active Workspace", async () => {
    const api = createWorkspaceApi(async () => WORKSPACE);

    const activeWorkspace = await api.getActiveWorkspace();

    expect(activeWorkspace).toEqual(WORKSPACE);
    expect(Object.isFrozen(activeWorkspace)).toBe(true);
  });

  it("rejects a malformed active Workspace response", async () => {
    const api = createWorkspaceApi(async () => ({ ...WORKSPACE, id: "" }));

    await expect(api.getActiveWorkspace()).rejects.toThrow(TypeError);
  });

  it("validates the set-active result and uses only the fixed channel and ID payload", async () => {
    const invoke = vi.fn().mockResolvedValue(WORKSPACE);
    const api = createWorkspaceApi(invoke);

    await expect(api.setActiveWorkspace(WORKSPACE.id)).resolves.toEqual(WORKSPACE);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      WORKSPACE_SET_ACTIVE_CHANNEL,
      Object.freeze({ id: WORKSPACE.id })
    );
  });

  it("rejects malformed set-active input before invoking IPC", async () => {
    const invoke = vi.fn();
    const api = createWorkspaceApi(invoke);

    await expect(api.setActiveWorkspace("   ")).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a malformed set-active result", async () => {
    const api = createWorkspaceApi(async () => ({ ...WORKSPACE, updatedAt: null }));

    await expect(api.setActiveWorkspace(WORKSPACE.id)).rejects.toThrow(TypeError);
  });

  it("validates rename input and result on the fixed channel", async () => {
    const renamed = { ...WORKSPACE, name: "Neu" };
    const invoke = vi.fn().mockResolvedValue(renamed);
    const api = createWorkspaceApi(invoke);

    await expect(api.renameWorkspace(WORKSPACE.id, "Neu")).resolves.toEqual(renamed);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      WORKSPACE_RENAME_CHANNEL,
      Object.freeze({ id: WORKSPACE.id, name: "Neu" })
    );
  });

  it("rejects malformed rename input and output", async () => {
    const invoke = vi.fn().mockResolvedValue({ ...WORKSPACE, name: "" });
    const api = createWorkspaceApi(invoke);

    await expect(api.renameWorkspace(" ", "Neu")).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
    await expect(api.renameWorkspace(WORKSPACE.id, "Neu")).rejects.toThrow(TypeError);
  });

  it.each([true, false])("validates the delete boolean result %j", async (result) => {
    const invoke = vi.fn().mockResolvedValue(result);
    const api = createWorkspaceApi(invoke);

    await expect(api.deleteWorkspace(WORKSPACE.id)).resolves.toBe(result);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      WORKSPACE_DELETE_CHANNEL,
      Object.freeze({ id: WORKSPACE.id })
    );
  });

  it("rejects malformed delete input and output", async () => {
    const invoke = vi.fn().mockResolvedValue("true");
    const api = createWorkspaceApi(invoke);

    await expect(api.deleteWorkspace(" ")).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
    await expect(api.deleteWorkspace(WORKSPACE.id)).rejects.toThrow(TypeError);
  });
});
