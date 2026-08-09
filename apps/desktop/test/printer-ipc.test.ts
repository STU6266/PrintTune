import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";

import { describe, expect, it, vi } from "vitest";

import { UntrustedRendererError } from "../src/main/trusted-renderer";
import { registerPrinterIpcHandlers } from "../src/main/printer-ipc";
import {
  PRINTER_CREATE_CHANNEL,
  PRINTER_GET_DETAIL_CHANNEL,
  PRINTER_LIST_CHANNEL,
} from "../src/shared/printer-api";

type Handler = (event: IpcMainInvokeEvent, payload?: unknown) => Promise<unknown>;

function harness() {
  const handlers = new Map<string, Handler>();
  const handle = vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler));
  const service = {
    listPrinters: vi.fn().mockResolvedValue({ activeWorkspace: undefined, printers: [] }),
    createPrinter: vi.fn().mockResolvedValue({}),
    getPrinterDetail: vi.fn().mockResolvedValue({}),
  };
  const trusted = { isDestroyed: () => false } as WebContents;
  registerPrinterIpcHandlers(
    { handle } as unknown as Pick<IpcMain, "handle">,
    service as never,
    () => trusted
  );
  return { handlers, handle, service, trusted };
}

const event = (sender: WebContents) => ({ sender }) as IpcMainInvokeEvent;

describe("Printer IPC boundary", () => {
  it("registers exactly three fixed channels", () => {
    const { handlers, handle } = harness();
    expect([...handlers.keys()]).toEqual([
      PRINTER_LIST_CHANNEL,
      PRINTER_CREATE_CHANNEL,
      PRINTER_GET_DETAIL_CHANNEL,
    ]);
    expect(handle).toHaveBeenCalledTimes(3);
  });

  it("accepts only narrow valid inputs", async () => {
    const { handlers, service, trusted } = harness();
    await handlers.get(PRINTER_CREATE_CHANNEL)?.(event(trusted), { name: "Voron" });
    await handlers.get(PRINTER_GET_DETAIL_CHANNEL)?.(event(trusted), { id: "printer-a" });
    expect(service.createPrinter).toHaveBeenCalledWith("Voron");
    expect(service.getPrinterDetail).toHaveBeenCalledWith("printer-a");
  });

  it.each([undefined, null, {}, { name: 42 }, { name: "Voron", id: "renderer-id" }])(
    "rejects malformed create payload %j",
    async (payload) => {
      const { handlers, trusted } = harness();
      await expect(handlers.get(PRINTER_CREATE_CHANNEL)?.(event(trusted), payload)).rejects.toThrow(
        TypeError
      );
    }
  );

  it.each([undefined, null, {}, { id: " printer-a " }, { id: "printer-a", sql: "SELECT" }])(
    "rejects malformed detail payload %j",
    async (payload) => {
      const { handlers, trusted } = harness();
      await expect(
        handlers.get(PRINTER_GET_DETAIL_CHANNEL)?.(event(trusted), payload)
      ).rejects.toThrow(TypeError);
    }
  );

  it.each([PRINTER_LIST_CHANNEL, PRINTER_CREATE_CHANNEL, PRINTER_GET_DETAIL_CHANNEL])(
    "rejects an untrusted sender on %s",
    async (channel) => {
      const { handlers } = harness();
      const untrusted = { isDestroyed: () => false } as WebContents;
      await expect(
        handlers.get(channel)?.(event(untrusted), { id: "printer-a" })
      ).rejects.toBeInstanceOf(UntrustedRendererError);
    }
  );
});
