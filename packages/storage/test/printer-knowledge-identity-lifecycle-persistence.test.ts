import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createPrinter, createWorkspace } from "@printtune/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DuplicatePrinterKnowledgeIdentityError,
  InMemoryPrinterKnowledgeIdentityLifecyclePersistence,
  openPrintTuneDatabase,
  type PrinterKnowledgeIdentityLifecyclePersistence,
  type PrinterKnowledgeIdentityRepository,
  type PrinterKnowledgeIdentitySelectionPersistence,
  type PrintTuneDatabase,
} from "../src/index";
import {
  knownIdentity,
  unclassifiedIdentity,
} from "./printer-knowledge-identity-repository-contract";

const FIRST = "2026-08-08T10:00:00.000Z";
const SECOND = "2026-08-09T10:00:00.000Z";

interface LifecycleFixture {
  readonly lifecycle: PrinterKnowledgeIdentityLifecyclePersistence;
  readonly identities: PrinterKnowledgeIdentityRepository;
  readonly selection: PrinterKnowledgeIdentitySelectionPersistence;
  readonly close: () => void | Promise<void>;
}

async function seedPrinter(database: PrintTuneDatabase): Promise<void> {
  await database
    .createWorkspaceRepository()
    .save(createWorkspace({ id: "workspace-a", name: "A", timestamp: FIRST }));
  await database.createPrinterRepository().save(
    createPrinter({
      id: "printer-a",
      workspaceId: "workspace-a",
      name: "A",
      timestamp: FIRST,
    })
  );
}

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "printtune-identity-lifecycle-"));
  return { directory, path: join(directory, "printtune.sqlite") };
}

function describeLifecycle(
  name: string,
  createFixture: () => LifecycleFixture | Promise<LifecycleFixture>
): void {
  describe(name, () => {
    let fixture: LifecycleFixture;
    beforeEach(async () => {
      fixture = await createFixture();
    });
    afterEach(async () => fixture.close());

    it.each([
      ["known series", knownIdentity("identity-series")],
      ["known exact model", knownIdentity("identity-model", "printer-a", FIRST, true)],
      ["unclassified", unclassifiedIdentity("identity-unclassified")],
    ])("atomically creates and selects %s", async (_label, identity) => {
      await fixture.lifecycle.createAndSelect(identity);
      await expect(fixture.identities.listByPrinterId("printer-a")).resolves.toEqual([identity]);
      await expect(fixture.selection.getSelectedIdentityId("printer-a")).resolves.toBe(identity.id);
    });

    it("appends corrections, updates current selection, and preserves old history", async () => {
      const first = knownIdentity("identity-a");
      const correction = knownIdentity("identity-b", "printer-a", SECOND, true);
      await fixture.lifecycle.createAndSelect(first);
      await fixture.lifecycle.createAndSelect(correction);

      await expect(fixture.identities.listByPrinterId("printer-a")).resolves.toEqual([
        first,
        correction,
      ]);
      await expect(fixture.identities.findById("identity-a")).resolves.toEqual(first);
      await expect(fixture.selection.getSelectedIdentityId("printer-a")).resolves.toBe(
        "identity-b"
      );
    });

    it.each([
      [knownIdentity("identity-a"), unclassifiedIdentity("identity-b", "printer-a", SECOND)],
      [unclassifiedIdentity("identity-a"), knownIdentity("identity-b", "printer-a", SECOND)],
    ])("supports known and unclassified transitions", async (first, second) => {
      await fixture.lifecycle.createAndSelect(first);
      await fixture.lifecycle.createAndSelect(second);
      await expect(fixture.identities.listByPrinterId("printer-a")).resolves.toEqual([
        first,
        second,
      ]);
      await expect(fixture.selection.getSelectedIdentityId("printer-a")).resolves.toBe(second.id);
    });

    it("keeps explicit currentness independent of chronological history ordering", async () => {
      const newer = knownIdentity("identity-newer", "printer-a", SECOND);
      const explicitlyCurrent = unclassifiedIdentity("identity-older", "printer-a", FIRST);
      await fixture.lifecycle.createAndSelect(newer);
      await fixture.lifecycle.createAndSelect(explicitlyCurrent);

      await expect(fixture.identities.listByPrinterId("printer-a")).resolves.toEqual([
        explicitlyCurrent,
        newer,
      ]);
      await expect(fixture.selection.getSelectedIdentityId("printer-a")).resolves.toBe(
        "identity-older"
      );
    });

    it("rolls back a duplicate creation without changing the previous current selection", async () => {
      const original = knownIdentity("identity-a");
      await fixture.lifecycle.createAndSelect(original);
      await expect(
        fixture.lifecycle.createAndSelect(unclassifiedIdentity("identity-a", "printer-a", SECOND))
      ).rejects.toBeInstanceOf(DuplicatePrinterKnowledgeIdentityError);

      await expect(fixture.identities.listByPrinterId("printer-a")).resolves.toEqual([original]);
      await expect(fixture.selection.getSelectedIdentityId("printer-a")).resolves.toBe(
        "identity-a"
      );
    });
  });
}

describeLifecycle("In-memory identity lifecycle", () => {
  const store = new InMemoryPrinterKnowledgeIdentityLifecyclePersistence();
  return { lifecycle: store, identities: store, selection: store, close() {} };
});

describeLifecycle("SQLite identity lifecycle", async () => {
  const database = openPrintTuneDatabase(":memory:");
  database.migrate();
  await seedPrinter(database);
  return {
    lifecycle: database.createPrinterKnowledgeIdentityLifecyclePersistence(),
    identities: database.createPrinterKnowledgeIdentityRepository(),
    selection: database.createPrinterKnowledgeIdentitySelectionPersistence(),
    close: () => database.close(),
  };
});

describe("identity lifecycle failure and persistence", () => {
  it("stages in-memory changes so a selection failure leaves no partial history", async () => {
    const failure = new Error("controlled selection failure");
    const store = new InMemoryPrinterKnowledgeIdentityLifecyclePersistence({
      beforeSelection(identity) {
        if (identity.id === "identity-b") throw failure;
      },
    });
    await store.createAndSelect(knownIdentity("identity-a"));

    await expect(
      store.createAndSelect(unclassifiedIdentity("identity-b", "printer-a", SECOND))
    ).rejects.toBe(failure);
    await expect(store.findById("identity-b")).resolves.toBeUndefined();
    await expect(store.getSelectedIdentityId("printer-a")).resolves.toBe("identity-a");
  });

  it("rolls back SQLite history when selection fails after insertion", async () => {
    const { directory, path } = temporaryDatabase();
    try {
      const setup = openPrintTuneDatabase(path);
      setup.migrate();
      await seedPrinter(setup);
      await setup
        .createPrinterKnowledgeIdentityLifecyclePersistence()
        .createAndSelect(knownIdentity("identity-a"));
      setup.close();

      const triggerConnection = new DatabaseSync(path);
      triggerConnection.exec(`
        CREATE TRIGGER fail_identity_selection
        BEFORE INSERT ON printer_knowledge_identity_selections
        BEGIN SELECT RAISE(ABORT, 'controlled selection failure'); END
      `);
      triggerConnection.close();

      const database = openPrintTuneDatabase(path);
      try {
        await expect(
          database
            .createPrinterKnowledgeIdentityLifecyclePersistence()
            .createAndSelect(unclassifiedIdentity("identity-b", "printer-a", SECOND))
        ).rejects.toThrow("controlled selection failure");
        await expect(
          database.createPrinterKnowledgeIdentityRepository().findById("identity-b")
        ).resolves.toBeUndefined();
        await expect(
          database
            .createPrinterKnowledgeIdentitySelectionPersistence()
            .getSelectedIdentityId("printer-a")
        ).resolves.toBe("identity-a");
      } finally {
        database.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves lifecycle history and selection across SQLite close and reopen", async () => {
    const { directory, path } = temporaryDatabase();
    try {
      const first = openPrintTuneDatabase(path);
      first.migrate();
      await seedPrinter(first);
      await first
        .createPrinterKnowledgeIdentityLifecyclePersistence()
        .createAndSelect(knownIdentity("identity-a"));
      first.close();

      const second = openPrintTuneDatabase(path);
      second.migrate();
      try {
        await expect(
          second.createPrinterKnowledgeIdentityRepository().findById("identity-a")
        ).resolves.toEqual(knownIdentity("identity-a"));
        await expect(
          second
            .createPrinterKnowledgeIdentitySelectionPersistence()
            .getSelectedIdentityId("printer-a")
        ).resolves.toBe("identity-a");
      } finally {
        second.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
