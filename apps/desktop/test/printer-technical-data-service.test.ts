import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  InMemoryFieldClaimRepository,
  InMemoryPrinterCreationPersistence,
  InMemoryPrinterRepository,
  InMemoryPrinterStateRepository,
  InMemoryPrinterStateSelectionPersistence,
  InMemoryWorkspaceRepository,
  openPrintTuneDatabase,
} from "@printtune/storage";
import { describe, expect, it } from "vitest";

import { ActiveWorkspaceSession } from "../src/main/active-workspace-session";
import { FieldResolutionService } from "../src/main/field-resolution-service";
import { PrinterApplicationService } from "../src/main/printer-application-service";
import {
  PrinterFlowApplicationService,
  PrinterNotFoundError,
} from "../src/main/printer-flow-application-service";
import {
  InvalidManualTechnicalValueError,
  PrinterTechnicalDataService,
  UnsupportedManualTechnicalFieldError,
} from "../src/main/printer-technical-data-service";

const EARLY = "2026-08-09T10:00:00.000Z";
const LATE = "2026-08-09T11:00:00.000Z";

async function harness(timestamps: readonly string[] = [EARLY]) {
  const workspaces = new InMemoryWorkspaceRepository();
  const printers = new InMemoryPrinterRepository();
  const states = new InMemoryPrinterStateRepository();
  const selection = new InMemoryPrinterStateSelectionPersistence(states);
  const claims = new InMemoryFieldClaimRepository();
  await workspaces.save({ id: "workspace-a", name: "A", createdAt: EARLY, updatedAt: EARLY });
  await workspaces.save({ id: "workspace-b", name: "B", createdAt: EARLY, updatedAt: EARLY });
  const session = new ActiveWorkspaceSession(workspaces);
  await session.setActiveWorkspace("workspace-a");
  const creation = new PrinterApplicationService(
    new InMemoryPrinterCreationPersistence(printers, states, selection),
    {
      createPrinterId: () => "printer-a",
      createPrinterStateId: () => "state-a",
      now: () => EARLY,
    }
  );
  const flow = new PrinterFlowApplicationService(creation, printers, states, selection, session);
  await creation.createPrinterWithInitialState({ workspaceId: "workspace-a", printerName: "A" });
  await printers.save({
    id: "printer-b",
    workspaceId: "workspace-b",
    name: "B",
    createdAt: EARLY,
    updatedAt: EARLY,
  });
  await states.create({ id: "state-b", printerId: "printer-b", createdAt: EARLY });
  let id = 0;
  let time = 0;
  const service = new PrinterTechnicalDataService(
    flow,
    claims,
    new FieldResolutionService(claims),
    {
      createClaimId: () => `claim-${++id}`,
      now: () => timestamps[Math.min(time++, timestamps.length - 1)] ?? EARLY,
    }
  );
  return { service, claims, session, states, selection, creation, printers };
}

function add(
  service: PrinterTechnicalDataService,
  field: "nozzleDiameter" | "extruderType" | "hotendMaxTemperature",
  value: string | number,
  confirmation: "confirmed" | "uncertain" = "confirmed"
) {
  return service.addManualClaim({ printerId: "printer-a", field, value, confirmation });
}

function field(result: Awaited<ReturnType<typeof add>>, key: string) {
  return result.find((item) => item.field === key);
}

describe("PrinterTechnicalDataService", () => {
  it("returns exactly three missing fields for the authorized Printer", async () => {
    const { service } = await harness();
    const result = await service.readTechnicalFields("printer-a");
    expect(result.map(({ field, status }) => ({ field, status }))).toEqual([
      { field: "nozzleDiameter", status: "missing" },
      { field: "extruderType", status: "missing" },
      { field: "hotendMaxTemperature", status: "missing" },
    ]);
  });

  it("rejects a Printer from another Workspace before reading or creating Claims", async () => {
    const { service, claims } = await harness();
    await expect(service.readTechnicalFields("printer-b")).rejects.toBeInstanceOf(
      PrinterNotFoundError
    );
    await expect(
      service.addManualClaim({
        printerId: "printer-b",
        field: "nozzleDiameter",
        value: 0.6,
        confirmation: "confirmed",
      })
    ).rejects.toBeInstanceOf(PrinterNotFoundError);
    await expect(
      claims.listByTarget({ type: "printer_state", printerStateId: "state-b" })
    ).resolves.toEqual([]);
  });

  it("fails when working-State selection is missing instead of inferring history", async () => {
    const fixture = await harness();
    const flow = new PrinterFlowApplicationService(
      fixture.creation,
      fixture.printers,
      fixture.states,
      new InMemoryPrinterStateSelectionPersistence(fixture.states),
      fixture.session
    );
    const service = new PrinterTechnicalDataService(
      flow,
      fixture.claims,
      new FieldResolutionService(fixture.claims)
    );
    await expect(service.readTechnicalFields("printer-a")).rejects.toMatchObject({
      name: "WorkingPrinterStateNotFoundError",
    });
  });

  it("derives the working state and generates Claim identity and timestamp in Main", async () => {
    const { service, claims } = await harness();
    await add(service, "nozzleDiameter", 0.6);
    await expect(claims.findById("claim-1")).resolves.toMatchObject({
      id: "claim-1",
      target: { type: "printer_state", printerStateId: "state-a" },
      createdAt: EARLY,
    });
  });

  it("reads and writes only the explicitly selected State without chronology inference", async () => {
    const fixture = await harness([EARLY, LATE]);
    await add(fixture.service, "nozzleDiameter", 0.4);
    await fixture.states.create({ id: "state-newer", printerId: "printer-a", createdAt: LATE });

    expect(
      field(await fixture.service.readTechnicalFields("printer-a"), "nozzleDiameter")
    ).toMatchObject({ status: "resolved", value: 0.4 });

    await fixture.selection.setSelectedState("printer-a", "state-newer");
    expect(
      field(await fixture.service.readTechnicalFields("printer-a"), "nozzleDiameter")
    ).toMatchObject({ status: "missing" });
    await add(fixture.service, "nozzleDiameter", 0.6);
    await expect(fixture.claims.findById("claim-2")).resolves.toMatchObject({
      target: { type: "printer_state", printerStateId: "state-newer" },
      value: { type: "number", value: 0.6 },
    });
    await expect(
      fixture.claims.listByTarget({ type: "printer_state", printerStateId: "state-a" })
    ).resolves.toEqual([expect.objectContaining({ value: { type: "number", value: 0.4 } })]);
  });

  it("maps confirmed and uncertain input to the exact existing provenance and trust", async () => {
    const { service, claims } = await harness([EARLY, LATE]);
    await add(service, "nozzleDiameter", 0.6, "uncertain");
    await add(service, "extruderType", "  direct-drive  ", "confirmed");
    await expect(claims.findById("claim-1")).resolves.toMatchObject({
      provenance: { sourceType: "user_entered" },
      trust: "user_entered",
      value: { type: "number", value: 0.6 },
      unit: "mm",
    });
    await expect(claims.findById("claim-2")).resolves.toMatchObject({
      provenance: { sourceType: "user_confirmed" },
      trust: "user_confirmed",
      value: { type: "string", value: "direct-drive" },
    });
  });

  it("resolves nozzle evidence through the existing installed-hardware policy", async () => {
    const { service } = await harness([EARLY, LATE]);
    expect(field(await service.readTechnicalFields("printer-a"), "nozzleDiameter")).toMatchObject({
      status: "missing",
    });
    expect(
      field(await add(service, "nozzleDiameter", 0.6, "uncertain"), "nozzleDiameter")
    ).toMatchObject({
      status: "blocked",
      reasonCode: "insufficient_confirmation",
    });
    expect(field(await add(service, "nozzleDiameter", 0.6), "nozzleDiameter")).toMatchObject({
      status: "resolved",
      value: 0.6,
      unit: "mm",
    });
  });

  it("uses a later confirmation but preserves equal-time contradiction as conflict", async () => {
    const later = await harness([EARLY, LATE]);
    await add(later.service, "nozzleDiameter", 0.4);
    expect(field(await add(later.service, "nozzleDiameter", 0.6), "nozzleDiameter")).toMatchObject({
      status: "resolved",
      value: 0.6,
      reasonCode: "newer_same_source",
    });

    const equal = await harness([EARLY, EARLY]);
    await add(equal.service, "nozzleDiameter", 0.4);
    expect(field(await add(equal.service, "nozzleDiameter", 0.6), "nozzleDiameter")).toMatchObject({
      status: "conflict",
      reasonCode: "unresolved_conflict",
    });
  });

  it("stores hotend limits as degC and resolves the conservative lower upper bound", async () => {
    const { service, claims } = await harness([EARLY, LATE]);
    await add(service, "hotendMaxTemperature", 300);
    const result = await add(service, "hotendMaxTemperature", 260);
    expect(field(result, "hotendMaxTemperature")).toMatchObject({
      status: "resolved",
      value: 260,
      unit: "degC",
      reasonCode: "safety_conservative_bound",
    });
    await expect(claims.findById("claim-1")).resolves.toMatchObject({ unit: "degC" });
  });

  it("creates a new immutable Claim for every entry", async () => {
    const { service, claims } = await harness([EARLY, LATE]);
    await add(service, "extruderType", "bowden");
    await add(service, "extruderType", "direct-drive");
    await expect(
      claims.listByTarget({ type: "printer_state", printerStateId: "state-a" })
    ).resolves.toHaveLength(2);
  });

  it("rejects invalid values and unsupported runtime fields", async () => {
    const { service } = await harness();
    await expect(add(service, "nozzleDiameter", Number.NaN)).rejects.toBeInstanceOf(
      InvalidManualTechnicalValueError
    );
    await expect(add(service, "extruderType", "   ")).rejects.toBeInstanceOf(
      InvalidManualTechnicalValueError
    );
    await expect(
      service.addManualClaim({
        printerId: "printer-a",
        field: "firmwareType" as never,
        value: "klipper",
        confirmation: "confirmed",
      })
    ).rejects.toBeInstanceOf(UnsupportedManualTechnicalFieldError);
  });
});

it("persists manual Claims and derives the same result after SQLite reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "printtune-technical-data-"));
  const path = join(directory, "printtune.sqlite");
  try {
    const first = openPrintTuneDatabase(path);
    first.migrate();
    const workspaces = first.createWorkspaceRepository();
    await workspaces.save({ id: "workspace-a", name: "A", createdAt: EARLY, updatedAt: EARLY });
    const session = new ActiveWorkspaceSession(workspaces);
    await session.setActiveWorkspace("workspace-a");
    const flow = new PrinterFlowApplicationService(
      new PrinterApplicationService(first.createPrinterCreationPersistence(), {
        createPrinterId: () => "printer-a",
        createPrinterStateId: () => "state-a",
        now: () => EARLY,
      }),
      first.createPrinterRepository(),
      first.createPrinterStateRepository(),
      first.createPrinterStateSelectionPersistence(),
      session
    );
    await flow.createPrinter("A");
    const claims = first.createFieldClaimRepository();
    await new PrinterTechnicalDataService(flow, claims, new FieldResolutionService(claims), {
      createClaimId: () => "claim-a",
      now: () => EARLY,
    }).addManualClaim({
      printerId: "printer-a",
      field: "nozzleDiameter",
      value: 0.6,
      confirmation: "confirmed",
    });
    first.close();

    const second = openPrintTuneDatabase(path);
    second.migrate();
    try {
      const reopenedSession = new ActiveWorkspaceSession(second.createWorkspaceRepository());
      await reopenedSession.setActiveWorkspace("workspace-a");
      const reopenedFlow = new PrinterFlowApplicationService(
        new PrinterApplicationService(second.createPrinterCreationPersistence()),
        second.createPrinterRepository(),
        second.createPrinterStateRepository(),
        second.createPrinterStateSelectionPersistence(),
        reopenedSession
      );
      const reopenedClaims = second.createFieldClaimRepository();
      const result = await new PrinterTechnicalDataService(
        reopenedFlow,
        reopenedClaims,
        new FieldResolutionService(reopenedClaims)
      ).readTechnicalFields("printer-a");
      expect(field(result, "nozzleDiameter")).toMatchObject({ status: "resolved", value: 0.6 });
    } finally {
      second.close();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
