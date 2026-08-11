import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createComponentInstallation,
  createFieldClaim,
  createPrinter,
  createPrinterState,
  createWorkspace,
} from "@printtune/core";
import {
  InMemoryComponentInstallationRepository,
  InMemoryFieldClaimRepository,
  InMemoryPrinterRepository,
  InMemoryPrinterStateRepository,
  InMemoryPrinterStateSelectionPersistence,
  InMemoryPrinterStateTransitionLifecyclePersistence,
  InMemoryWorkspaceRepository,
  openPrintTuneDatabase,
} from "@printtune/storage";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActiveWorkspaceSession } from "../src/main/active-workspace-session.js";
import { PrinterStateLifecycleApplicationService } from "../src/main/printer-state-lifecycle-application-service.js";
import {
  NoActiveWorkspaceError,
  PrinterNotFoundError,
} from "../src/main/printer-flow-application-service.js";
import { assertCreatePrinterStateTransitionCommand } from "../src/shared/printer-state-lifecycle-api.js";

const EARLY = "2026-08-10T10:00:00Z";
const LATE = "2026-08-11T10:00:00Z";
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function createFixture() {
  const workspaces = new InMemoryWorkspaceRepository();
  const printers = new InMemoryPrinterRepository();
  const states = new InMemoryPrinterStateRepository();
  const selection = new InMemoryPrinterStateSelectionPersistence(states);
  const components = new InMemoryComponentInstallationRepository(states);
  const claims = new InMemoryFieldClaimRepository();
  const lifecycle = new InMemoryPrinterStateTransitionLifecyclePersistence(
    states,
    components,
    claims,
    selection
  );
  const workspace = createWorkspace({ id: "workspace-a", name: "Workspace", timestamp: EARLY });
  const printer = createPrinter({
    id: "printer-a",
    workspaceId: workspace.id,
    name: "Printer",
    timestamp: EARLY,
  });
  const state = createPrinterState({ id: "state-a", printerId: printer.id, timestamp: EARLY });
  await workspaces.save(workspace);
  await printers.save(printer);
  await states.create(state);
  await selection.setSelectedState(printer.id, state.id);
  const activeWorkspace = new ActiveWorkspaceSession(workspaces);
  await activeWorkspace.setActiveWorkspace(workspace.id);
  const calls = {
    state: vi.fn(() => "state-b"),
    component: vi.fn(() => "component-b"),
    instance: vi.fn(() => "instance-b"),
    claim: vi.fn(() => "claim-b"),
    now: vi.fn(() => LATE),
  };
  const service = new PrinterStateLifecycleApplicationService(
    activeWorkspace,
    printers,
    states,
    selection,
    components,
    claims,
    lifecycle,
    {
      createPrinterStateId: calls.state,
      createComponentInstallationId: calls.component,
      createComponentInstanceId: calls.instance,
      createClaimId: calls.claim,
      now: calls.now,
    }
  );
  return {
    workspaces,
    printers,
    states,
    selection,
    components,
    claims,
    lifecycle,
    activeWorkspace,
    service,
    calls,
    printer,
    state,
  };
}

async function seedPreparation(fixture: Awaited<ReturnType<typeof createFixture>>): Promise<void> {
  await fixture.components.create(
    createComponentInstallation({
      id: "component-a",
      printerStateId: "state-a",
      componentInstanceId: "instance-a",
      role: "toolhead.extruder",
      kind: "extruder",
      displayName: "Extruder A",
      definitionRef: {
        packageId: "secret-package",
        packageVersion: "1",
        definitionId: "secret-definition",
      },
    })
  );
  const base = {
    target: { type: "printer_state" as const, printerStateId: "state-a" },
    value: { type: "number" as const, value: 0.4 },
    unit: "mm" as const,
    timestamp: EARLY,
  };
  await fixture.claims.create(
    createFieldClaim({
      id: "carry",
      ...base,
      fieldPath: "printer.nozzle.diameter",
      provenance: { sourceType: "user_confirmed" },
      trust: "user_confirmed",
      confidence: 0.9,
    })
  );
  await fixture.claims.create(
    createFieldClaim({
      id: "safety",
      ...base,
      fieldPath: "printer.hotend.max-temperature",
      value: { type: "number", value: 300 },
      unit: "degC",
      provenance: { sourceType: "user_confirmed" },
      trust: "user_confirmed",
    })
  );
  await fixture.claims.create(
    createFieldClaim({
      id: "weak",
      ...base,
      fieldPath: "printer.nozzle.diameter",
      provenance: { sourceType: "user_entered" },
      trust: "user_entered",
    })
  );
  await fixture.claims.create(
    createFieldClaim({
      id: "package",
      ...base,
      fieldPath: "printer.nozzle.diameter",
      provenance: {
        sourceType: "knowledge_package",
        sourceRef: {
          type: "knowledge_package",
          packageId: "secret",
          packageVersion: "1",
          factId: "secret-fact",
        },
      },
      trust: "developer_verified",
    })
  );
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    transitionCommandId: "command-x",
    printerId: "printer-a",
    expectedSourcePrinterStateId: "state-a",
    componentDecisions: [{ componentInstallationId: "component-a", action: "retain" }],
    claimCarryDecisions: [{ sourceClaimId: "carry", applicabilityConfirmed: true }],
    ...overrides,
  };
}

describe("PrinterStateLifecycleApplicationService reads", () => {
  it("projects explicit working selection and exact lineage without chronology inference", async () => {
    const fixture = await createFixture();
    const newer = createPrinterState({
      id: "state-z",
      printerId: "printer-a",
      parentPrinterStateId: "state-a",
      timestamp: LATE,
    });
    await fixture.states.create(newer);
    await fixture.selection.setSelectedState("printer-a", "state-a");
    await expect(fixture.service.getPrinterStateOverview("printer-a")).resolves.toEqual({
      printerId: "printer-a",
      workingPrinterStateId: "state-a",
      states: [
        { printerStateId: "state-a", createdAt: EARLY, isWorking: true },
        {
          printerStateId: "state-z",
          parentPrinterStateId: "state-a",
          createdAt: LATE,
          isWorking: false,
        },
      ],
    });
  });

  it("returns safe component and Claim preparation projections", async () => {
    const fixture = await createFixture();
    await seedPreparation(fixture);
    const preparation = await fixture.service.getTransitionPreparation("printer-a");
    expect(preparation.sourcePrinterStateId).toBe("state-a");
    expect(preparation.components).toEqual([
      {
        componentInstallationId: "component-a",
        role: "toolhead.extruder",
        kind: "extruder",
        displayName: "Extruder A",
      },
    ]);
    expect(preparation.components[0]).not.toHaveProperty("componentInstanceId");
    expect(preparation.components[0]).not.toHaveProperty("definitionRef");
    expect(
      preparation.claimCarryChoices.map(({ sourceClaimId, disposition }) => [
        sourceClaimId,
        disposition,
      ])
    ).toEqual([
      ["carry", "confirmation_required"],
      ["safety", "reconfirmation_required"],
      ["weak", "reconfirmation_required"],
    ]);
    expect(
      preparation.claimCarryChoices.find(({ sourceClaimId }) => sourceClaimId === "carry")
    ).not.toHaveProperty("trust");
    expect(
      preparation.claimCarryChoices.find(({ sourceClaimId }) => sourceClaimId === "carry")
    ).not.toHaveProperty("provenance");
    expect(
      preparation.claimCarryChoices.some(({ sourceClaimId }) => sourceClaimId === "package")
    ).toBe(false);
    expect(preparation.reconfirmationFields).toHaveLength(2);
  });

  it("denies absent and cross-Workspace authorization before returning state data", async () => {
    const fixture = await createFixture();
    const noActive = new ActiveWorkspaceSession(fixture.workspaces);
    const unauthorizedService = new PrinterStateLifecycleApplicationService(
      noActive,
      fixture.printers,
      fixture.states,
      fixture.selection,
      fixture.components,
      fixture.claims,
      fixture.lifecycle
    );
    await expect(unauthorizedService.getPrinterStateOverview("printer-a")).rejects.toBeInstanceOf(
      NoActiveWorkspaceError
    );
    await fixture.workspaces.save(
      createWorkspace({ id: "workspace-b", name: "Other", timestamp: EARLY })
    );
    await fixture.activeWorkspace.setActiveWorkspace("workspace-b");
    await expect(fixture.service.getTransitionPreparation("printer-a")).rejects.toBeInstanceOf(
      PrinterNotFoundError
    );
  });

  it("fails explicitly when no persistent working selection exists", async () => {
    const fixture = await createFixture();
    const emptySelection = new InMemoryPrinterStateSelectionPersistence(fixture.states);
    const service = new PrinterStateLifecycleApplicationService(
      fixture.activeWorkspace,
      fixture.printers,
      fixture.states,
      emptySelection,
      fixture.components,
      fixture.claims,
      new InMemoryPrinterStateTransitionLifecyclePersistence(
        fixture.states,
        fixture.components,
        fixture.claims,
        emptySelection
      )
    );
    await expect(service.getPrinterStateOverview("printer-a")).rejects.toMatchObject({
      code: "missing_working_state",
    });
  });
});

describe("PrinterStateLifecycleApplicationService transitions", () => {
  it("creates through Core/storage, then reads the new working State and preparation", async () => {
    const fixture = await createFixture();
    await seedPreparation(fixture);
    await expect(fixture.service.createPrinterStateTransition(command())).resolves.toEqual({
      status: "created",
      printerId: "printer-a",
      sourcePrinterStateId: "state-a",
      targetPrinterStateId: "state-b",
    });
    const overview = await fixture.service.getPrinterStateOverview("printer-a");
    expect(overview.workingPrinterStateId).toBe("state-b");
    expect(overview.states.at(-1)).toEqual({
      printerStateId: "state-b",
      parentPrinterStateId: "state-a",
      createdAt: LATE,
      isWorking: true,
    });
    expect((await fixture.service.getTransitionPreparation("printer-a")).sourcePrinterStateId).toBe(
      "state-b"
    );
    expect(await fixture.components.listByPrinterStateId("state-b")).toMatchObject([
      { id: "component-b", componentInstanceId: "instance-a" },
    ]);
    expect(
      (await fixture.claims.listByTarget({ type: "printer_state", printerStateId: "state-b" }))[0]
        ?.provenance
    ).toMatchObject({
      sourceType: "state_transition",
      sourceRef: { sourceClaimId: "carry", transitionCommandId: "command-x" },
    });
  });

  it("prechecks completed commands before State context, clock, IDs, and persistence", async () => {
    const fixture = await createFixture();
    await seedPreparation(fixture);
    const request = command();
    await fixture.service.createPrinterStateTransition(request);
    const counts = Object.fromEntries(
      Object.entries(fixture.calls).map(([key, fn]) => [key, fn.mock.calls.length])
    );
    await expect(fixture.service.createPrinterStateTransition(request)).resolves.toMatchObject({
      status: "already_completed",
      targetPrinterStateId: "state-b",
    });
    for (const [key, fn] of Object.entries(fixture.calls))
      expect(fn).toHaveBeenCalledTimes(counts[key]!);
    expect(await fixture.selection.getSelectedStateId("printer-a")).toBe("state-b");
  });

  it("returns the historical retry target after selection advances and detects command conflicts", async () => {
    const fixture = await createFixture();
    await seedPreparation(fixture);
    const request = command();
    await fixture.service.createPrinterStateTransition(request);
    await fixture.states.create(
      createPrinterState({
        id: "state-c",
        printerId: "printer-a",
        parentPrinterStateId: "state-b",
        timestamp: "2026-08-12T10:00:00Z",
      })
    );
    await fixture.selection.setSelectedState("printer-a", "state-c");
    await expect(fixture.service.createPrinterStateTransition(request)).resolves.toMatchObject({
      status: "already_completed",
      targetPrinterStateId: "state-b",
    });
    expect(await fixture.selection.getSelectedStateId("printer-a")).toBe("state-c");
    await expect(
      fixture.service.createPrinterStateTransition(
        command({ expectedSourcePrinterStateId: "state-b" })
      )
    ).rejects.toMatchObject({ code: "command_conflict" });

    const printerB = createPrinter({
      id: "printer-b",
      workspaceId: "workspace-a",
      name: "Printer B",
      timestamp: EARLY,
    });
    await fixture.printers.save(printerB);
    await expect(
      fixture.service.createPrinterStateTransition(command({ printerId: "printer-b" }))
    ).rejects.toMatchObject({ code: "command_conflict" });
  });

  it("rejects stale context and tampered component/Claim references before ID generation", async () => {
    const fixture = await createFixture();
    await seedPreparation(fixture);
    await expect(
      fixture.service.createPrinterStateTransition(command({ expectedSourcePrinterStateId: "old" }))
    ).rejects.toMatchObject({ code: "stale_transition_context" });
    await expect(
      fixture.service.createPrinterStateTransition(command({ componentDecisions: [] }))
    ).rejects.toMatchObject({ code: "invalid_component_decisions" });
    await expect(
      fixture.service.createPrinterStateTransition(
        command({ componentDecisions: [{ componentInstallationId: "unknown", action: "retain" }] })
      )
    ).rejects.toMatchObject({ code: "invalid_component_decisions" });
    await expect(
      fixture.service.createPrinterStateTransition(
        command({
          claimCarryDecisions: [{ sourceClaimId: "missing", applicabilityConfirmed: true }],
        })
      )
    ).rejects.toMatchObject({ code: "invalid_claim_decision" });
    const foreignState = createPrinterState({
      id: "state-foreign",
      printerId: "printer-a",
      parentPrinterStateId: "state-a",
      timestamp: LATE,
    });
    await fixture.states.create(foreignState);
    await fixture.claims.create(
      createFieldClaim({
        id: "foreign-claim",
        target: { type: "printer_state", printerStateId: foreignState.id },
        fieldPath: "printer.nozzle.diameter",
        value: { type: "number", value: 0.4 },
        unit: "mm",
        provenance: { sourceType: "user_confirmed" },
        trust: "user_confirmed",
        timestamp: LATE,
      })
    );
    await fixture.claims.create(
      createFieldClaim({
        id: "component-claim",
        target: { type: "component_installation", componentInstallationId: "component-a" },
        fieldPath: "component.probe.offset.x",
        value: { type: "number", value: 1 },
        unit: "mm",
        provenance: { sourceType: "user_confirmed" },
        trust: "user_confirmed",
        timestamp: EARLY,
      })
    );
    for (const sourceClaimId of ["foreign-claim", "component-claim"]) {
      await expect(
        fixture.service.createPrinterStateTransition(
          command({ claimCarryDecisions: [{ sourceClaimId, applicabilityConfirmed: true }] })
        )
      ).rejects.toMatchObject({ code: "invalid_claim_decision" });
    }
    expect(fixture.calls.state).not.toHaveBeenCalled();
    expect(fixture.calls.now).not.toHaveBeenCalled();
  });

  it("revalidates package, weak, and safety Claim requests through Core", async () => {
    const fixture = await createFixture();
    await seedPreparation(fixture);
    for (const sourceClaimId of ["package", "weak", "safety"]) {
      await expect(
        fixture.service.createPrinterStateTransition(
          command({ claimCarryDecisions: [{ sourceClaimId, applicabilityConfirmed: true }] })
        )
      ).rejects.toMatchObject({ code: "transition_plan_invalid" });
    }
    expect(await fixture.selection.getSelectedStateId("printer-a")).toBe("state-a");
  });

  it("accepts zero selected Claims and rejects forged closed-command fields", async () => {
    const fixture = await createFixture();
    await seedPreparation(fixture);
    await expect(
      fixture.service.createPrinterStateTransition(command({ claimCarryDecisions: [] }))
    ).resolves.toMatchObject({ status: "created" });
    expect(() =>
      assertCreatePrinterStateTransitionCommand({ ...command(), targetPrinterStateId: "forged" })
    ).toThrow(TypeError);
    expect(() =>
      assertCreatePrinterStateTransitionCommand(
        command({
          componentDecisions: [
            { componentInstallationId: "component-a", action: "retain" },
            { componentInstallationId: "component-a", action: "remove" },
          ],
        })
      )
    ).toThrow(TypeError);
    expect(() =>
      assertCreatePrinterStateTransitionCommand(
        command({
          componentDecisions: [{ componentInstallationId: "component-a", action: "copy" }],
        })
      )
    ).toThrow(TypeError);
  });
});

describe("file-backed Main lifecycle retry", () => {
  it("returns the durable completed result after restart without duplicates", async () => {
    const directory = mkdtempSync(join(tmpdir(), "printtune-main-transition-"));
    directories.push(directory);
    const path = join(directory, "database.sqlite");
    const first = openPrintTuneDatabase(path);
    first.migrate();
    const workspace = createWorkspace({ id: "workspace-a", name: "Workspace", timestamp: EARLY });
    const printer = createPrinter({
      id: "printer-a",
      workspaceId: workspace.id,
      name: "Printer",
      timestamp: EARLY,
    });
    const state = createPrinterState({ id: "state-a", printerId: printer.id, timestamp: EARLY });
    await first.createWorkspaceRepository().save(workspace);
    await first.createPrinterCreationPersistence().createPrinterWithInitialState(printer, state);
    const firstSession = new ActiveWorkspaceSession(first.createWorkspaceRepository());
    await firstSession.setActiveWorkspace(workspace.id);
    const firstService = new PrinterStateLifecycleApplicationService(
      firstSession,
      first.createPrinterRepository(),
      first.createPrinterStateRepository(),
      first.createPrinterStateSelectionPersistence(),
      first.createComponentInstallationRepository(),
      first.createFieldClaimRepository(),
      first.createPrinterStateTransitionLifecyclePersistence(),
      { createPrinterStateId: () => "state-b", now: () => LATE }
    );
    const emptyCommand = { ...command(), componentDecisions: [], claimCarryDecisions: [] };
    await firstService.createPrinterStateTransition(emptyCommand);
    first.close();

    const second = openPrintTuneDatabase(path);
    second.migrate();
    try {
      const secondSession = new ActiveWorkspaceSession(second.createWorkspaceRepository());
      await secondSession.setActiveWorkspace(workspace.id);
      const never = vi.fn(() => {
        throw new Error("must not generate");
      });
      const secondService = new PrinterStateLifecycleApplicationService(
        secondSession,
        second.createPrinterRepository(),
        second.createPrinterStateRepository(),
        second.createPrinterStateSelectionPersistence(),
        second.createComponentInstallationRepository(),
        second.createFieldClaimRepository(),
        second.createPrinterStateTransitionLifecyclePersistence(),
        {
          createPrinterStateId: never,
          createComponentInstallationId: never,
          createClaimId: never,
          now: never,
        }
      );
      await expect(secondService.createPrinterStateTransition(emptyCommand)).resolves.toEqual({
        status: "already_completed",
        printerId: "printer-a",
        sourcePrinterStateId: "state-a",
        targetPrinterStateId: "state-b",
      });
      expect(never).not.toHaveBeenCalled();
      expect(await second.createPrinterStateRepository().listByPrinterId("printer-a")).toHaveLength(
        2
      );
    } finally {
      second.close();
    }
  });
});
