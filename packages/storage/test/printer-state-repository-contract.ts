import type { PrinterState } from "@printtune/contracts";
import { createPrinterState } from "@printtune/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DuplicatePrinterStateError } from "../src/printer-state-repository";
import {
  PrinterStateParentNotFoundError,
  PrinterStateParentOwnershipError,
} from "../src/printer-state-repository";
import type { PrinterStateRepository } from "../src/printer-state-repository";

const FIRST = "2026-08-08T10:00:00.000Z";
const SECOND = "2026-08-09T10:00:00.000Z";

export interface PrinterStateRepositoryFixture {
  readonly repository: PrinterStateRepository;
  readonly close: () => void | Promise<void>;
}

function state(
  id: string,
  printerId = "printer-a",
  createdAt = FIRST,
  parentPrinterStateId?: string
): PrinterState {
  return createPrinterState({
    id,
    printerId,
    ...(parentPrinterStateId === undefined ? {} : { parentPrinterStateId }),
    timestamp: createdAt,
  });
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

    it("reconstructs exact same-Printer lineage and leaves the initial State parentless", async () => {
      const initial = state("state-initial");
      const child = state("state-child", "printer-a", SECOND, initial.id);
      await fixture.repository.create(initial);
      await fixture.repository.create(child);

      await expect(fixture.repository.findById(initial.id)).resolves.toEqual(initial);
      await expect(fixture.repository.findById(child.id)).resolves.toEqual(child);
    });

    it("does not permanently prohibit two stored children from sharing a parent", async () => {
      const initial = state("state-parent");
      const firstChild = state("state-child-a", "printer-a", SECOND, initial.id);
      const secondChild = state("state-child-b", "printer-a", SECOND, initial.id);
      await fixture.repository.create(initial);
      await fixture.repository.create(firstChild);
      await fixture.repository.create(secondChild);

      await expect(fixture.repository.findById(firstChild.id)).resolves.toEqual(firstChild);
      await expect(fixture.repository.findById(secondChild.id)).resolves.toEqual(secondChild);
    });

    it("rejects missing and cross-Printer parents without persisting the child", async () => {
      await expect(
        fixture.repository.create(state("missing-parent-child", "printer-a", SECOND, "missing"))
      ).rejects.toBeInstanceOf(PrinterStateParentNotFoundError);
      await fixture.repository.create(state("other-parent", "printer-b"));
      await expect(
        fixture.repository.create(state("cross-printer-child", "printer-a", SECOND, "other-parent"))
      ).rejects.toBeInstanceOf(PrinterStateParentOwnershipError);
      await expect(fixture.repository.findById("cross-printer-child")).resolves.toBeUndefined();
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
