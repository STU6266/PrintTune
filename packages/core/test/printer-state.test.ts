import { describe, expect, it } from "vitest";

import {
  InvalidPrinterStateIdError,
  InvalidPrinterStatePrinterIdError,
  InvalidPrinterStateTimestampError,
  createPrinterState,
} from "../src/index";

const STATE_ID = "printer-state-001";
const PRINTER_ID = "printer-001";
const CREATED_AT = "2026-08-08T10:00:00.123Z";

describe("PrinterState", () => {
  it("creates a deterministic state from the exact supplied values", () => {
    expect(
      createPrinterState({ id: STATE_ID, printerId: PRINTER_ID, timestamp: CREATED_AT })
    ).toEqual({
      id: STATE_ID,
      printerId: PRINTER_ID,
      createdAt: CREATED_AT,
    });
  });

  it.each(["", " ", "\t\n"])("rejects an empty state ID: %j", (id) => {
    expect(() => createPrinterState({ id, printerId: PRINTER_ID, timestamp: CREATED_AT })).toThrow(
      InvalidPrinterStateIdError
    );
  });

  it.each([" printer-state-001", "printer-state-001 "])(
    "rejects a whitespace-padded state ID: %j",
    (id) => {
      expect(() =>
        createPrinterState({ id, printerId: PRINTER_ID, timestamp: CREATED_AT })
      ).toThrow(InvalidPrinterStateIdError);
    }
  );

  it.each(["", " ", "\t\n"])("rejects an empty Printer ID: %j", (printerId) => {
    expect(() => createPrinterState({ id: STATE_ID, printerId, timestamp: CREATED_AT })).toThrow(
      InvalidPrinterStatePrinterIdError
    );
  });

  it.each([" printer-001", "printer-001 "])(
    "rejects a whitespace-padded Printer ID: %j",
    (printerId) => {
      expect(() => createPrinterState({ id: STATE_ID, printerId, timestamp: CREATED_AT })).toThrow(
        InvalidPrinterStatePrinterIdError
      );
    }
  );

  it.each(["not-a-date", "2026-08-08", "2026-08-08T10:00:00.1234Z"])(
    "rejects a malformed timestamp: %j",
    (timestamp) => {
      expect(() => createPrinterState({ id: STATE_ID, printerId: PRINTER_ID, timestamp })).toThrow(
        InvalidPrinterStateTimestampError
      );
    }
  );

  it("rejects a non-UTC timestamp", () => {
    expect(() =>
      createPrinterState({
        id: STATE_ID,
        printerId: PRINTER_ID,
        timestamp: "2026-08-08T10:00:00+02:00",
      })
    ).toThrow(InvalidPrinterStateTimestampError);
  });

  it.each([
    "2026-02-30T10:00:00Z",
    "2026-04-31T10:00:00Z",
    "2025-02-29T10:00:00Z",
    "2026-13-01T10:00:00Z",
  ])("rejects an invalid calendar timestamp: %j", (timestamp) => {
    expect(() => createPrinterState({ id: STATE_ID, printerId: PRINTER_ID, timestamp })).toThrow(
      InvalidPrinterStateTimestampError
    );
  });

  it("accepts a valid leap-day timestamp", () => {
    expect(
      createPrinterState({
        id: STATE_ID,
        printerId: PRINTER_ID,
        timestamp: "2024-02-29T10:00:00Z",
      }).createdAt
    ).toBe("2024-02-29T10:00:00Z");
  });

  it("returns a frozen value without modifying its input", () => {
    const input = { id: STATE_ID, printerId: PRINTER_ID, timestamp: CREATED_AT };
    const inputSnapshot = { ...input };

    const state = createPrinterState(input);

    expect(Object.isFrozen(state)).toBe(true);
    expect(input).toEqual(inputSnapshot);
  });

  it("has only creation fields and no update semantics", () => {
    const state = createPrinterState({
      id: STATE_ID,
      printerId: PRINTER_ID,
      timestamp: CREATED_AT,
    });

    expect(Object.keys(state)).toEqual(["id", "printerId", "createdAt"]);
    expect(state).not.toHaveProperty("updatedAt");
  });
});
