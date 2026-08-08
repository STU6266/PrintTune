import type { Printer } from "@printtune/contracts";
import { createPrinter } from "@printtune/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PrinterRepository } from "../src/printer-repository";

const FIRST = "2026-08-08T10:00:00.000Z";
const SECOND = "2026-08-09T10:00:00.000Z";

export interface PrinterRepositoryFixture {
  readonly repository: PrinterRepository;
  readonly close: () => void | Promise<void>;
}

function printer(id: string, workspaceId = "workspace-a", createdAt = FIRST, name = id): Printer {
  return createPrinter({ id, workspaceId, name, timestamp: createdAt });
}

export function describePrinterRepository(
  name: string,
  createFixture: () => PrinterRepositoryFixture | Promise<PrinterRepositoryFixture>
): void {
  describe(name, () => {
    let fixture: PrinterRepositoryFixture;

    beforeEach(async () => {
      fixture = await createFixture();
    });
    afterEach(async () => fixture.close());

    it("returns undefined for a missing Printer", async () => {
      await expect(fixture.repository.findById("missing")).resolves.toBeUndefined();
    });

    it("saves and finds a Printer", async () => {
      const value = printer("printer-a");
      await fixture.repository.save(value);
      await expect(fixture.repository.findById(value.id)).resolves.toEqual(value);
    });

    it("replaces the complete Printer under the same ID", async () => {
      await fixture.repository.save(printer("printer-a"));
      const replacement = printer("printer-a", "workspace-b", SECOND, "Umbenannt");
      await fixture.repository.save(replacement);
      await expect(fixture.repository.findById("printer-a")).resolves.toEqual(replacement);
    });

    it("lists only the requested Workspace in deterministic order", async () => {
      const tiedSecond = printer("printer-b");
      const later = printer("printer-c", "workspace-a", SECOND);
      const tiedFirst = printer("printer-a");
      await fixture.repository.save(later);
      await fixture.repository.save(tiedSecond);
      await fixture.repository.save(printer("printer-other", "workspace-b"));
      await fixture.repository.save(tiedFirst);

      await expect(fixture.repository.listByWorkspaceId("workspace-a")).resolves.toEqual([
        tiedFirst,
        tiedSecond,
        later,
      ]);
    });

    it.each(["Prüfer 日本語 🖨️", `O'Reillys "Drucker"`, "'); DROP TABLE printers; --"])(
      "stores names safely: %s",
      async (nameValue) => {
        const value = printer("printer-a", "workspace-a", FIRST, nameValue);
        await fixture.repository.save(value);
        await expect(fixture.repository.findById(value.id)).resolves.toEqual(value);
      }
    );

    it("deletes existing and reports missing Printers", async () => {
      await fixture.repository.save(printer("printer-a"));
      await expect(fixture.repository.delete("printer-a")).resolves.toBe(true);
      await expect(fixture.repository.delete("printer-a")).resolves.toBe(false);
    });

    it("uses defensive copies for saved and returned values", async () => {
      const value = printer("printer-a");
      await fixture.repository.save(value);
      (value as { name: string }).name = "Extern";
      const found = await fixture.repository.findById("printer-a");
      (found as { name: string }).name = "Fund";
      const listed = await fixture.repository.listByWorkspaceId("workspace-a");
      (listed[0] as { name: string }).name = "Liste";

      await expect(fixture.repository.findById("printer-a")).resolves.toMatchObject({
        name: "printer-a",
      });
    });
  });
}
