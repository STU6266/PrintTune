import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";

import { describe, expect, it, vi } from "vitest";

import { registerPrinterTechnicalDataIpcHandlers } from "../src/main/printer-technical-data-ipc";
import { UntrustedRendererError } from "../src/main/trusted-renderer";
import {
  PRINTER_MANUAL_CLAIM_CREATE_CHANNEL,
  PRINTER_TECHNICAL_FIELDS_READ_CHANNEL,
} from "../src/shared/printer-technical-data-api";

type Handler = (event: IpcMainInvokeEvent, payload?: unknown) => Promise<unknown>;

function harness() {
  const handlers = new Map<string, Handler>();
  const handle = vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler));
  const service = {
    readTechnicalFields: vi.fn().mockResolvedValue([]),
    addManualClaim: vi.fn().mockResolvedValue([]),
  };
  const trusted = { isDestroyed: () => false } as WebContents;
  registerPrinterTechnicalDataIpcHandlers(
    { handle } as unknown as Pick<IpcMain, "handle">,
    service as never,
    () => trusted
  );
  return { handlers, handle, service, trusted };
}

const event = (sender: WebContents) => ({ sender }) as IpcMainInvokeEvent;

describe("Printer technical-data IPC boundary", () => {
  it("registers exactly two fixed channels", () => {
    const { handlers, handle } = harness();
    expect([...handlers.keys()]).toEqual([
      PRINTER_TECHNICAL_FIELDS_READ_CHANNEL,
      PRINTER_MANUAL_CLAIM_CREATE_CHANNEL,
    ]);
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it("accepts valid narrow requests", async () => {
    const { handlers, service, trusted } = harness();
    await handlers.get(PRINTER_TECHNICAL_FIELDS_READ_CHANNEL)?.(event(trusted), {
      printerId: "printer-a",
    });
    const input = {
      printerId: "printer-a",
      field: "extruderType",
      value: "direct-drive",
      confirmation: "uncertain",
    };
    await handlers.get(PRINTER_MANUAL_CLAIM_CREATE_CHANNEL)?.(event(trusted), input);
    expect(service.readTechnicalFields).toHaveBeenCalledWith("printer-a");
    expect(service.addManualClaim).toHaveBeenCalledWith(input);
  });

  it.each([
    undefined,
    {},
    { printerId: " printer-a " },
    { printerId: "printer-a", stateId: "state-a" },
  ])("rejects invalid read payload %j", async (payload) => {
    const { handlers, trusted } = harness();
    await expect(
      handlers.get(PRINTER_TECHNICAL_FIELDS_READ_CHANNEL)?.(event(trusted), payload)
    ).rejects.toThrow(TypeError);
  });

  it.each([
    undefined,
    { printerId: "printer-a", field: "firmwareType", value: "klipper", confirmation: "confirmed" },
    { printerId: "printer-a", field: "nozzleDiameter", value: 0.6, confirmation: "certain" },
    {
      printerId: "printer-a",
      field: "nozzleDiameter",
      value: 0.6,
      confirmation: "confirmed",
      provenance: "user_confirmed",
    },
  ])("rejects invalid create payload %j", async (payload) => {
    const { handlers, trusted } = harness();
    await expect(
      handlers.get(PRINTER_MANUAL_CLAIM_CREATE_CHANNEL)?.(event(trusted), payload)
    ).rejects.toThrow(TypeError);
  });

  it.each([PRINTER_TECHNICAL_FIELDS_READ_CHANNEL, PRINTER_MANUAL_CLAIM_CREATE_CHANNEL])(
    "rejects an untrusted sender on %s",
    async (channel) => {
      const { handlers } = harness();
      const untrusted = { isDestroyed: () => false } as WebContents;
      await expect(
        handlers.get(channel)?.(event(untrusted), { printerId: "printer-a" })
      ).rejects.toBeInstanceOf(UntrustedRendererError);
    }
  );
});
