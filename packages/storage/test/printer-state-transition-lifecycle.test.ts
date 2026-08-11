import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PrinterStateTransitionPlan } from "@printtune/contracts";
import {
  createFieldClaim,
  createPrinter,
  createPrinterState,
  createPrinterStateTransitionPlan,
  createWorkspace,
} from "@printtune/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  InMemoryComponentInstallationRepository,
  InMemoryFieldClaimRepository,
  InMemoryPrinterStateRepository,
  InMemoryPrinterStateSelectionPersistence,
  InMemoryPrinterStateTransitionLifecyclePersistence,
  PrinterStateTransitionCommandConflictError,
  StalePrinterStateTransitionSourceError,
  StateTransitionFieldClaimWriteError,
  openPrintTuneDatabase,
  type PrinterStateTransitionLifecyclePersistence,
} from "../src/index.js";
import { openConfiguredSqliteDatabase } from "../src/sqlite-connection.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function plan(
  sourceStateId: string,
  targetStateId: string,
  commandId: string
): PrinterStateTransitionPlan {
  const sourceState = createPrinterState({
    id: sourceStateId,
    printerId: "printer-a",
    ...(sourceStateId === "state-a" ? {} : { parentPrinterStateId: "state-a" }),
    timestamp: sourceStateId === "state-a" ? "2026-08-10T10:00:00Z" : "2026-08-11T10:00:00Z",
  });
  const sourceClaim = createFieldClaim({
    id: `source-claim-${sourceStateId}`,
    target: { type: "printer_state", printerStateId: sourceStateId },
    fieldPath: "printer.nozzle.diameter",
    value: { type: "number", value: 0.4 },
    unit: "mm",
    provenance: { sourceType: "user_confirmed" },
    trust: "user_confirmed",
    timestamp: sourceState.createdAt,
  });
  return createPrinterStateTransitionPlan({
    transitionCommandId: commandId,
    printerId: "printer-a",
    sourcePrinterState: sourceState,
    sourceComponentInstallations: [],
    componentDecisions: [],
    addedComponents: [
      {
        role: `toolhead.hotend-${targetStateId}`,
        kind: "hotend",
        displayName: `Hotend ${targetStateId}`,
      },
    ],
    sourceClaimCarryDecisions: [{ sourceClaim, applicabilityConfirmed: true }],
    createdAt: targetStateId === "state-b" ? "2026-08-11T10:00:00Z" : "2026-08-12T10:00:00Z",
    createPrinterStateId: () => targetStateId,
    createComponentInstallationId: () => `component-${targetStateId}`,
    createComponentInstanceId: () => `instance-${targetStateId}`,
    createClaimId: () => `claim-${targetStateId}`,
  });
}

interface Harness {
  lifecycle: PrinterStateTransitionLifecyclePersistence;
  selected(): Promise<string | undefined>;
  states(): Promise<readonly string[]>;
  components(stateId: string): Promise<readonly string[]>;
  claims(stateId: string): Promise<readonly string[]>;
  seedSourceClaim(stateId: string): Promise<void>;
  close(): void;
}

async function inMemoryHarness(): Promise<Harness> {
  const states = new InMemoryPrinterStateRepository();
  const selection = new InMemoryPrinterStateSelectionPersistence(states);
  const components = new InMemoryComponentInstallationRepository(states);
  const claims = new InMemoryFieldClaimRepository();
  await states.create(
    createPrinterState({ id: "state-a", printerId: "printer-a", timestamp: "2026-08-10T10:00:00Z" })
  );
  await selection.setSelectedState("printer-a", "state-a");
  return {
    lifecycle: new InMemoryPrinterStateTransitionLifecyclePersistence(
      states,
      components,
      claims,
      selection
    ),
    selected: () => selection.getSelectedStateId("printer-a"),
    states: async () => (await states.listByPrinterId("printer-a")).map(({ id }) => id),
    components: async (id) =>
      (await components.listByPrinterStateId(id)).map(({ id: value }) => value),
    claims: async (id) =>
      (await claims.listByTarget({ type: "printer_state", printerStateId: id })).map(
        ({ id: value }) => value
      ),
    seedSourceClaim: async (stateId) => {
      const source = plan(stateId, stateId === "state-a" ? "state-b" : "state-c", "seed")
        .carriedClaims[0]!;
      await claims.create(
        createFieldClaim({
          ...source,
          id: `source-claim-${stateId}`,
          target: { type: "printer_state", printerStateId: stateId },
          provenance: { sourceType: "user_confirmed" },
          timestamp: source.createdAt,
        })
      );
    },
    close() {},
  };
}

async function sqliteHarness(path = ":memory:"): Promise<Harness> {
  const database = openPrintTuneDatabase(path);
  database.migrate();
  await database
    .createWorkspaceRepository()
    .save(
      createWorkspace({ id: "workspace-a", name: "Workspace", timestamp: "2026-08-10T09:00:00Z" })
    );
  const printer = createPrinter({
    id: "printer-a",
    workspaceId: "workspace-a",
    name: "Printer",
    timestamp: "2026-08-10T09:30:00Z",
  });
  const state = createPrinterState({
    id: "state-a",
    printerId: printer.id,
    timestamp: "2026-08-10T10:00:00Z",
  });
  await database.createPrinterCreationPersistence().createPrinterWithInitialState(printer, state);
  const selection = database.createPrinterStateSelectionPersistence();
  const states = database.createPrinterStateRepository();
  const components = database.createComponentInstallationRepository();
  const claims = database.createFieldClaimRepository();
  return {
    lifecycle: database.createPrinterStateTransitionLifecyclePersistence(),
    selected: () => selection.getSelectedStateId("printer-a"),
    states: async () => (await states.listByPrinterId("printer-a")).map(({ id }) => id),
    components: async (id) =>
      (await components.listByPrinterStateId(id)).map(({ id: value }) => value),
    claims: async (id) =>
      (await claims.listByTarget({ type: "printer_state", printerStateId: id })).map(
        ({ id: value }) => value
      ),
    seedSourceClaim: async (stateId) => {
      const sourcePlan = plan(stateId, stateId === "state-a" ? "state-b" : "state-c", "seed");
      const carried = sourcePlan.carriedClaims[0]!;
      await claims.create(
        createFieldClaim({
          ...carried,
          id: `source-claim-${stateId}`,
          target: { type: "printer_state", printerStateId: stateId },
          provenance: { sourceType: "user_confirmed" },
          timestamp: carried.createdAt,
        })
      );
    },
    close: () => database.close(),
  };
}

describe.each([
  ["in-memory", inMemoryHarness],
  ["SQLite", sqliteHarness],
] as const)("PrinterState transition lifecycle (%s)", (_name, createHarness) => {
  it("creates atomically, persists exact carried provenance, and retries without duplicates", async () => {
    const harness = await createHarness();
    try {
      await harness.seedSourceClaim("state-a");
      const transition = plan("state-a", "state-b", "command-x");
      await expect(harness.lifecycle.createOnce(transition)).resolves.toMatchObject({
        status: "created",
        targetPrinterState: { id: "state-b" },
      });
      expect(await harness.selected()).toBe("state-b");
      expect(await harness.states()).toEqual(["state-a", "state-b"]);
      expect(await harness.components("state-b")).toEqual(["component-state-b"]);
      expect(await harness.claims("state-b")).toEqual(["claim-state-b"]);
      await expect(harness.lifecycle.findCompletedByCommandId("command-x")).resolves.toEqual({
        commandId: "command-x",
        printerId: "printer-a",
        sourcePrinterStateId: "state-a",
        targetPrinterStateId: "state-b",
      });

      await expect(harness.lifecycle.createOnce(transition)).resolves.toMatchObject({
        status: "already_completed",
        targetPrinterState: { id: "state-b" },
      });
      expect(await harness.states()).toEqual(["state-a", "state-b"]);
      expect(await harness.claims("state-b")).toEqual(["claim-state-b"]);
    } finally {
      harness.close();
    }
  });

  it("rejects a competing stale command and command identity conflicts", async () => {
    const harness = await createHarness();
    try {
      await harness.seedSourceClaim("state-a");
      await harness.lifecycle.createOnce(plan("state-a", "state-b", "command-x"));
      await expect(
        harness.lifecycle.createOnce(plan("state-a", "state-c", "command-y"))
      ).rejects.toBeInstanceOf(StalePrinterStateTransitionSourceError);
      await expect(
        harness.lifecycle.createOnce({
          ...plan("state-b", "state-c", "command-x"),
          sourcePrinterStateId: "state-b",
        })
      ).rejects.toBeInstanceOf(PrinterStateTransitionCommandConflictError);
      expect(await harness.selected()).toBe("state-b");
      expect(await harness.states()).toEqual(["state-a", "state-b"]);
    } finally {
      harness.close();
    }
  });

  it("retry after a later transition returns the historical target without reselecting it", async () => {
    const harness = await createHarness();
    try {
      await harness.seedSourceClaim("state-a");
      const first = plan("state-a", "state-b", "command-x");
      await harness.lifecycle.createOnce(first);
      await harness.seedSourceClaim("state-b");
      await harness.lifecycle.createOnce(plan("state-b", "state-c", "command-y"));
      await expect(harness.lifecycle.createOnce(first)).resolves.toMatchObject({
        status: "already_completed",
        targetPrinterState: { id: "state-b" },
      });
      expect(await harness.selected()).toBe("state-c");
      expect(await harness.states()).toEqual(["state-a", "state-b", "state-c"]);
    } finally {
      harness.close();
    }
  });

  it("rolls back the complete transition when a later component insert fails", async () => {
    const harness = await createHarness();
    try {
      await harness.seedSourceClaim("state-a");
      const valid = plan("state-a", "state-b", "command-x");
      const duplicateComponentPlan: PrinterStateTransitionPlan = {
        ...valid,
        targetComponentInstallations: Object.freeze([
          valid.targetComponentInstallations[0]!,
          {
            ...valid.targetComponentInstallations[0]!,
            role: "toolhead.second-hotend",
          },
        ]),
      };
      await expect(harness.lifecycle.createOnce(duplicateComponentPlan)).rejects.toThrow();
      expect(await harness.selected()).toBe("state-a");
      expect(await harness.states()).toEqual(["state-a"]);
      expect(await harness.components("state-b")).toEqual([]);
      expect(await harness.claims("state-b")).toEqual([]);
      expect(await harness.lifecycle.findCompletedByCommandId("command-x")).toBeUndefined();
    } finally {
      harness.close();
    }
  });

  it("rolls back when transition Claim provenance cannot reference a persisted source Claim", async () => {
    const harness = await createHarness();
    try {
      const transition = plan("state-a", "state-b", "command-x");
      await expect(harness.lifecycle.createOnce(transition)).rejects.toThrow();
      expect(await harness.selected()).toBe("state-a");
      expect(await harness.states()).toEqual(["state-a"]);
      expect(await harness.components("state-b")).toEqual([]);
      expect(await harness.claims("state-b")).toEqual([]);
    } finally {
      harness.close();
    }
  });
});

describe("SQLite transition persistence boundaries", () => {
  it("rolls back every row when the final working-selection update fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "printtune-transition-selection-"));
    directories.push(directory);
    const path = join(directory, "database.sqlite");
    const harness = await sqliteHarness(path);
    try {
      await harness.seedSourceClaim("state-a");
      const triggerConnection = openConfiguredSqliteDatabase(path);
      try {
        triggerConnection.exec(`
          CREATE TRIGGER fail_transition_selection
          BEFORE UPDATE ON printer_state_selections
          BEGIN
            SELECT RAISE(FAIL, 'selection update failed');
          END;
        `);
      } finally {
        triggerConnection.close();
      }
      await expect(
        harness.lifecycle.createOnce(plan("state-a", "state-b", "command-x"))
      ).rejects.toThrow("selection update failed");
      expect(await harness.selected()).toBe("state-a");
      expect(await harness.states()).toEqual(["state-a"]);
      expect(await harness.components("state-b")).toEqual([]);
      expect(await harness.claims("state-b")).toEqual([]);
      expect(await harness.lifecycle.findCompletedByCommandId("command-x")).toBeUndefined();
    } finally {
      harness.close();
    }
  });

  it("survives close/reopen and generic FieldClaim writes reject transition provenance", async () => {
    const directory = mkdtempSync(join(tmpdir(), "printtune-transition-"));
    directories.push(directory);
    const path = join(directory, "database.sqlite");
    const first = await sqliteHarness(path);
    await first.seedSourceClaim("state-a");
    const transition = plan("state-a", "state-b", "command-x");
    await first.lifecycle.createOnce(transition);
    first.close();

    const database = openPrintTuneDatabase(path);
    database.migrate();
    try {
      const lifecycle = database.createPrinterStateTransitionLifecyclePersistence();
      await expect(lifecycle.createOnce(transition)).resolves.toMatchObject({
        status: "already_completed",
      });
      const persisted = await database.createFieldClaimRepository().findById("claim-state-b");
      expect(persisted?.provenance).toEqual(transition.carriedClaims[0]?.provenance);
      await expect(
        database.createFieldClaimRepository().create(transition.carriedClaims[0]!)
      ).rejects.toBeInstanceOf(StateTransitionFieldClaimWriteError);
    } finally {
      database.close();
    }
  });
});
