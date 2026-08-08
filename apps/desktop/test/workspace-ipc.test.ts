import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";

import { InMemoryWorkspaceRepository } from "@printtune/storage";
import { describe, expect, it, vi } from "vitest";

import { UntrustedRendererError } from "../src/main/trusted-renderer";
import { ActiveWorkspaceSession } from "../src/main/active-workspace-session";
import { WorkspaceApplicationService } from "../src/main/workspace-application-service";
import { registerWorkspaceIpcHandlers } from "../src/main/workspace-ipc";
import {
  WORKSPACE_CREATE_CHANNEL,
  WORKSPACE_DELETE_CHANNEL,
  WORKSPACE_GET_ACTIVE_CHANNEL,
  WORKSPACE_LIST_CHANNEL,
  WORKSPACE_RENAME_CHANNEL,
  WORKSPACE_SET_ACTIVE_CHANNEL,
} from "../src/shared/workspace-api";

type IpcHandler = (event: IpcMainInvokeEvent, payload?: unknown) => Promise<unknown>;

function createHarness() {
  const handlers = new Map<string, IpcHandler>();
  const handle = vi.fn((channel: string, listener: IpcHandler) => {
    handlers.set(channel, listener);
  });
  const trustedRenderer = {
    isDestroyed: () => false,
  } as WebContents;
  const repository = new InMemoryWorkspaceRepository();
  const service = new WorkspaceApplicationService(repository, {
    createId: () => "00000000-0000-4000-8000-000000000001",
    now: () => "2026-08-08T12:00:00.000Z",
  });

  registerWorkspaceIpcHandlers(
    { handle } as unknown as Pick<IpcMain, "handle">,
    service,
    new ActiveWorkspaceSession(repository),
    () => trustedRenderer
  );

  return { handle, handlers, trustedRenderer };
}

function eventFrom(sender: WebContents): IpcMainInvokeEvent {
  return { sender } as IpcMainInvokeEvent;
}

describe("Workspace IPC boundary", () => {
  it("registers only the six fixed Workspace channels", () => {
    const { handle, handlers } = createHarness();

    expect([...handlers.keys()]).toEqual([
      WORKSPACE_LIST_CHANNEL,
      WORKSPACE_CREATE_CHANNEL,
      WORKSPACE_GET_ACTIVE_CHANNEL,
      WORKSPACE_SET_ACTIVE_CHANNEL,
      WORKSPACE_RENAME_CHANNEL,
      WORKSPACE_DELETE_CHANNEL,
    ]);
    expect(handle).toHaveBeenCalledTimes(6);
  });

  it("accepts exact rename and delete payloads from the trusted renderer", async () => {
    const { handlers, trustedRenderer } = createHarness();
    const event = eventFrom(trustedRenderer);
    const created = (await handlers.get(WORKSPACE_CREATE_CHANNEL)?.(event, {
      name: "Alt",
    })) as { id: string };

    await expect(
      handlers.get(WORKSPACE_RENAME_CHANNEL)?.(event, { id: created.id, name: "Neu" })
    ).resolves.toMatchObject({ id: created.id, name: "Neu" });
    await expect(handlers.get(WORKSPACE_DELETE_CHANNEL)?.(event, { id: created.id })).resolves.toBe(
      true
    );
  });

  it.each([
    undefined,
    null,
    "workspace-a",
    {},
    { id: "workspace-a" },
    { name: "Neu" },
    { id: 42, name: "Neu" },
    { id: "workspace-a", name: 42 },
    { id: " workspace-a ", name: "Neu" },
    { id: "workspace-a", name: "Neu", updatedAt: "2026-08-08T12:00:00.000Z" },
  ])("rejects a malformed rename payload: %j", async (payload) => {
    const { handlers, trustedRenderer } = createHarness();

    await expect(
      handlers.get(WORKSPACE_RENAME_CHANNEL)?.(eventFrom(trustedRenderer), payload)
    ).rejects.toThrow(TypeError);
  });

  it.each([
    undefined,
    null,
    "workspace-a",
    {},
    { id: 42 },
    { id: "" },
    { id: " workspace-a " },
    { id: "workspace-a", force: true },
  ])("rejects a malformed delete payload: %j", async (payload) => {
    const { handlers, trustedRenderer } = createHarness();

    await expect(
      handlers.get(WORKSPACE_DELETE_CHANNEL)?.(eventFrom(trustedRenderer), payload)
    ).rejects.toThrow(TypeError);
  });

  it("accepts a valid create payload from the trusted renderer", async () => {
    const { handlers, trustedRenderer } = createHarness();
    const handler = handlers.get(WORKSPACE_CREATE_CHANNEL);

    await expect(
      handler?.(eventFrom(trustedRenderer), { name: "Werkstatt" })
    ).resolves.toMatchObject({ name: "Werkstatt" });
  });

  it.each([undefined, null, "Werkstatt", {}, { name: 42 }, { name: "A", id: "supplied" }])(
    "rejects a malformed create payload: %j",
    async (payload) => {
      const { handlers, trustedRenderer } = createHarness();
      const handler = handlers.get(WORKSPACE_CREATE_CHANNEL);

      await expect(handler?.(eventFrom(trustedRenderer), payload)).rejects.toThrow(TypeError);
    }
  );

  it("rejects an untrusted sender", async () => {
    const { handlers } = createHarness();
    const untrustedRenderer = { isDestroyed: () => false } as WebContents;
    const handler = handlers.get(WORKSPACE_LIST_CHANNEL);

    await expect(handler?.(eventFrom(untrustedRenderer))).rejects.toBeInstanceOf(
      UntrustedRendererError
    );
  });

  it("accepts a valid active Workspace ID", async () => {
    const { handlers, trustedRenderer } = createHarness();
    const createHandler = handlers.get(WORKSPACE_CREATE_CHANNEL);
    const created = await createHandler?.(eventFrom(trustedRenderer), { name: "Werkstatt" });
    const setActiveHandler = handlers.get(WORKSPACE_SET_ACTIVE_CHANNEL);

    await expect(
      setActiveHandler?.(eventFrom(trustedRenderer), {
        id: (created as { id: string }).id,
      })
    ).resolves.toEqual(created);
  });

  it.each([undefined, null, "workspace-a", {}, { id: 42 }, { id: "" }, { id: " a " }])(
    "rejects a malformed active Workspace payload: %j",
    async (payload) => {
      const { handlers, trustedRenderer } = createHarness();
      const handler = handlers.get(WORKSPACE_SET_ACTIVE_CHANNEL);

      await expect(handler?.(eventFrom(trustedRenderer), payload)).rejects.toThrow(TypeError);
    }
  );

  it("rejects an untrusted active Workspace sender", async () => {
    const { handlers } = createHarness();
    const untrustedRenderer = { isDestroyed: () => false } as WebContents;
    const handler = handlers.get(WORKSPACE_GET_ACTIVE_CHANNEL);

    await expect(handler?.(eventFrom(untrustedRenderer))).rejects.toBeInstanceOf(
      UntrustedRendererError
    );
  });

  it.each([WORKSPACE_RENAME_CHANNEL, WORKSPACE_DELETE_CHANNEL])(
    "rejects an untrusted sender on %s",
    async (channel) => {
      const { handlers } = createHarness();
      const untrustedRenderer = { isDestroyed: () => false } as WebContents;

      await expect(
        handlers.get(channel)?.(eventFrom(untrustedRenderer), { id: "workspace-a", name: "Neu" })
      ).rejects.toBeInstanceOf(UntrustedRendererError);
    }
  );
});
