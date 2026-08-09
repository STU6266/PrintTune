import type { PrinterKnowledgeIdentityRepository } from "../src/printer-knowledge-identity-repository";
import {
  PrinterKnowledgeIdentityNotFoundError,
  PrinterKnowledgeIdentityOwnershipError,
  type PrinterKnowledgeIdentitySelectionPersistence,
} from "../src/printer-knowledge-identity-selection-persistence";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  knownIdentity,
  unclassifiedIdentity,
} from "./printer-knowledge-identity-repository-contract";

export interface PrinterKnowledgeSelectionFixture {
  readonly repository: PrinterKnowledgeIdentityRepository;
  readonly selection: PrinterKnowledgeIdentitySelectionPersistence;
  readonly close: () => void | Promise<void>;
}

export function describePrinterKnowledgeIdentitySelection(
  name: string,
  createFixture: () => PrinterKnowledgeSelectionFixture | Promise<PrinterKnowledgeSelectionFixture>
): void {
  describe(name, () => {
    let fixture: PrinterKnowledgeSelectionFixture;
    beforeEach(async () => {
      fixture = await createFixture();
    });
    afterEach(async () => fixture.close());

    it("returns undefined with no current selection", async () => {
      await expect(fixture.selection.getSelectedIdentityId("printer-a")).resolves.toBeUndefined();
    });

    it("selects an identity belonging to the Printer", async () => {
      await fixture.repository.create(knownIdentity("identity-a"));
      await fixture.selection.setSelectedIdentity("printer-a", "identity-a");
      await expect(fixture.selection.getSelectedIdentityId("printer-a")).resolves.toBe(
        "identity-a"
      );
    });

    it("replaces the pointer while preserving both history records", async () => {
      await fixture.repository.create(knownIdentity("identity-a"));
      await fixture.repository.create(unclassifiedIdentity("identity-b"));
      await fixture.selection.setSelectedIdentity("printer-a", "identity-a");
      await fixture.selection.setSelectedIdentity("printer-a", "identity-b");

      await expect(fixture.selection.getSelectedIdentityId("printer-a")).resolves.toBe(
        "identity-b"
      );
      await expect(fixture.repository.listByPrinterId("printer-a")).resolves.toHaveLength(2);
    });

    it("clears only the selection", async () => {
      await fixture.repository.create(knownIdentity("identity-a"));
      await fixture.selection.setSelectedIdentity("printer-a", "identity-a");
      await fixture.selection.clearSelection("printer-a");
      await expect(fixture.selection.getSelectedIdentityId("printer-a")).resolves.toBeUndefined();
      await expect(fixture.repository.findById("identity-a")).resolves.toBeDefined();
    });

    it("rejects an identity owned by another Printer", async () => {
      await fixture.repository.create(knownIdentity("identity-b", "printer-b"));
      await expect(
        fixture.selection.setSelectedIdentity("printer-a", "identity-b")
      ).rejects.toBeInstanceOf(PrinterKnowledgeIdentityOwnershipError);
    });

    it("rejects a missing identity", async () => {
      await expect(
        fixture.selection.setSelectedIdentity("printer-a", "missing")
      ).rejects.toBeInstanceOf(PrinterKnowledgeIdentityNotFoundError);
    });
  });
}
