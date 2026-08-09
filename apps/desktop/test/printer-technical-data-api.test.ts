import { describe, expect, it, vi } from "vitest";

import {
  PRINTER_MANUAL_CLAIM_CREATE_CHANNEL,
  PRINTER_TECHNICAL_FIELDS_READ_CHANNEL,
  createPrinterTechnicalDataApi,
} from "../src/shared/printer-technical-data-api";

const SUMMARIES = [
  {
    field: "nozzleDiameter",
    status: "resolved",
    reasonCode: "single_claim",
    value: 0.6,
    unit: "mm",
  },
  { field: "extruderType", status: "missing", reasonCode: "no_usable_claims" },
  {
    field: "hotendMaxTemperature",
    status: "blocked",
    reasonCode: "insufficient_confirmation",
    unit: "degC",
  },
] as const;

describe("Printer technical-data preload API", () => {
  it("uses only the two fixed channels with narrow payloads", async () => {
    const invoke = vi.fn().mockResolvedValue(SUMMARIES);
    const api = createPrinterTechnicalDataApi(invoke);
    await api.readPrinterTechnicalFields("printer-a");
    await api.addManualPrinterTechnicalClaim({
      printerId: "printer-a",
      field: "nozzleDiameter",
      value: 0.6,
      confirmation: "confirmed",
    });
    expect(invoke.mock.calls).toEqual([
      [PRINTER_TECHNICAL_FIELDS_READ_CHANNEL, { printerId: "printer-a" }],
      [
        PRINTER_MANUAL_CLAIM_CREATE_CHANNEL,
        { printerId: "printer-a", field: "nozzleDiameter", value: 0.6, confirmation: "confirmed" },
      ],
    ]);
  });

  it("rejects unsupported fields and renderer-controlled authority properties", async () => {
    const invoke = vi.fn();
    const api = createPrinterTechnicalDataApi(invoke);
    await expect(
      api.addManualPrinterTechnicalClaim({
        printerId: "printer-a",
        field: "firmwareType" as never,
        value: "klipper",
        confirmation: "confirmed",
      })
    ).rejects.toThrow(TypeError);
    await expect(
      api.addManualPrinterTechnicalClaim({
        printerId: "printer-a",
        field: "nozzleDiameter",
        value: 0.6,
        confirmation: "confirmed",
        trust: "developer_verified",
      } as never)
    ).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    SUMMARIES.slice(0, 2),
    [{ ...SUMMARIES[0], sql: "SELECT" }, SUMMARIES[1], SUMMARIES[2]],
    [{ ...SUMMARIES[0], status: "resolved", value: undefined }, SUMMARIES[1], SUMMARIES[2]],
  ])("rejects malformed summary response %#", async (response) => {
    await expect(
      createPrinterTechnicalDataApi(async () => response).readPrinterTechnicalFields("printer-a")
    ).rejects.toThrow(TypeError);
  });
});
