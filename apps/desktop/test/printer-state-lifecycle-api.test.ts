import { describe, expect, it, vi } from "vitest";

import {
  PRINTER_STATE_OVERVIEW_GET_CHANNEL,
  PRINTER_STATE_TRANSITION_CREATE_CHANNEL,
  PRINTER_STATE_TRANSITION_PREPARATION_GET_CHANNEL,
  PrinterStateLifecycleApiError,
  createPrinterStateLifecycleApi,
} from "../src/shared/printer-state-lifecycle-api";

const overview = {
  printerId: "printer-a",
  workingPrinterStateId: "state-a",
  states: [{ printerStateId: "state-a", createdAt: "2026-08-11T10:00:00Z", isWorking: true }],
} as const;

const preparation = {
  printerId: "printer-a",
  sourcePrinterStateId: "state-a",
  components: [
    {
      componentInstallationId: "component-a",
      role: "toolhead.hotend",
      kind: "hotend",
      displayName: "Hotend",
    },
  ],
  claimCarryChoices: [
    {
      sourceClaimId: "claim-a",
      fieldPath: "printer.nozzle.diameter",
      value: { type: "number", value: 0.4 },
      unit: "mm",
      disposition: "auto_carry",
    },
  ],
  reconfirmationFields: [],
} as const;

const command = {
  transitionCommandId: "command-a",
  printerId: "printer-a",
  expectedSourcePrinterStateId: "state-a",
  componentDecisions: [{ componentInstallationId: "component-a", action: "retain" }],
  claimCarryDecisions: [{ sourceClaimId: "claim-a", applicabilityConfirmed: true }],
} as const;

describe("PrinterState lifecycle preload API", () => {
  it("uses only the three fixed channels with closed payloads", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: overview })
      .mockResolvedValueOnce({ ok: true, value: preparation })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          status: "created",
          printerId: "printer-a",
          sourcePrinterStateId: "state-a",
          targetPrinterStateId: "state-b",
        },
      });
    const api = createPrinterStateLifecycleApi(invoke);

    await api.getPrinterStateOverview({ printerId: "printer-a" });
    await api.getPrinterStateTransitionPreparation({ printerId: "printer-a" });
    await api.createPrinterStateTransition(command);

    expect(invoke.mock.calls).toEqual([
      [PRINTER_STATE_OVERVIEW_GET_CHANNEL, { printerId: "printer-a" }],
      [PRINTER_STATE_TRANSITION_PREPARATION_GET_CHANNEL, { printerId: "printer-a" }],
      [PRINTER_STATE_TRANSITION_CREATE_CHANNEL, command],
    ]);
    expect(Object.isFrozen(api)).toBe(true);
  });

  it("accepts created and already-completed transition results", async () => {
    for (const status of ["created", "already_completed"] as const) {
      const api = createPrinterStateLifecycleApi(async () => ({
        ok: true,
        value: {
          status,
          printerId: "printer-a",
          sourcePrinterStateId: "state-a",
          targetPrinterStateId: "state-b",
        },
      }));
      await expect(api.createPrinterStateTransition(command)).resolves.toMatchObject({ status });
    }
  });

  it("surfaces only the closed safe error code", async () => {
    const api = createPrinterStateLifecycleApi(async () => ({
      ok: false,
      error: "stale_transition_context",
    }));
    await expect(api.getPrinterStateOverview({ printerId: "printer-a" })).rejects.toEqual(
      expect.objectContaining<Partial<PrinterStateLifecycleApiError>>({
        name: "PrinterStateLifecycleApiError",
        code: "stale_transition_context",
      })
    );
  });

  it.each([
    { ...overview, repositoryPath: "/private/database" },
    { ...overview, states: [{ ...overview.states[0], printerId: "printer-a" }] },
    { ...overview, states: [{ ...overview.states[0], isWorking: false }] },
  ])("rejects unsafe overview response %#", async (value) => {
    const api = createPrinterStateLifecycleApi(async () => ({ ok: true, value }));
    await expect(api.getPrinterStateOverview({ printerId: "printer-a" })).rejects.toThrow(
      TypeError
    );
  });

  it.each([
    { ...preparation, components: [{ ...preparation.components[0], definitionRef: "secret" }] },
    {
      ...preparation,
      claimCarryChoices: [{ ...preparation.claimCarryChoices[0], trust: "verified" }],
    },
    {
      ...preparation,
      claimCarryChoices: [{ ...preparation.claimCarryChoices[0], confidence: "high" }],
    },
    {
      ...preparation,
      claimCarryChoices: [{ ...preparation.claimCarryChoices[0], provenance: { source: "raw" } }],
    },
    {
      ...preparation,
      claimCarryChoices: [
        {
          ...preparation.claimCarryChoices[0],
          packageId: "package-a",
          packageVersion: "1.0.0",
          factId: "fact-a",
        },
      ],
    },
    {
      ...preparation,
      reconfirmationFields: [
        {
          fieldPath: "printer.nozzle.diameter",
          value: { type: "number", value: 0.4 },
          provenance: "private",
        },
      ],
    },
  ])("rejects unsafe preparation response %#", async (value) => {
    const api = createPrinterStateLifecycleApi(async () => ({ ok: true, value }));
    await expect(
      api.getPrinterStateTransitionPreparation({ printerId: "printer-a" })
    ).rejects.toThrow(TypeError);
  });

  it.each([
    { claimIds: ["claim-b"] },
    { componentInstallationIds: ["component-b"] },
    { command: { id: "command-a" } },
    { createdAt: "2026-08-11T10:00:00Z" },
  ])("rejects unsafe transition result fields %#", async (extra) => {
    const api = createPrinterStateLifecycleApi(async () => ({
      ok: true,
      value: {
        status: "created",
        printerId: "printer-a",
        sourcePrinterStateId: "state-a",
        targetPrinterStateId: "state-b",
        ...extra,
      },
    }));
    await expect(api.createPrinterStateTransition(command)).rejects.toThrow(TypeError);
  });

  it("rejects extra command authority before invoking Main", async () => {
    const invoke = vi.fn();
    const api = createPrinterStateLifecycleApi(invoke);
    await expect(
      api.createPrinterStateTransition({
        ...command,
        targetPrinterStateId: "renderer-chosen",
      } as never)
    ).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });
});
