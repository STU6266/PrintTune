import type { FieldClaim } from "@printtune/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  PrinterStateTransitionPlanError,
  createComponentInstallation,
  createFieldClaim,
  createPrinterState,
  createPrinterStateTransitionPlan,
} from "../src/index.js";

const sourceState = createPrinterState({
  id: "state-a",
  printerId: "printer-a",
  timestamp: "2026-08-10T10:00:00Z",
});
const sourceComponent = createComponentInstallation({
  id: "component-a",
  printerStateId: sourceState.id,
  componentInstanceId: "instance-a",
  role: "toolhead.extruder",
  kind: "extruder",
  displayName: "Extruder A",
  definitionRef: { packageId: "base", packageVersion: "1", definitionId: "extruder-a" },
});

function sourceClaim(fieldPath = "printer.nozzle.diameter"): FieldClaim {
  const stringField = fieldPath === "firmware.type";
  return createFieldClaim({
    id: `claim-${fieldPath}`,
    target: { type: "printer_state", printerStateId: sourceState.id },
    fieldPath,
    value: stringField ? { type: "string", value: "klipper" } : { type: "number", value: 0.4 },
    ...(stringField ? {} : { unit: "mm" as const }),
    provenance: { sourceType: "user_confirmed" },
    trust: "user_confirmed",
    confidence: 0.7,
    timestamp: "2026-08-10T10:00:00Z",
  });
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    transitionCommandId: "command-a",
    printerId: "printer-a",
    sourcePrinterState: sourceState,
    sourceComponentInstallations: [sourceComponent],
    componentDecisions: [
      { type: "retain" as const, sourceComponentInstallationId: sourceComponent.id },
    ],
    addedComponents: [],
    sourceClaimCarryDecisions: [{ sourceClaim: sourceClaim(), applicabilityConfirmed: true }],
    createdAt: "2026-08-11T10:00:00Z",
    createPrinterStateId: () => "state-b",
    createComponentInstallationId: () => "component-b",
    createComponentInstanceId: () => "instance-b",
    createClaimId: () => "claim-b",
    ...overrides,
  };
}

describe("createPrinterStateTransitionPlan", () => {
  it("creates a frozen exact child snapshot with retained components and carried evidence", () => {
    const plan = createPrinterStateTransitionPlan(input());
    expect(plan.targetPrinterState).toEqual({
      id: "state-b",
      printerId: "printer-a",
      parentPrinterStateId: "state-a",
      createdAt: "2026-08-11T10:00:00Z",
    });
    expect(plan.targetComponentInstallations).toEqual([
      {
        ...sourceComponent,
        id: "component-b",
        printerStateId: "state-b",
      },
    ]);
    expect(plan.carriedClaims[0]).toMatchObject({
      id: "claim-b",
      target: { type: "printer_state", printerStateId: "state-b" },
      value: sourceClaim().value,
      unit: "mm",
      trust: "user_confirmed",
      confidence: 0.7,
      createdAt: "2026-08-11T10:00:00Z",
      provenance: {
        sourceType: "state_transition",
        sourceRef: { sourceClaimId: sourceClaim().id, transitionCommandId: "command-a" },
      },
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.componentDecisions)).toBe(true);
    expect(Object.isFrozen(plan.targetComponentInstallations)).toBe(true);
    expect(Object.isFrozen(plan.carriedClaims)).toBe(true);
  });

  it("removes explicitly omitted hardware and supports zero carried claims", () => {
    const plan = createPrinterStateTransitionPlan(
      input({
        componentDecisions: [{ type: "remove", sourceComponentInstallationId: sourceComponent.id }],
        sourceClaimCarryDecisions: [],
      })
    );
    expect(plan.targetComponentInstallations).toEqual([]);
    expect(plan.carriedClaims).toEqual([]);
  });

  it("adds a new component with fresh installation and physical-instance IDs", () => {
    const plan = createPrinterStateTransitionPlan(
      input({
        componentDecisions: [{ type: "remove", sourceComponentInstallationId: sourceComponent.id }],
        addedComponents: [{ role: "toolhead.hotend", kind: "hotend", displayName: "Hotend B" }],
        sourceClaimCarryDecisions: [],
      })
    );
    expect(plan.targetComponentInstallations).toEqual([
      {
        id: "component-b",
        printerStateId: "state-b",
        componentInstanceId: "instance-b",
        role: "toolhead.hotend",
        kind: "hotend",
        displayName: "Hotend B",
      },
    ]);
  });

  it.each([
    [[], "missing_component_decision"],
    [[{ type: "retain", sourceComponentInstallationId: "unknown" }], "unknown_component_decision"],
    [
      [
        { type: "retain", sourceComponentInstallationId: sourceComponent.id },
        { type: "remove", sourceComponentInstallationId: sourceComponent.id },
      ],
      "duplicate_component_decision",
    ],
  ])("rejects incomplete, unknown, or duplicate decisions", (componentDecisions, code) => {
    expect(() => createPrinterStateTransitionPlan(input({ componentDecisions }))).toThrow(
      expect.objectContaining({ code })
    );
  });

  it("rejects package, weak, and safety carry requests before consuming IDs", () => {
    const createPrinterStateId = vi.fn(() => "unused");
    const packageClaim = createFieldClaim({
      ...sourceClaim(),
      id: "package-claim",
      provenance: {
        sourceType: "knowledge_package",
        sourceRef: { type: "knowledge_package", packageId: "base", packageVersion: "1" },
      },
      trust: "developer_verified",
      timestamp: sourceClaim().createdAt,
    });
    const weakClaim = createFieldClaim({
      ...sourceClaim(),
      id: "weak",
      provenance: { sourceType: "user_entered" },
      trust: "user_entered",
      timestamp: sourceClaim().createdAt,
    });
    const safetyClaim = createFieldClaim({
      ...sourceClaim(),
      id: "safety",
      fieldPath: "printer.hotend.max-temperature",
      value: { type: "number", value: 300 },
      unit: "degC",
      timestamp: sourceClaim().createdAt,
    });
    for (const invalidClaim of [packageClaim, weakClaim, safetyClaim]) {
      expect(() =>
        createPrinterStateTransitionPlan(
          input({
            createPrinterStateId,
            sourceClaimCarryDecisions: [
              { sourceClaim: invalidClaim, applicabilityConfirmed: true },
            ],
          })
        )
      ).toThrow(PrinterStateTransitionPlanError);
    }
    expect(createPrinterStateId).not.toHaveBeenCalled();
  });
});
