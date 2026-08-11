import { describe, expect, it, vi } from "vitest";

import {
  PRINTER_CREATE_CHANNEL,
  PRINTER_GET_DETAIL_CHANNEL,
  PRINTER_LIST_CHANNEL,
  createPrinterApi,
} from "../src/shared/printer-api";

const WORKSPACE = {
  id: "workspace-a",
  name: "Werkstatt",
  createdAt: "2026-08-09T10:00:00.000Z",
  updatedAt: "2026-08-09T10:00:00.000Z",
};
const PRINTER = {
  id: "printer-a",
  workspaceId: WORKSPACE.id,
  name: "Voron",
  createdAt: WORKSPACE.createdAt,
  updatedAt: WORKSPACE.updatedAt,
};
const DETAIL = {
  printer: PRINTER,
  workingState: { id: "state-a", printerId: PRINTER.id, createdAt: PRINTER.createdAt },
};

describe("Printer preload API", () => {
  it("uses only fixed channels and narrow payloads", async () => {
    const invoke = vi.fn(async (channel: string) =>
      channel === PRINTER_LIST_CHANNEL
        ? { activeWorkspace: WORKSPACE, printers: [PRINTER] }
        : DETAIL
    );
    const api = createPrinterApi(invoke);

    await api.listPrinters();
    await api.createPrinter("Voron");
    await api.getPrinterDetail(PRINTER.id);

    expect(invoke.mock.calls).toEqual([
      [PRINTER_LIST_CHANNEL],
      [PRINTER_CREATE_CHANNEL, { name: "Voron" }],
      [PRINTER_GET_DETAIL_CHANNEL, { id: PRINTER.id }],
    ]);
  });

  it.each([
    null,
    { activeWorkspace: undefined, printers: null },
    { activeWorkspace: WORKSPACE, printers: [{ ...PRINTER, createdAt: "2026-02-30T10:00:00Z" }] },
  ])("rejects malformed list responses: %j", async (response) => {
    await expect(createPrinterApi(async () => response).listPrinters()).rejects.toThrow(TypeError);
  });

  it("validates and freezes renderer-safe detail results", async () => {
    const detail = await createPrinterApi(async () => DETAIL).getPrinterDetail(PRINTER.id);
    expect(detail).toEqual(DETAIL);
    expect(Object.isFrozen(detail)).toBe(true);
    expect(Object.isFrozen(detail.printer)).toBe(true);
  });

  it("rejects malformed IDs, names, and mismatched state results before exposure", async () => {
    const invoke = vi.fn().mockResolvedValue({
      ...DETAIL,
      workingState: { ...DETAIL.workingState, printerId: "another" },
    });
    const api = createPrinterApi(invoke);

    await expect(api.getPrinterDetail(" printer-a ")).rejects.toThrow(TypeError);
    await expect(api.createPrinter(42 as never)).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
    await expect(api.getPrinterDetail(PRINTER.id)).rejects.toThrow(TypeError);
  });
});
