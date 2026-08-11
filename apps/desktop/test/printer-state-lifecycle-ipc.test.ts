import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";

import { describe, expect, it, vi } from "vitest";

import { PrinterStateLifecycleApplicationError } from "../src/main/printer-state-lifecycle-application-service";
import { registerPrinterStateLifecycleIpcHandlers } from "../src/main/printer-state-lifecycle-ipc";
import { UntrustedRendererError } from "../src/main/trusted-renderer";
import {
  PRINTER_STATE_OVERVIEW_GET_CHANNEL,
  PRINTER_STATE_TRANSITION_CREATE_CHANNEL,
  PRINTER_STATE_TRANSITION_PREPARATION_GET_CHANNEL,
} from "../src/shared/printer-state-lifecycle-api";

type Handler = (event: IpcMainInvokeEvent, payload?: unknown) => Promise<unknown>;

const overview = {
  printerId: "printer-a",
  workingPrinterStateId: "state-a",
  states: [{ printerStateId: "state-a", createdAt: "2026-08-11T10:00:00Z", isWorking: true }],
} as const;
const preparation = {
  printerId: "printer-a",
  sourcePrinterStateId: "state-a",
  components: [],
  claimCarryChoices: [],
  reconfirmationFields: [],
} as const;
const command = {
  transitionCommandId: "command-a",
  printerId: "printer-a",
  expectedSourcePrinterStateId: "state-a",
  componentDecisions: [],
  claimCarryDecisions: [],
} as const;

function harness() {
  const handlers = new Map<string, Handler>();
  const handle = vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler));
  const service = {
    getPrinterStateOverview: vi.fn().mockResolvedValue(overview),
    getTransitionPreparation: vi.fn().mockResolvedValue(preparation),
    createPrinterStateTransition: vi.fn().mockResolvedValue({
      status: "created",
      printerId: "printer-a",
      sourcePrinterStateId: "state-a",
      targetPrinterStateId: "state-b",
    }),
  };
  const trusted = { isDestroyed: () => false } as WebContents;
  registerPrinterStateLifecycleIpcHandlers(
    { handle } as unknown as Pick<IpcMain, "handle">,
    service as never,
    () => trusted
  );
  return { handlers, handle, service, trusted };
}

const event = (sender: WebContents) => ({ sender }) as IpcMainInvokeEvent;

describe("PrinterState lifecycle IPC boundary", () => {
  it("registers exactly three fixed channels", () => {
    const { handlers, handle } = harness();
    expect([...handlers.keys()]).toEqual([
      PRINTER_STATE_OVERVIEW_GET_CHANNEL,
      PRINTER_STATE_TRANSITION_PREPARATION_GET_CHANNEL,
      PRINTER_STATE_TRANSITION_CREATE_CHANNEL,
    ]);
    expect(handle).toHaveBeenCalledTimes(3);
  });

  it("delegates valid requests without accepting renderer authority", async () => {
    const { handlers, service, trusted } = harness();
    await expect(
      handlers.get(PRINTER_STATE_OVERVIEW_GET_CHANNEL)?.(event(trusted), { printerId: "printer-a" })
    ).resolves.toEqual({ ok: true, value: overview });
    await expect(
      handlers.get(PRINTER_STATE_TRANSITION_PREPARATION_GET_CHANNEL)?.(event(trusted), {
        printerId: "printer-a",
      })
    ).resolves.toEqual({ ok: true, value: preparation });
    await handlers.get(PRINTER_STATE_TRANSITION_CREATE_CHANNEL)?.(event(trusted), command);
    expect(service.getPrinterStateOverview).toHaveBeenCalledWith("printer-a");
    expect(service.getTransitionPreparation).toHaveBeenCalledWith("printer-a");
    expect(service.createPrinterStateTransition).toHaveBeenCalledWith(command);
  });

  it.each([
    [PRINTER_STATE_OVERVIEW_GET_CHANNEL, { printerId: "printer-a", databasePath: "/private" }],
    [PRINTER_STATE_TRANSITION_PREPARATION_GET_CHANNEL, { printerId: " printer-a " }],
    [PRINTER_STATE_TRANSITION_CREATE_CHANNEL, { ...command, targetPrinterStateId: "state-b" }],
  ])("returns invalid_request for malformed payload on %s", async (channel, payload) => {
    const { handlers, service, trusted } = harness();
    await expect(handlers.get(channel)?.(event(trusted), payload)).resolves.toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(service.getPrinterStateOverview).not.toHaveBeenCalled();
    expect(service.getTransitionPreparation).not.toHaveBeenCalled();
    expect(service.createPrinterStateTransition).not.toHaveBeenCalled();
  });

  it.each([
    PRINTER_STATE_OVERVIEW_GET_CHANNEL,
    PRINTER_STATE_TRANSITION_PREPARATION_GET_CHANNEL,
    PRINTER_STATE_TRANSITION_CREATE_CHANNEL,
  ])("rejects an untrusted sender on %s", async (channel) => {
    const { handlers } = harness();
    const untrusted = { isDestroyed: () => false } as WebContents;
    await expect(
      handlers.get(channel)?.(
        event(untrusted),
        channel === PRINTER_STATE_TRANSITION_CREATE_CHANNEL ? command : { printerId: "printer-a" }
      )
    ).rejects.toBeInstanceOf(UntrustedRendererError);
  });

  it.each([
    ["stale_transition_context", "stale_transition_context"],
    ["command_conflict", "command_conflict"],
    ["invalid_component_decisions", "invalid_component_decisions"],
    ["invalid_claim_decision", "invalid_claim_decisions"],
  ] as const)("maps %s to the safe error %s", async (serviceCode, apiCode) => {
    const { handlers, service, trusted } = harness();
    service.createPrinterStateTransition.mockRejectedValueOnce(
      new PrinterStateLifecycleApplicationError(serviceCode)
    );
    await expect(
      handlers.get(PRINTER_STATE_TRANSITION_CREATE_CHANNEL)?.(event(trusted), command)
    ).resolves.toEqual({ ok: false, error: apiCode });
  });

  it("returns already_completed through the normal success result", async () => {
    const { handlers, service, trusted } = harness();
    const result = {
      status: "already_completed",
      printerId: "printer-a",
      sourcePrinterStateId: "state-a",
      targetPrinterStateId: "state-b",
    } as const;
    service.createPrinterStateTransition.mockResolvedValueOnce(result);
    await expect(
      handlers.get(PRINTER_STATE_TRANSITION_CREATE_CHANNEL)?.(event(trusted), command)
    ).resolves.toEqual({ ok: true, value: result });
  });

  it("does not leak unexpected errors or malformed service results", async () => {
    const { handlers, service, trusted } = harness();
    service.createPrinterStateTransition.mockRejectedValueOnce(new Error("database path /private"));
    await expect(
      handlers.get(PRINTER_STATE_TRANSITION_CREATE_CHANNEL)?.(event(trusted), command)
    ).resolves.toEqual({ ok: false, error: "internal_failure" });
    service.getPrinterStateOverview.mockResolvedValueOnce({ ...overview, connection: "raw" });
    await expect(
      handlers.get(PRINTER_STATE_OVERVIEW_GET_CHANNEL)?.(event(trusted), { printerId: "printer-a" })
    ).resolves.toEqual({ ok: false, error: "read_failed" });
  });
});
