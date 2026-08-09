import type { PrinterKnowledgeIdentity } from "@printtune/contracts";
import { createPrinterKnowledgeIdentity } from "@printtune/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DuplicatePrinterKnowledgeIdentityError,
  type PrinterKnowledgeIdentityRepository,
} from "../src/printer-knowledge-identity-repository";

const FIRST = "2026-08-08T10:00:00.000Z";
const SECOND = "2026-08-09T10:00:00.000Z";

export interface PrinterKnowledgeIdentityRepositoryFixture {
  readonly repository: PrinterKnowledgeIdentityRepository;
  readonly close: () => void | Promise<void>;
}

export function knownIdentity(
  id: string,
  printerId = "printer-a",
  selectedAt = FIRST,
  model = false,
  displayNames?: { manufacturer: string; series: string; model?: string }
): PrinterKnowledgeIdentity {
  return createPrinterKnowledgeIdentity({
    id,
    printerId,
    kind: "known",
    definitionRef: {
      packageId: "org.printtune.printers",
      packageVersion: "release/2026-alpha+opaque",
      seriesDefinitionId: "series-1",
      ...(model ? { modelDefinitionId: "model-1" } : {}),
    },
    manufacturerDisplayName: displayNames?.manufacturer ?? "Hersteller",
    seriesDisplayName: displayNames?.series ?? "Serie",
    ...(model ? { modelDisplayName: displayNames?.model ?? "Modell" } : {}),
    selectedAt,
  });
}

export function unclassifiedIdentity(
  id: string,
  printerId = "printer-a",
  selectedAt = FIRST
): PrinterKnowledgeIdentity {
  return createPrinterKnowledgeIdentity({ id, printerId, kind: "unclassified", selectedAt });
}

export function describePrinterKnowledgeIdentityRepository(
  name: string,
  createFixture: () =>
    PrinterKnowledgeIdentityRepositoryFixture | Promise<PrinterKnowledgeIdentityRepositoryFixture>
): void {
  describe(name, () => {
    let fixture: PrinterKnowledgeIdentityRepositoryFixture;

    beforeEach(async () => {
      fixture = await createFixture();
    });
    afterEach(async () => fixture.close());

    it("starts empty", async () => {
      await expect(fixture.repository.findById("missing")).resolves.toBeUndefined();
      await expect(fixture.repository.listByPrinterId("printer-a")).resolves.toEqual([]);
    });

    it.each([
      ["known series", knownIdentity("identity-series")],
      ["known exact model", knownIdentity("identity-model", "printer-a", FIRST, true)],
      ["unclassified", unclassifiedIdentity("identity-unclassified")],
    ])("creates and reconstructs %s identities", async (_label, identity) => {
      await fixture.repository.create(identity);
      await expect(fixture.repository.findById(identity.id)).resolves.toEqual(identity);
    });

    it("filters history and orders by selectedAt then identity ID", async () => {
      const tiedSecond = knownIdentity("identity-b");
      const later = unclassifiedIdentity("identity-c", "printer-a", SECOND);
      const tiedFirst = unclassifiedIdentity("identity-a");
      await fixture.repository.create(later);
      await fixture.repository.create(tiedSecond);
      await fixture.repository.create(knownIdentity("identity-other", "printer-b"));
      await fixture.repository.create(tiedFirst);

      await expect(fixture.repository.listByPrinterId("printer-a")).resolves.toEqual([
        tiedFirst,
        tiedSecond,
        later,
      ]);
    });

    it("rejects duplicate IDs and preserves the historical record", async () => {
      const original = knownIdentity("identity-a");
      await fixture.repository.create(original);
      await expect(
        fixture.repository.create(unclassifiedIdentity("identity-a", "printer-b", SECOND))
      ).rejects.toBeInstanceOf(DuplicatePrinterKnowledgeIdentityError);
      await expect(fixture.repository.findById("identity-a")).resolves.toEqual(original);
    });

    it("keeps multiple correction records and opaque package versions", async () => {
      const first = knownIdentity("identity-a");
      const correction = knownIdentity("identity-b", "printer-a", SECOND, true);
      await fixture.repository.create(first);
      await fixture.repository.create(correction);
      await expect(fixture.repository.listByPrinterId("printer-a")).resolves.toEqual([
        first,
        correction,
      ]);
      await expect(fixture.repository.findById("identity-a")).resolves.toMatchObject({
        definitionRef: { packageVersion: "release/2026-alpha+opaque" },
      });
    });

    it("uses deeply frozen defensive values", async () => {
      const mutable = structuredClone(knownIdentity("identity-a", "printer-a", FIRST, true)) as {
        manufacturerDisplayName: string;
        definitionRef: { packageVersion: string };
      } & PrinterKnowledgeIdentity;
      await fixture.repository.create(mutable);
      mutable.manufacturerDisplayName = "Changed input";
      mutable.definitionRef.packageVersion = "changed";

      const found = await fixture.repository.findById("identity-a");
      expect(Object.isFrozen(found)).toBe(true);
      expect(Object.isFrozen(found?.kind === "known" ? found.definitionRef : undefined)).toBe(true);
      expect(() => {
        if (found?.kind === "known") {
          (found as { manufacturerDisplayName: string }).manufacturerDisplayName = "Changed";
        }
      }).toThrow();
      await expect(fixture.repository.findById("identity-a")).resolves.toMatchObject({
        manufacturerDisplayName: "Hersteller",
        definitionRef: { packageVersion: "release/2026-alpha+opaque" },
      });
    });
  });
}
