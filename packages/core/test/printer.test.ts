import { describe, expect, it } from "vitest";

import {
  InvalidPrinterIdError,
  InvalidPrinterNameError,
  InvalidPrinterTimestampError,
  InvalidPrinterWorkspaceIdError,
  createPrinter,
  renamePrinter,
} from "../src/index";

const PRINTER_ID = "printer-001";
const WORKSPACE_ID = "workspace-001";
const CREATED_AT = "2026-08-08T10:00:00.000Z";
const UPDATED_AT = "2026-08-09T12:30:00.000Z";

describe("Printer", () => {
  it("creates a deterministic Printer with the exact supplied IDs", () => {
    expect(
      createPrinter({
        id: PRINTER_ID,
        workspaceId: WORKSPACE_ID,
        name: "Werkstattdrucker",
        timestamp: CREATED_AT,
      })
    ).toEqual({
      id: PRINTER_ID,
      workspaceId: WORKSPACE_ID,
      name: "Werkstattdrucker",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
  });

  it("trims the Printer name without mutating the input", () => {
    const input = {
      id: PRINTER_ID,
      workspaceId: WORKSPACE_ID,
      name: "  Mein Drucker  ",
      timestamp: CREATED_AT,
    };

    expect(createPrinter(input).name).toBe("Mein Drucker");
    expect(input.name).toBe("  Mein Drucker  ");
  });

  it.each(["", " ", " printer-001", "printer-001 "])("rejects an invalid Printer ID: %j", (id) => {
    expect(() =>
      createPrinter({ id, workspaceId: WORKSPACE_ID, name: "Drucker", timestamp: CREATED_AT })
    ).toThrow(InvalidPrinterIdError);
  });

  it.each(["", " ", " workspace-001", "workspace-001 "])(
    "rejects an invalid Workspace ID: %j",
    (workspaceId) => {
      expect(() =>
        createPrinter({ id: PRINTER_ID, workspaceId, name: "Drucker", timestamp: CREATED_AT })
      ).toThrow(InvalidPrinterWorkspaceIdError);
    }
  );

  it.each(["", " ", "\t\n"])("rejects an empty Printer name: %j", (name) => {
    expect(() =>
      createPrinter({ id: PRINTER_ID, workspaceId: WORKSPACE_ID, name, timestamp: CREATED_AT })
    ).toThrow(InvalidPrinterNameError);
  });

  it.each(["not-a-date", "2026-08-08T10:00:00+02:00", "2026-08-08"])(
    "rejects an invalid timestamp: %j",
    (timestamp) => {
      expect(() =>
        createPrinter({ id: PRINTER_ID, workspaceId: WORKSPACE_ID, name: "Drucker", timestamp })
      ).toThrow(InvalidPrinterTimestampError);
    }
  );

  it.each(["2026-08-08T10:00:00Z", "2024-02-29T10:00:00.12Z"])(
    "accepts valid calendar timestamp %s",
    (timestamp) => {
      expect(
        createPrinter({
          id: PRINTER_ID,
          workspaceId: WORKSPACE_ID,
          name: "Drucker",
          timestamp,
        }).createdAt
      ).toBe(timestamp);
    }
  );

  it.each(["2026-02-30T10:00:00Z", "2026-04-31T10:00:00Z", "2025-02-29T10:00:00Z"])(
    "rejects invalid calendar timestamp without normalization: %s",
    (timestamp) => {
      expect(() =>
        createPrinter({
          id: PRINTER_ID,
          workspaceId: WORKSPACE_ID,
          name: "Drucker",
          timestamp,
        })
      ).toThrow(InvalidPrinterTimestampError);
    }
  );

  it("renames to a trimmed name without mutating the original Printer", () => {
    const printer = createPrinter({
      id: PRINTER_ID,
      workspaceId: WORKSPACE_ID,
      name: "Vorher",
      timestamp: CREATED_AT,
    });
    const originalSnapshot = { ...printer };

    const renamed = renamePrinter(printer, "  Nachher  ", UPDATED_AT);

    expect(renamed).not.toBe(printer);
    expect(printer).toEqual(originalSnapshot);
    expect(renamed).toEqual({
      id: PRINTER_ID,
      workspaceId: WORKSPACE_ID,
      name: "Nachher",
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });
  });

  it("validates the new name and timestamp when renaming", () => {
    const printer = createPrinter({
      id: PRINTER_ID,
      workspaceId: WORKSPACE_ID,
      name: "Vorher",
      timestamp: CREATED_AT,
    });

    expect(() => renamePrinter(printer, "   ", UPDATED_AT)).toThrow(InvalidPrinterNameError);
    expect(() => renamePrinter(printer, "Nachher", "invalid")).toThrow(
      InvalidPrinterTimestampError
    );
  });
});
