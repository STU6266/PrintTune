import type { PrinterState } from "@printtune/contracts";
import { createPrinterState } from "@printtune/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PrinterStateSelectionOwnershipError,
  PrinterStateSelectionStateNotFoundError,
  type PrinterStateSelectionPersistence,
} from "../src/printer-state-selection-persistence";

const EARLY = "2026-08-09T10:00:00.000Z";
const LATE = "2026-08-09T11:00:00.000Z";

export interface PrinterStateSelectionFixture {
  readonly selection: PrinterStateSelectionPersistence;
  readonly createState: (state: PrinterState) => Promise<void>;
  readonly close: () => void | Promise<void>;
}

export function describePrinterStateSelectionPersistence(
  name: string,
  createFixture: () => PrinterStateSelectionFixture | Promise<PrinterStateSelectionFixture>
): void {
  describe(name, () => {
    let fixture: PrinterStateSelectionFixture;

    beforeEach(async () => {
      fixture = await createFixture();
    });
    afterEach(async () => fixture.close());

    it("returns undefined when no explicit selection exists", async () => {
      await expect(fixture.selection.getSelectedStateId("printer-a")).resolves.toBeUndefined();
    });

    it("uses only explicit selection even when another State is newer", async () => {
      const older = createPrinterState({ id: "state-a", printerId: "printer-a", timestamp: EARLY });
      const newer = createPrinterState({
        id: "state-b",
        printerId: "printer-a",
        parentPrinterStateId: older.id,
        timestamp: LATE,
      });
      await fixture.createState(older);
      await fixture.createState(newer);

      await fixture.selection.setSelectedState("printer-a", older.id);
      await expect(fixture.selection.getSelectedStateId("printer-a")).resolves.toBe(older.id);
      await fixture.selection.setSelectedState("printer-a", newer.id);
      await expect(fixture.selection.getSelectedStateId("printer-a")).resolves.toBe(newer.id);
    });

    it("rejects missing and cross-Printer State selections", async () => {
      const other = createPrinterState({
        id: "state-other",
        printerId: "printer-b",
        timestamp: EARLY,
      });
      await fixture.createState(other);

      await expect(
        fixture.selection.setSelectedState("printer-a", "missing")
      ).rejects.toBeInstanceOf(PrinterStateSelectionStateNotFoundError);
      await expect(
        fixture.selection.setSelectedState("printer-a", other.id)
      ).rejects.toBeInstanceOf(PrinterStateSelectionOwnershipError);
      await expect(fixture.selection.getSelectedStateId("printer-a")).resolves.toBeUndefined();
    });
  });
}
