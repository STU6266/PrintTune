import type {
  AddedComponentInstallationInput,
  ComponentInstallation,
  ComponentTransitionDecision,
  FieldClaimCarryDecision,
  PrinterState,
  PrinterStateTransitionPlan,
} from "@printtune/contracts";

import { createComponentInstallation } from "./component.js";
import {
  assessFieldClaimCarryForward,
  createCarriedForwardFieldClaims,
} from "./field-claim-carry-forward.js";
import { findCoreFieldDefinition } from "./core-field-definition-registry.js";
import { createPrinterState } from "./printer-state.js";

export type PrinterStateTransitionPlanErrorCode =
  | "invalid_command_id"
  | "source_state_printer_mismatch"
  | "source_component_state_mismatch"
  | "duplicate_component_decision"
  | "unknown_component_decision"
  | "missing_component_decision"
  | "duplicate_target_component_id"
  | "duplicate_target_component_instance_id"
  | "duplicate_target_component_role"
  | "invalid_claim_carry";

export class PrinterStateTransitionPlanError extends Error {
  override readonly name = "PrinterStateTransitionPlanError";
  constructor(readonly code: PrinterStateTransitionPlanErrorCode) {
    super(`Invalid PrinterState transition plan: ${code}`);
  }
}

export interface CreatePrinterStateTransitionPlanInput {
  readonly transitionCommandId: string;
  readonly printerId: string;
  readonly sourcePrinterState: PrinterState;
  readonly sourceComponentInstallations: readonly ComponentInstallation[];
  readonly componentDecisions: readonly ComponentTransitionDecision[];
  readonly addedComponents: readonly AddedComponentInstallationInput[];
  readonly sourceClaimCarryDecisions: readonly FieldClaimCarryDecision[];
  readonly createdAt: string;
  readonly createPrinterStateId: () => string;
  readonly createComponentInstallationId: () => string;
  readonly createComponentInstanceId: () => string;
  readonly createClaimId: () => string;
}

function validId(value: string): boolean {
  return value.length > 0 && value.trim() === value;
}

function validateBeforeIds(input: CreatePrinterStateTransitionPlanInput): void {
  if (!validId(input.transitionCommandId)) {
    throw new PrinterStateTransitionPlanError("invalid_command_id");
  }
  if (input.sourcePrinterState.printerId !== input.printerId) {
    throw new PrinterStateTransitionPlanError("source_state_printer_mismatch");
  }
  const sources = new Map<string, ComponentInstallation>();
  for (const component of input.sourceComponentInstallations) {
    if (component.printerStateId !== input.sourcePrinterState.id) {
      throw new PrinterStateTransitionPlanError("source_component_state_mismatch");
    }
    sources.set(component.id, component);
  }
  const decisions = new Set<string>();
  for (const decision of input.componentDecisions) {
    if (decisions.has(decision.sourceComponentInstallationId)) {
      throw new PrinterStateTransitionPlanError("duplicate_component_decision");
    }
    if (!sources.has(decision.sourceComponentInstallationId)) {
      throw new PrinterStateTransitionPlanError("unknown_component_decision");
    }
    decisions.add(decision.sourceComponentInstallationId);
  }
  if (decisions.size !== sources.size) {
    throw new PrinterStateTransitionPlanError("missing_component_decision");
  }
  for (const decision of input.sourceClaimCarryDecisions) {
    const definition = findCoreFieldDefinition(decision.sourceClaim.fieldPath);
    if (!definition) throw new PrinterStateTransitionPlanError("invalid_claim_carry");
    const assessment = assessFieldClaimCarryForward({
      claim: decision.sourceClaim,
      fieldDefinition: definition,
    });
    if (
      assessment.status === "not_carryable" ||
      assessment.status === "reconfirmation_required" ||
      (assessment.status === "confirmation_required" && !decision.applicabilityConfirmed)
    ) {
      throw new PrinterStateTransitionPlanError("invalid_claim_carry");
    }
  }
  // Validate the shared timestamp before consuming generated IDs.
  createPrinterState({
    id: "validation-state",
    printerId: input.printerId,
    parentPrinterStateId: input.sourcePrinterState.id,
    timestamp: input.createdAt,
  });
}

export function createPrinterStateTransitionPlan(
  input: CreatePrinterStateTransitionPlanInput
): PrinterStateTransitionPlan {
  validateBeforeIds(input);
  const targetPrinterState = createPrinterState({
    id: input.createPrinterStateId(),
    printerId: input.printerId,
    parentPrinterStateId: input.sourcePrinterState.id,
    timestamp: input.createdAt,
  });
  const sources = new Map(
    input.sourceComponentInstallations.map((component) => [component.id, component])
  );
  const targetComponentInstallations: ComponentInstallation[] = [];
  const sourceInstanceIds = new Set(
    input.sourceComponentInstallations.map(({ componentInstanceId }) => componentInstanceId)
  );
  for (const decision of input.componentDecisions) {
    if (decision.type !== "retain") continue;
    const source = sources.get(decision.sourceComponentInstallationId)!;
    targetComponentInstallations.push(
      createComponentInstallation({
        id: input.createComponentInstallationId(),
        printerStateId: targetPrinterState.id,
        componentInstanceId: source.componentInstanceId,
        role: source.role,
        kind: source.kind,
        displayName: source.displayName,
        ...(source.definitionRef ? { definitionRef: source.definitionRef } : {}),
      })
    );
  }
  for (const added of input.addedComponents) {
    const componentInstanceId = input.createComponentInstanceId();
    if (sourceInstanceIds.has(componentInstanceId)) {
      throw new PrinterStateTransitionPlanError("duplicate_target_component_instance_id");
    }
    targetComponentInstallations.push(
      createComponentInstallation({
        id: input.createComponentInstallationId(),
        printerStateId: targetPrinterState.id,
        componentInstanceId,
        ...added,
      })
    );
  }
  const installationIds = new Set<string>();
  const instanceIds = new Set<string>();
  const roles = new Set<string>();
  for (const installation of targetComponentInstallations) {
    if (installationIds.has(installation.id))
      throw new PrinterStateTransitionPlanError("duplicate_target_component_id");
    if (instanceIds.has(installation.componentInstanceId))
      throw new PrinterStateTransitionPlanError("duplicate_target_component_instance_id");
    if (roles.has(installation.role))
      throw new PrinterStateTransitionPlanError("duplicate_target_component_role");
    installationIds.add(installation.id);
    instanceIds.add(installation.componentInstanceId);
    roles.add(installation.role);
  }
  const carryDecisions = new Map(
    input.sourceClaimCarryDecisions.map((decision) => [decision.sourceClaim.id, decision])
  );
  const carriedClaims = createCarriedForwardFieldClaims({
    sourceClaims: input.sourceClaimCarryDecisions.map(({ sourceClaim }) => sourceClaim),
    sourcePrinterStateId: input.sourcePrinterState.id,
    targetPrinterStateId: targetPrinterState.id,
    transitionCommandId: input.transitionCommandId,
    createdAt: input.createdAt,
    createClaimId: input.createClaimId,
    applicabilityConfirmedClaimIds: new Set(
      [...carryDecisions.values()]
        .filter(({ applicabilityConfirmed }) => applicabilityConfirmed)
        .map(({ sourceClaim }) => sourceClaim.id)
    ),
  });
  return Object.freeze({
    transitionCommandId: input.transitionCommandId,
    printerId: input.printerId,
    sourcePrinterStateId: input.sourcePrinterState.id,
    targetPrinterState,
    componentDecisions: Object.freeze(
      input.componentDecisions.map((decision) => Object.freeze({ ...decision }))
    ),
    targetComponentInstallations: Object.freeze(targetComponentInstallations),
    carriedClaims,
  });
}
