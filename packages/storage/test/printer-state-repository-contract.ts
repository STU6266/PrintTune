import type { PrinterState } from "@printtune/contracts";
import { createPrinterState } from "@printtune/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DuplicatePrinterStateError } from "../src/printer-state-repository";
import type { PrinterStateRepository } from "../src/printer-state-repository";

const FIRST = "2026-08-08T10:00:00.000Z";
const SECOND = "2026-08-09T10:00:00.000Z";

export interface PrinterStateRepositoryFixture {
  readonly repository: PrinterStateRepository;
  readonly close: () => void | Promise<void>;
}

function state(id: string, printerId = "printer-a", createdAt = FIRST): PrinterState {
  return createPrinterState({ id, printerId, timestamp: createdAt });
}

export function describePrinterStateRepository(
  name: string,
  createFixture: () => PrinterStateRepositoryFixture | Promise<PrinterStateRepositoryFixture>
): void {
  describe(name, () => {
    let fixture: PrinterStateRepositoryFixture;
    beforeEach(async () => {
      fixture = await createFixture();
    });
    afterEach(async () => fixture.close());

    it("returns undefined for a missing state", async () => {
      await expect(fixture.repository.findById("missing")).resolves.toBeUndefined();
    });

    it("creates and finds a state", async () => {
      const value = state("state-a");
      await fixture.repository.create(value);
      await expect(fixture.repository.findById(value.id)).resolves.toEqual(value);
    });

    it("lists only one Printer's states by createdAt then ID", async () => {
      const tiedSecond = state("state-b");
      const later = state("state-c", "printer-a", SECOND);
      const tiedFirst = state("state-a");
      await fixture.repository.create(later);
      await fixture.repository.create(tiedSecond);
      await fixture.repository.create(state("state-other", "printer-b"));
      await fixture.repository.create(tiedFirst);

      await expect(fixture.repository.listByPrinterId("printer-a")).resolves.toEqual([
        tiedFirst,
        tiedSecond,
        later,
      ]);
    });

    it("rejects duplicate IDs without replacing the original state", async () => {
      const original = state("state-a");
      await fixture.repository.create(original);

      await expect(
        fixture.repository.create(state("state-a", "printer-b", SECOND))
      ).rejects.toBeInstanceOf(DuplicatePrinterStateError);
      await expect(fixture.repository.findById("state-a")).resolves.toEqual(original);
    });

    it("uses defensive copies for input and returned values", async () => {
      const value = { ...state("state-a") };
      await fixture.repository.create(value);
      (value as { printerId: string }).printerId = "changed-input";
      const found = await fixture.repository.findById("state-a");
      (found as { printerId: string }).printerId = "changed-result";
      const listed = await fixture.repository.listByPrinterId("printer-a");
      (listed[0] as { printerId: string }).printerId = "changed-list";

      await expect(fixture.repository.findById("state-a")).resolves.toMatchObject({
        printerId: "printer-a",
      });
    });
  });
}
